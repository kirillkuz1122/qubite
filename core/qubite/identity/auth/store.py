"""PostgreSQL authentication authority. No positive cache or implicit policy grants."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from uuid import uuid4

import psycopg
from argon2.exceptions import Argon2Error

from ...config import ConfigurationError
from ...migrations import LOCK_ID, MigrationError, ensure_current, load_migrations
from ..accounts import InvalidAccount, normalize_email
from . import passwords
from .tokens import csrf_for, digest, issue, valid_token

IDLE = timedelta(days=7)
ABSOLUTE = timedelta(days=30)
PREAUTH = timedelta(minutes=5)
REAUTH = timedelta(minutes=5)
RATE_WINDOW = timedelta(minutes=5)


class AuthError(RuntimeError):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(code)


@contextmanager
def database(settings):
    try:
        with psycopg.connect(**settings.connection_options()) as connection:
            # Shared migration lock: unrelated subjects need not serialize each other.
            connection.execute('SELECT pg_advisory_xact_lock_shared(%s)', (LOCK_ID,))
            ensure_current(connection, load_migrations())
            yield connection
    except (psycopg.Error, ConfigurationError, MigrationError):
        raise AuthError(503, 'identity_unavailable') from None


def setup_owner_password(settings, password):
    """Trusted local initial setup only. Never adopts/promotes or replaces a hash."""
    try:
        phc = passwords.hash_password(password)
    except (ValueError, passwords.HashBusy, Argon2Error):
        raise AuthError(400, 'invalid_password_or_capacity') from None
    with database(settings) as connection:
        row = connection.execute('''SELECT s.id FROM qubite_core.subjects s
            JOIN qubite_core.platform_owner o ON o.subject_id=s.id
            WHERE s.status='active' FOR UPDATE OF s''').fetchone()
        if not row:
            raise AuthError(409, 'owner_not_configured')
        if connection.execute('SELECT 1 FROM qubite_core.password_credentials WHERE subject_id=%s', row).fetchone():
            raise AuthError(409, 'owner_password_already_configured')
        connection.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash) VALUES (%s,%s)', (row[0], phc))
        return row[0]


class AuthStore:
    def __init__(self, settings, clock=None):
        self.settings = settings
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def _rate(self, connection, scope, value, limit, now):
        # Digest limits plaintext metadata, not an anonymization/encryption promise.
        key = hashlib.sha256((scope + '\0' + value).encode('utf-8', errors='replace')).digest()
        hits = connection.execute('''INSERT INTO qubite_core.auth_rate_limits(scope,bucket_hash,hits,expires_at)
            VALUES (%s,%s,1,%s) ON CONFLICT(scope,bucket_hash) DO UPDATE SET
            hits=CASE WHEN auth_rate_limits.expires_at <= %s THEN 1 ELSE LEAST(auth_rate_limits.hits+1,%s) END,
            expires_at=CASE WHEN auth_rate_limits.expires_at <= %s THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
            RETURNING hits''', (scope,key,now+RATE_WINDOW,now,limit+1,now)).fetchone()[0]
        return hits <= limit

    def _login_rates(self, connection, ip, identifier, now):
        # Stable row order prevents cross-IP / identifier deadlocks.
        ip_ok = self._rate(connection, 'login_ip', ip, 30, now)
        identifier_ok = self._rate(connection, 'login_identifier', identifier, 8, now)
        return ip_ok and identifier_ok

    def new_preauth(self, ip):
        now = self.clock()
        cookie = issue('qbt_p_')
        csrf = csrf_for(cookie)
        with database(self.settings) as connection:
            allowed = self._rate(connection, 'bootstrap_ip', ip, 60, now)
            if allowed:
                # Only disposable security metadata, bounded cleanup, no account/session deletion.
                for table in ('auth_preauth', 'auth_rate_limits'):
                    connection.execute('DELETE FROM qubite_core.' + table + ' WHERE ctid IN '
                        '(SELECT ctid FROM qubite_core.' + table + ' WHERE expires_at < %s LIMIT 100)', (now-timedelta(days=1),))
                connection.execute('INSERT INTO qubite_core.auth_preauth(token_hash,csrf_hash,created_at,expires_at) VALUES (%s,%s,%s,%s)',
                                   (digest(cookie),digest(csrf),now,now+PREAUTH))
        if not allowed:
            raise AuthError(429, 'rate_limited')
        return cookie, csrf

    def preauth_csrf(self, cookie):
        if not valid_token(cookie, 'qbt_p_'):
            return None
        with database(self.settings) as connection:
            row = connection.execute('SELECT csrf_hash FROM qubite_core.auth_preauth WHERE token_hash=%s AND used_at IS NULL AND expires_at>%s',
                                     (digest(cookie),self.clock())).fetchone()
        token = csrf_for(cookie)
        return token if row and hmac.compare_digest(bytes(row[0]),digest(token)) else None

    def _password_snapshot(self, connection, canonical):
        return connection.execute('''SELECT s.id,s.status,s.auth_version,p.password_hash,p.credential_version
            FROM qubite_core.subjects s LEFT JOIN qubite_core.password_credentials p ON p.subject_id=s.id
            WHERE s.email_canonical=%s''', (canonical,)).fetchone()

    @staticmethod
    def _verify(snapshot, password):
        try:
            valid = passwords.verify_password(snapshot[3] if snapshot else None, password)
        except passwords.HashBusy:
            raise AuthError(429, 'rate_limited') from None
        if not valid or not snapshot or snapshot[1] != 'active':
            raise AuthError(401, 'invalid_credentials')

    def login(self, email, password, cookie, csrf, ip):
        try:
            _, canonical = normalize_email(email)
        except InvalidAccount:
            canonical = None
        if not valid_token(cookie, 'qbt_p_') or not valid_token(csrf, 'qbt_c_'):
            raise AuthError(403, 'csrf_failed')
        now = self.clock()
        with database(self.settings) as connection:
            allowed = self._login_rates(connection, ip, canonical or 'invalid-email', now)
            if allowed:
                row = connection.execute('''SELECT csrf_hash FROM qubite_core.auth_preauth
                    WHERE token_hash=%s AND used_at IS NULL AND expires_at>%s FOR UPDATE''', (digest(cookie),now)).fetchone()
                if not row or not hmac.compare_digest(bytes(row[0]),digest(csrf)):
                    raise AuthError(403, 'csrf_failed')
                connection.execute('UPDATE qubite_core.auth_preauth SET used_at=%s WHERE token_hash=%s', (now,digest(cookie)))
                snapshot = self._password_snapshot(connection, canonical)
        if not allowed:
            raise AuthError(429, 'rate_limited')
        # Attempt reservation is committed even for wrong passwords; no row lock during Argon2.
        self._verify(snapshot, password)
        with database(self.settings) as connection:
            try:
                subject = self._subject(connection, snapshot[0])
            except AuthError:
                raise AuthError(401, 'invalid_credentials') from None
            current = connection.execute('SELECT password_hash,credential_version FROM qubite_core.password_credentials WHERE subject_id=%s FOR UPDATE', (subject['id'],)).fetchone()
            if subject['auth_version'] != snapshot[2] or current != snapshot[3:]:
                raise AuthError(401, 'invalid_credentials')
            return self._issue_session(connection, subject, password_proven=True)

    def _issue_session(self, connection, subject, *, password_proven):
        raw = issue('qbt_s_')
        now = self.clock()
        count = connection.execute('''SELECT count(*) FROM qubite_core.sessions
            WHERE subject_id=%s AND revoked_at IS NULL AND expires_at>%s AND absolute_expires_at>%s''', (subject['id'],now,now)).fetchone()[0]
        if count >= 20:
            raise AuthError(429, 'rate_limited')
        row = connection.execute('''INSERT INTO qubite_core.sessions
            (id,subject_id,token_hash,csrf_hash,auth_version,created_at,last_seen_at,expires_at,absolute_expires_at,reauthed_at,password_proven)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id,created_at,last_seen_at,expires_at,absolute_expires_at,reauthed_at''',
            (uuid4(),subject['id'],digest(raw),digest(csrf_for(raw)),subject['auth_version'],now,now,now+IDLE,now+ABSOLUTE,now,password_proven)).fetchone()
        result = {'subject':self._profile(subject), 'session':self._metadata(row, row[0])}
        return raw, result


    @staticmethod
    def _subject(connection, subject_id):
        row = connection.execute('SELECT id,email_original,display_name,status,auth_version FROM qubite_core.subjects WHERE id=%s FOR UPDATE', (subject_id,)).fetchone()
        if not row or row[3] != 'active':
            raise AuthError(401, 'unauthenticated')
        owner = connection.execute('SELECT EXISTS(SELECT 1 FROM qubite_core.platform_owner WHERE subject_id=%s)', (subject_id,)).fetchone()[0]
        return dict(id=row[0],email=row[1],display_name=row[2],auth_version=row[4],platform_owner=owner)

    @staticmethod
    def _profile(subject):
        return {k:subject[k] for k in ('id','email','display_name','platform_owner')}

    @staticmethod
    def _metadata(row, current_id):
        return dict(id=row[0],created_at=row[1],last_seen_at=row[2],expires_at=row[3],absolute_expires_at=row[4],current=row[0]==current_id)

    def _session(self, connection, raw):
        now = self.clock()
        row = connection.execute('SELECT subject_id FROM qubite_core.sessions WHERE token_hash=%s', (digest(raw),)).fetchone()
        if not row:
            raise AuthError(401, 'unauthenticated')
        # Subject before session lock: logout-all/login/reauth cannot create branches.
        subject = self._subject(connection, row[0])
        row = connection.execute('''SELECT id,created_at,last_seen_at,expires_at,absolute_expires_at,reauthed_at,auth_version,revoked_at,csrf_hash
            ,password_proven FROM qubite_core.sessions WHERE token_hash=%s FOR UPDATE''', (digest(raw),)).fetchone()
        if not row or row[7] or row[6] != subject['auth_version'] or now >= min(row[3],row[4]):
            raise AuthError(401, 'unauthenticated')
        expiry = min(now+IDLE,row[4])
        connection.execute('UPDATE qubite_core.sessions SET last_seen_at=%s,expires_at=%s WHERE id=%s', (now,expiry,row[0]))
        row = (row[0],row[1],now,expiry,*row[4:])
        return subject, row

    def authenticated(self, raw, *, csrf=None, action='me', target=None):
        if not valid_token(raw, 'qbt_s_'):
            raise AuthError(401, 'unauthenticated')
        if action in {'logout','logout-all','revoke','snapshot'} and not valid_token(csrf, 'qbt_c_'):
            raise AuthError(403, 'csrf_failed')
        with database(self.settings) as connection:
            subject, row = self._session(connection, raw)
            if csrf is not None and not hmac.compare_digest(bytes(row[8]),digest(csrf)):
                raise AuthError(403, 'csrf_failed')
            if action == 'me':
                return self._profile(subject)
            if action == 'csrf':
                return csrf_for(raw)
            if action == 'snapshot':
                canonical = connection.execute('SELECT email_canonical FROM qubite_core.subjects WHERE id=%s', (subject['id'],)).fetchone()[0]
                cred = self._password_snapshot(connection, canonical)
                return row[0], cred, canonical
            if action == 'sessions':
                rows = connection.execute('''SELECT id,created_at,last_seen_at,expires_at,absolute_expires_at,reauthed_at
                    FROM qubite_core.sessions WHERE subject_id=%s AND revoked_at IS NULL AND expires_at>%s AND absolute_expires_at>%s
                    ORDER BY created_at DESC,id LIMIT 20''', (subject['id'],self.clock(),self.clock())).fetchall()
                return {'items':[self._metadata(r,row[0]) for r in rows]}
            if action == 'logout-all':
                if not row[9] or self.clock()-row[5] > REAUTH:
                    raise AuthError(403, 'reauth_required')
                connection.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1,updated_at=%s WHERE id=%s', (self.clock(),subject['id']))
                connection.execute('UPDATE qubite_core.sessions SET revoked_at=%s WHERE subject_id=%s AND revoked_at IS NULL', (self.clock(),subject['id']))
            elif action in {'logout','revoke'}:
                target = row[0] if action == 'logout' else target
                result = connection.execute('UPDATE qubite_core.sessions SET revoked_at=COALESCE(revoked_at,%s) WHERE id=%s AND subject_id=%s RETURNING id', (self.clock(),target,subject['id'])).fetchone()
                if not result:
                    raise AuthError(404, 'not_found')
                return target == row[0]
            else:
                raise RuntimeError('Unknown internal Auth action')
            return True

    def reauth(self, raw, csrf, password, ip):
        session_id, snapshot, canonical = self.authenticated(raw, csrf=csrf, action='snapshot')
        if snapshot is None:
            raise AuthError(401, 'invalid_credentials')
        with database(self.settings) as connection:
            allowed = self._login_rates(connection,ip,canonical,self.clock())
        if not allowed:
            raise AuthError(429, 'rate_limited')
        self._verify(snapshot,password)
        with database(self.settings) as connection:
            subject, row = self._session(connection,raw)
            current = connection.execute('SELECT password_hash,credential_version FROM qubite_core.password_credentials WHERE subject_id=%s FOR UPDATE', (subject['id'],)).fetchone()
            if (row[0] != session_id or subject['auth_version'] != snapshot[2] or current != snapshot[3:]
                    or not hmac.compare_digest(bytes(row[8]), digest(csrf))):
                raise AuthError(401, 'unauthenticated')
            connection.execute('UPDATE qubite_core.sessions SET reauthed_at=%s,password_proven=true WHERE id=%s', (self.clock(),session_id))
