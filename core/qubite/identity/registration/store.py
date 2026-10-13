"""Bounded enrollment. Only pending accounts; invitation never proves email."""
from datetime import timedelta
import hashlib
import hmac
from uuid import uuid4

from argon2.exceptions import Argon2Error

from ..accounts import InvalidAccount, normalize_email, _display_name
from ..auth import passwords
from ..auth.store import AuthError, AuthStore, REAUTH, database
from ..auth.tokens import digest, issue, valid_token
from ..challenges.store import ChallengeStore


class RegistrationStore(AuthStore):
    def __init__(self, settings, clock=None, transport=None):
        super().__init__(settings, clock)
        self.email = ChallengeStore(settings, clock, transport)

    @staticmethod
    def _state(db, *, lock=False):
        row = db.execute('SELECT mode,revision,consent_version FROM qubite_core.registration_state '
                         'WHERE singleton=1' + (' FOR UPDATE' if lock else '')).fetchone()
        if not row:
            raise AuthError(503, 'identity_unavailable')
        return dict(mode=row[0], revision=row[1], consent_version=row[2])

    def config(self):
        with database(self.settings) as db:
            return self._state(db)

    def _owner(self, db, raw, csrf=None, *, mutation=False):
        if not valid_token(raw, 'qbt_s_'):
            raise AuthError(401, 'unauthenticated')
        subject, row = self._session(db, raw)
        if not subject['platform_owner']:
            raise AuthError(403, 'forbidden')
        if mutation:
            if not valid_token(csrf, 'qbt_c_') or not hmac.compare_digest(bytes(row[8]), digest(csrf)):
                raise AuthError(403, 'csrf_failed')
            if not row[9] or self.clock() - row[5] > REAUTH:
                raise AuthError(403, 'reauth_required')
        return subject['id']

    def _audit(self, db, actor, action, target, state):
        db.execute('''INSERT INTO qubite_core.registration_audit
            (id,actor_id,action,target_id,revision,mode,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)''',
            (uuid4(), actor, action, target, state['revision'], state['mode'], self.clock()))

    def owner_config(self, raw):
        with database(self.settings) as db:
            self._owner(db, raw)
            return self._state(db)

    def set_mode(self, raw, csrf, mode, revision):
        with database(self.settings) as db:
            actor = self._owner(db, raw, csrf, mutation=True)
            state = self._state(db, lock=True)
            if revision != state['revision']:
                raise AuthError(412, 'registration_changed')
            db.execute('UPDATE qubite_core.registration_state SET mode=%s,revision=revision+1 WHERE singleton=1', (mode,))
            state = self._state(db)
            self._audit(db, actor, 'mode', None, state)
            return state

    def create_invite(self, raw, csrf, email, ttl_seconds, iid):
        try:
            canonical = normalize_email(email)[1] if email is not None else None
        except InvalidAccount:
            raise AuthError(400, 'invalid_request') from None
        token = issue('qbt_ri_'); now = self.clock()
        request_hash = hashlib.sha256(((canonical or '') + '\0' + str(ttl_seconds)).encode()).digest()
        with database(self.settings) as db:
            actor = self._owner(db, raw, csrf, mutation=True)
            allowed = self._rate(db, 'registration_owner', str(actor), 30, now)
            if allowed:
                state = self._state(db, lock=True)
                previous = db.execute('SELECT request_hash FROM qubite_core.registration_invites WHERE id=%s', (iid,)).fetchone()
                if previous:
                    # No encrypted/plaintext invitation token is retained for replay.
                    # A lost response can be revoked by this same command UUID.
                    raise AuthError(409, 'invite_already_issued' if hmac.compare_digest(bytes(previous[0]), request_hash) else 'idempotency_conflict')
                db.execute('''INSERT INTO qubite_core.registration_invites
                    (id,token_hash,request_hash,email_canonical,created_by,created_at,expires_at) VALUES (%s,%s,%s,%s,%s,%s,%s)''',
                    (iid, digest(token), request_hash, canonical, actor, now, now + timedelta(seconds=ttl_seconds)))
                self._audit(db, actor, 'invite_create', iid, state)
        if not allowed:
            raise AuthError(429, 'rate_limited')
        # Plaintext returned once, only to the owner; DB/list/audit never contain it.
        return dict(id=iid, token=token, email=canonical, expires_at=now + timedelta(seconds=ttl_seconds))

    def invites(self, raw):
        with database(self.settings) as db:
            self._owner(db, raw)
            rows = db.execute('''SELECT id,email_canonical,created_at,expires_at,revoked_at,redeemed_at
                FROM qubite_core.registration_invites ORDER BY created_at DESC,id LIMIT 100''').fetchall()
            return {'items': [dict(zip(('id','email','created_at','expires_at','revoked_at','redeemed_at'), r)) for r in rows]}

    def revoke(self, raw, csrf, iid):
        with database(self.settings) as db:
            actor = self._owner(db, raw, csrf, mutation=True)
            state = self._state(db, lock=True)
            found = db.execute('''UPDATE qubite_core.registration_invites SET revoked_at=COALESCE(revoked_at,%s)
                WHERE id=%s RETURNING id''', (self.clock(), iid)).fetchone()
            if not found:
                raise AuthError(404, 'not_found')
            self._audit(db, actor, 'invite_revoke', iid, state)

    def _reserve(self, cookie, csrf, ip, canonical, token):
        if not valid_token(cookie, 'qbt_p_') or not valid_token(csrf, 'qbt_c_'):
            raise AuthError(403, 'csrf_failed')
        now = self.clock()
        with database(self.settings) as db:
            ip_ok = self._rate(db, 'register_ip', ip, 20, now)
            id_ok = self._rate(db, 'register_identifier', canonical, 3, now)
            invite_ok = self._rate(db, 'register_invite', token or 'no-invite', 5 if token else 1000, now)
            allowed = ip_ok and id_ok and invite_ok
            if allowed:
                row = db.execute('''SELECT csrf_hash FROM qubite_core.auth_preauth
                    WHERE token_hash=%s AND used_at IS NULL AND expires_at>%s FOR UPDATE''', (digest(cookie), now)).fetchone()
                if not row or not hmac.compare_digest(bytes(row[0]), digest(csrf)):
                    raise AuthError(403, 'csrf_failed')
                db.execute('UPDATE qubite_core.auth_preauth SET used_at=%s WHERE token_hash=%s', (now, digest(cookie)))
        if not allowed:
            raise AuthError(429, 'rate_limited')

    def _eligible(self, db, state, canonical, token, consent_version):
        if state['mode'] == 'disabled':
            raise AuthError(403, 'registration_closed')
        if state['consent_version'] != consent_version:
            raise AuthError(409, 'consent_changed')
        if token is None:
            if state['mode'] != 'public':
                raise AuthError(403, 'invite_required')
            return None
        if not valid_token(token, 'qbt_ri_'):
            raise AuthError(400, 'invalid_invite')
        row = db.execute('''SELECT id,email_canonical,expires_at,revoked_at,redeemed_at
            FROM qubite_core.registration_invites WHERE token_hash=%s''', (digest(token),)).fetchone()
        if (not row or row[3] or row[4] or self.clock() >= row[2]
                or (row[1] is not None and row[1] != canonical)):
            raise AuthError(400, 'invalid_invite')
        return row[0]

    def register(self, body, cookie, csrf, ip):
        try:
            original, canonical = normalize_email(body.email)
            name = _display_name(body.display_name)
        except InvalidAccount:
            raise AuthError(400, 'invalid_request') from None
        if not body.consent_accepted or not passwords.valid_password(body.password):
            raise AuthError(400, 'invalid_request')
        self._reserve(cookie, csrf, ip, canonical, body.invite_token)
        with database(self.settings) as db:
            before = self._state(db)
            self._eligible(db, before, canonical, body.invite_token, body.consent_version)
        self.email._gate('verify')
        try:
            phc = passwords.hash_password(body.password)
        except passwords.HashBusy:
            raise AuthError(429, 'rate_limited') from None
        except (ValueError, Argon2Error):
            raise AuthError(400, 'invalid_request') from None
        created = False
        with database(self.settings) as db:
            # One brief lock serializes config/revoke/redeem and canonical insertion.
            # Argon2 and transport happen outside this lock. Re-enable cannot revive an in-flight request.
            state = self._state(db, lock=True)
            if state != before:
                raise AuthError(409, 'registration_changed')
            iid = self._eligible(db, state, canonical, body.invite_token, body.consent_version)
            sid = uuid4(); now = self.clock()
            result = db.execute('''INSERT INTO qubite_core.subjects
                (id,email_original,email_canonical,display_name,status,created_at,updated_at)
                VALUES (%s,%s,%s,%s,'pending',%s,%s) ON CONFLICT(email_canonical) DO NOTHING RETURNING id''',
                (sid, original, canonical, name, now, now)).fetchone()
            if result:
                db.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash,updated_at) VALUES (%s,%s,%s)', (sid, phc, now))
                db.execute('''INSERT INTO qubite_core.registration_consents
                    (subject_id,consent_version,accepted_at,source,invite_id) VALUES (%s,%s,%s,%s,%s)''',
                    (sid, body.consent_version, now, 'invite' if iid else 'public', iid))
                if iid:
                    db.execute('UPDATE qubite_core.registration_invites SET redeemed_at=%s,redeemed_by=%s WHERE id=%s', (now, sid, iid))
                self._audit(db, None, 'register', sid, state)
                created = True
        if created:
            # Account and redemption are committed before delivery. A failed mock
            # leaves a recoverable pending account; existing verify/request can retry.
            try:
                self.email._deliver('verify', canonical)
            except AuthError:
                pass
        # Uniform acceptance also for canonical collisions; no session/UUID/email proof in response.
