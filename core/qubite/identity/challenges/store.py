"""Committed, bounded email proofs. No SMTP, implicit signup or owner assignment."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hmac
from uuid import UUID, uuid4

from argon2.exceptions import Argon2Error

from ..accounts import InvalidAccount, normalize_email
from ..auth import passwords
from ..auth.store import AuthError, AuthStore, database
from ..auth.tokens import digest, issue, valid_token

TTL = {'verify':timedelta(minutes=30), 'reset':timedelta(minutes=15)}
PREFIX = {'verify':'qbt_ev_', 'reset':'qbt_er_'}
ATTEMPTS = 5


@dataclass(frozen=True, repr=False)
class Delivery:
    """Secret envelope for an injected test transport; never a public response."""
    recipient: str = field(repr=False)
    purpose: str
    challenge_id: UUID
    token: str = field(repr=False)
    expires_at: datetime

    def __repr__(self):
        return 'Delivery(<private>)'


class ChallengeStore(AuthStore):
    def __init__(self, settings, clock=None, transport=None):
        super().__init__(settings,clock)
        self.transport = transport

    def _gate(self, purpose):
        if purpose not in TTL:
            raise AuthError(400,'invalid_request')
        if not self.settings.email_challenges_enabled or not callable(self.transport):
            raise AuthError(503,'email_unavailable')

    def _authorize(self, kind, raw, csrf, ip, identifier, *, confirm):
        """Separate committed attempt budget/one-use anonymous CSRF reservation."""
        if not valid_token(csrf,'qbt_c_') or kind not in {'preauth','session'}:
            raise AuthError(403,'csrf_failed')
        if not valid_token(raw,'qbt_p_' if kind=='preauth' else 'qbt_s_'):
            raise AuthError(403,'csrf_failed')
        now=self.clock(); action='confirm' if confirm else 'request'
        with database(self.settings) as db:
            ip_ok=self._rate(db,'email_'+action+'_ip',ip,30,now)
            id_ok=self._rate(db,'email_'+action+'_identifier',identifier,8 if confirm else 3,now)
            allowed=ip_ok and id_ok
            if allowed:
                if kind=='session':
                    _, row=self._session(db,raw)
                    if not hmac.compare_digest(bytes(row[8]),digest(csrf)):
                        raise AuthError(403,'csrf_failed')
                else:
                    row=db.execute('''SELECT csrf_hash FROM qubite_core.auth_preauth
                        WHERE token_hash=%s AND used_at IS NULL AND expires_at>%s FOR UPDATE''',
                        (digest(raw),now)).fetchone()
                    if not row or not hmac.compare_digest(bytes(row[0]),digest(csrf)):
                        raise AuthError(403,'csrf_failed')
                    db.execute('UPDATE qubite_core.auth_preauth SET used_at=%s WHERE token_hash=%s', (now,digest(raw)))
        if not allowed:
            raise AuthError(429,'rate_limited')

    @staticmethod
    def _subject_snapshot(db, subject_id=None, canonical=None):
        # Shared lock order with login/OAuth/reset: subject, then proof, then credential.
        return db.execute('''SELECT s.id,s.email_original,s.email_canonical,s.status,
            s.auth_version,s.email_verified_at,p.credential_version
            FROM qubite_core.subjects s LEFT JOIN qubite_core.password_credentials p ON p.subject_id=s.id
            WHERE ''' + ('s.id=%s' if subject_id is not None else 's.email_canonical=%s') + ' FOR UPDATE OF s',
            (subject_id if subject_id is not None else canonical,)).fetchone()

    @staticmethod
    def _eligible(subject,purpose):
        if not subject or subject[3]=='blocked':
            return False
        if purpose=='verify':
            return subject[5] is None and subject[3] in {'pending','active'}
        return subject[3]=='active' and subject[5] is not None and subject[6] is not None

    def request(self,purpose,email,kind,raw,csrf,ip):
        self._gate(purpose)
        try:
            _, canonical=normalize_email(email)
        except InvalidAccount:
            canonical=None
        self._authorize(kind,raw,csrf,ip,purpose+':'+(canonical or 'invalid-email'),confirm=False)
        self._deliver(purpose, canonical)

    def _deliver(self, purpose, canonical):
        """Trusted internal dispatch after an authorized request or fresh enrollment.

        Not a route or independent public bypass. Registration reserves its own
        attempt/CSRF budget and calls this only for an account it just committed.
        """
        self._gate(purpose)
        now=self.clock(); token=issue(PREFIX[purpose]); cid=uuid4(); envelope=None
        with database(self.settings) as db:
            subject=self._subject_snapshot(db,canonical=canonical)
            if self._eligible(subject,purpose):
                db.execute('''UPDATE qubite_core.email_challenges SET finished_at=%s
                    WHERE subject_id=%s AND purpose=%s AND finished_at IS NULL''', (now,subject[0],purpose))
                # Bounded cleanup of expired security metadata only. Never delete account data.
                db.execute('''DELETE FROM qubite_core.email_challenges WHERE ctid IN
                    (SELECT ctid FROM qubite_core.email_challenges WHERE expires_at<%s
                     ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)''',
                    (now-timedelta(days=1),))
                db.execute('''INSERT INTO qubite_core.email_challenges
                    (id,subject_id,purpose,token_hash,email_canonical,auth_version,credential_version,created_at,expires_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                    (cid,subject[0],purpose,digest(token),subject[2],subject[4],subject[6],now,now+TTL[purpose]))
                envelope=Delivery(subject[1],purpose,cid,token,now+TTL[purpose])
        if envelope is None:
            return
        requested=subject
        # No DB lock during a transport call. Failures never disclose account existence.
        delivered=False
        try:
            delivered=self.transport(envelope) is True
        except Exception:
            pass  # Adapter exception text may contain recipient/token; never expose/log it.
        with database(self.settings) as db:
            subject=self._subject_snapshot(db,subject_id=subject[0])
            current=(subject and self._eligible(subject,purpose) and subject[2]==canonical
                     and subject[4]==requested[4] and subject[6]==requested[6])
            db.execute('''UPDATE qubite_core.email_challenges SET delivered_at=%s,finished_at=%s
                WHERE id=%s AND finished_at IS NULL''',
                (self.clock() if delivered and current else None,None if delivered and current else self.clock(),cid))

    def _reserve(self,purpose,cid,token):
        """Failed attempts commit; a valid proof does not survive exhaustion/revocation."""
        now=self.clock(); snapshot=None
        with database(self.settings) as db:
            row=db.execute('SELECT subject_id FROM qubite_core.email_challenges WHERE id=%s AND purpose=%s', (cid,purpose)).fetchone()
            subject=self._subject_snapshot(db,subject_id=row[0]) if row else None
            proof=db.execute('''SELECT token_hash,email_canonical,auth_version,credential_version,
                expires_at,delivered_at,finished_at,attempts FROM qubite_core.email_challenges
                WHERE id=%s AND purpose=%s FOR UPDATE''', (cid,purpose)).fetchone()
            now=self.clock()
            if proof and proof[6] is None and now<proof[4] and proof[5] and proof[7]<ATTEMPTS:
                attempts=proof[7]+1
                db.execute('UPDATE qubite_core.email_challenges SET attempts=%s WHERE id=%s', (attempts,cid))
                valid=(valid_token(token,PREFIX[purpose]) and hmac.compare_digest(bytes(proof[0]),digest(token))
                       and self._matches(subject,proof,purpose))
                if valid:
                    snapshot=subject
                elif attempts==ATTEMPTS:
                    db.execute('UPDATE qubite_core.email_challenges SET finished_at=%s WHERE id=%s', (now,cid))
        if snapshot is None:
            raise AuthError(400,'invalid_challenge')
        return snapshot

    def _matches(self,subject,proof,purpose):
        return (self._eligible(subject,purpose) and subject[2]==proof[1]
                and subject[4]==proof[2] and subject[6]==proof[3])

    def confirm(self,purpose,cid,token,kind,raw,csrf,ip,password=None):
        self._gate(purpose)
        self._authorize(kind,raw,csrf,ip,purpose+':'+str(cid),confirm=True)
        snapshot=self._reserve(purpose,cid,token)
        phc=None
        if purpose=='reset':
            try:
                phc=passwords.hash_password(password)
            except passwords.HashBusy:
                raise AuthError(429,'rate_limited') from None
            except (ValueError,Argon2Error):
                raise AuthError(400,'invalid_password') from None
        # Argon2 runs outside locks; recheck live authority, delivery, TTL and token.
        now=self.clock(); success=False
        with database(self.settings) as db:
            subject=self._subject_snapshot(db,subject_id=snapshot[0])
            proof=db.execute('''SELECT token_hash,email_canonical,auth_version,credential_version,
                expires_at,delivered_at,finished_at,attempts FROM qubite_core.email_challenges
                WHERE id=%s AND purpose=%s FOR UPDATE''', (cid,purpose)).fetchone()
            now=self.clock()
            if (proof and proof[6] is None and now<proof[4] and proof[5] and proof[7]<=ATTEMPTS
                    and self._matches(subject,proof,purpose) and hmac.compare_digest(bytes(proof[0]),digest(token))):
                if purpose=='reset':
                    db.execute('''UPDATE qubite_core.password_credentials
                        SET password_hash=%s,credential_version=credential_version+1,updated_at=%s
                        WHERE subject_id=%s''', (phc,now,subject[0]))
                else:
                    db.execute('''UPDATE qubite_core.subjects SET email_verified_at=%s,status='active'
                        WHERE id=%s''', (now,subject[0]))
                db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1,updated_at=%s WHERE id=%s', (now,subject[0]))
                db.execute('UPDATE qubite_core.sessions SET revoked_at=%s WHERE subject_id=%s AND revoked_at IS NULL', (now,subject[0]))
                db.execute('UPDATE qubite_core.email_challenges SET finished_at=%s WHERE subject_id=%s AND finished_at IS NULL', (now,subject[0]))
                success=True
        if not success:
            raise AuthError(400,'invalid_challenge')
