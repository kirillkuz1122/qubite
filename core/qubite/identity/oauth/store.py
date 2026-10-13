"""Explicit bindings, disposable one-use flows and current provider permissions."""
from dataclasses import dataclass
from datetime import timedelta
import hmac

import psycopg

from ..auth.store import AuthError, AuthStore, database, REAUTH
from ..auth.tokens import digest, issue, valid_token
from .providers import PROVIDERS, Exchange, authorize, fingerprint, provider


@dataclass(frozen=True, repr=False)
class Flow:
    provider: str
    version: int
    config_hash: bytes
    intent: str
    subject_id: object
    session_hash: bytes | None
    auth_version: int | None
    credential_version: int | None
    created_at: object
    expires_at: object


class OAuthStore:
    def __init__(self, settings, clock=None, exchange=None):
        self.settings = settings
        self.auth = AuthStore(settings, clock)
        self.clock = self.auth.clock
        self.exchange = exchange or Exchange(network_enabled=settings.oauth_network_enabled)

    def callback_uri(self, name):
        provider(name)
        if not self.settings.auth_origin:
            raise AuthError(503, 'identity_unavailable')
        return self.settings.auth_origin + '/api/v1/auth/oauth/' + name + '/callback'

    def _permission(self, connection, name):
        provider(name)
        client = self.settings.oauth_client(name)
        if not client.configured or not self.exchange.available():
            raise AuthError(503, 'provider_not_configured')
        row = connection.execute('SELECT enabled,version FROM qubite_core.oauth_providers WHERE provider=%s FOR SHARE', (name,)).fetchone()
        if not row:
            raise AuthError(503, 'identity_unavailable')
        if not row[0]:
            raise AuthError(403, 'provider_disabled')
        return client, row[1], fingerprint(client, self.callback_uri(name))

    def providers(self):
        with database(self.settings) as connection:
            rows = dict(connection.execute('SELECT provider,enabled FROM qubite_core.oauth_providers').fetchall())
        if set(rows) != set(PROVIDERS):
            raise AuthError(503, 'identity_unavailable')
        return {'items': [{'provider': name, 'available': bool(rows[name] and self.settings.oauth_client(name).configured
                           and self.exchange.available())} for name in PROVIDERS]}

    def _link_context(self, connection, raw, csrf=None):
        if not valid_token(raw, 'qbt_s_'):
            raise AuthError(401, 'unauthenticated')
        subject, session = self.auth._session(connection, raw)
        if csrf is not None and (not valid_token(csrf, 'qbt_c_') or not hmac.compare_digest(bytes(session[8]), digest(csrf))):
            raise AuthError(403, 'csrf_failed')
        if not session[9] or self.clock() - session[5] > REAUTH:
            raise AuthError(403, 'reauth_required')
        credential = connection.execute('SELECT credential_version FROM qubite_core.password_credentials WHERE subject_id=%s FOR UPDATE', (subject['id'],)).fetchone()
        if not credential:
            raise AuthError(403, 'reauth_required')
        return subject, credential[0]

    def start(self, name, intent, raw, csrf, password, ip):
        provider(name)
        if intent not in {'login', 'link'} or not valid_token(csrf, 'qbt_c_'):
            raise AuthError(403, 'csrf_failed')
        # Deny unconfigured/disabled before Argon2 or consuming any proof.
        with database(self.settings) as connection:
            self._permission(connection, name)
        if intent == 'link':
            self.auth.reauth(raw, csrf, password, ip)  # Real own password; never provider email proof.
        elif password is not None or not valid_token(raw, 'qbt_p_'):
            raise AuthError(403, 'csrf_failed')
        state, browser = issue('qbt_o_'), issue('qbt_f_')
        now = self.clock()
        with database(self.settings) as connection:
            allowed = self.auth._rate(connection, 'login_ip', ip, 30, now)
            if allowed:
                client, version, stamp = self._permission(connection, name)
                subject, auth_version, credential_version, session_hash = None, None, None, None
                if intent == 'link':
                    actor, credential_version = self._link_context(connection, raw, csrf)
                    subject, auth_version, session_hash = actor['id'], actor['auth_version'], digest(raw)
                else:
                    challenge = connection.execute('''SELECT csrf_hash FROM qubite_core.auth_preauth
                        WHERE token_hash=%s AND used_at IS NULL AND expires_at>%s FOR UPDATE''', (digest(raw), now)).fetchone()
                    if not challenge or not hmac.compare_digest(bytes(challenge[0]), digest(csrf)):
                        raise AuthError(403, 'csrf_failed')
                    connection.execute('UPDATE qubite_core.auth_preauth SET used_at=%s WHERE token_hash=%s', (now, digest(raw)))
                connection.execute('''DELETE FROM qubite_core.oauth_states WHERE state_hash IN
                    (SELECT state_hash FROM qubite_core.oauth_states WHERE expires_at<%s LIMIT 100)''', (now-timedelta(days=1),))
                connection.execute('''INSERT INTO qubite_core.oauth_states
                    (state_hash,browser_hash,provider,provider_version,config_hash,intent,subject_id,session_hash,
                     auth_version,credential_version,created_at,expires_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                    (digest(state),digest(browser),name,version,stamp,intent,subject,session_hash,auth_version,
                     credential_version,now,now+timedelta(minutes=5)))
        if not allowed:
            raise AuthError(429, 'rate_limited')
        return browser, {'authorization_url': authorize(client,self.callback_uri(name),state,browser)}

    def _flow_permission(self, connection, flow):
        client, version, stamp = self._permission(connection, flow.provider)
        if version != flow.version or not hmac.compare_digest(stamp, bytes(flow.config_hash)):
            raise AuthError(403, 'oauth_context_changed')
        return client

    def _flow_actor(self, connection, flow, raw):
        if (not valid_token(raw, 'qbt_s_') or not hmac.compare_digest(digest(raw), bytes(flow.session_hash))):
            raise AuthError(403, 'oauth_context_changed')
        subject, cred_version = self._link_context(connection, raw)
        if (subject['id'] != flow.subject_id or subject['auth_version'] != flow.auth_version
                or cred_version != flow.credential_version):
            raise AuthError(403, 'oauth_context_changed')
        return subject

    def complete(self, name, state, browser, raw, kind, code, device_id, error, ip):
        provider(name)
        if not valid_token(state, 'qbt_o_') or not valid_token(browser, 'qbt_f_'):
            raise AuthError(403, 'oauth_state_failed')
        now = self.clock()
        with database(self.settings) as connection:
            # Commit the shared attempt budget even for invalid/replayed state.
            self._permission(connection, name)
            allowed = self.auth._rate(connection, 'login_ip', ip, 30, now)
        if not allowed:
            raise AuthError(429, 'rate_limited')
        with database(self.settings) as connection:
            self._permission(connection, name)
            row = connection.execute('''SELECT provider,provider_version,config_hash,intent,subject_id,session_hash,
                auth_version,credential_version,created_at,expires_at,browser_hash,used_at
                FROM qubite_core.oauth_states WHERE state_hash=%s FOR UPDATE''', (digest(state),)).fetchone()
            if (not row or row[0] != name or row[11] or now >= row[9]
                    or not hmac.compare_digest(bytes(row[10]),digest(browser))):
                raise AuthError(403, 'oauth_state_failed')
            flow = Flow(*row[:10]); client = self._flow_permission(connection, flow)
            if flow.intent == 'link':
                self._flow_actor(connection, flow, raw)
            elif kind == 'session':
                raise AuthError(403, 'oauth_context_changed')
            connection.execute('UPDATE qubite_core.oauth_states SET used_at=%s WHERE state_hash=%s', (now,digest(state)))
        # One-use reservation commits even on provider error/timeout. No retry of unknown exchange.
        if error:
            raise AuthError(400, 'provider_denied')
        proof = self.exchange.exchange(client, self.callback_uri(name), state, browser, code, device_id, self.clock())
        with database(self.settings) as connection:
            self._flow_permission(connection, flow)
            if self.clock() >= flow.expires_at:
                raise AuthError(403, 'oauth_state_failed')
            if proof.provider != name or proof.issuer != provider(name).issuer:
                raise AuthError(502, 'provider_invalid_response')
            if flow.intent == 'link':
                subject = self._flow_actor(connection, flow, raw)
                try:
                    connection.execute('''INSERT INTO qubite_core.oauth_identities(provider,issuer,provider_subject,subject_id,linked_at)
                        VALUES (%s,%s,%s,%s,%s)''', (name,proof.issuer,proof.subject,subject['id'],self.clock()))
                except psycopg.errors.UniqueViolation:
                    raise AuthError(409, 'oauth_identity_conflict') from None
                self._audit(connection,name,subject['id'],'link')
                return None, None
            pair = (name,proof.issuer,proof.subject)
            row = connection.execute('SELECT subject_id FROM qubite_core.oauth_identities WHERE provider=%s AND issuer=%s AND provider_subject=%s', pair).fetchone()
            if not row:
                raise AuthError(409, 'oauth_identity_unlinked')
            subject = self.auth._subject(connection, row[0])
            current = connection.execute('SELECT subject_id FROM qubite_core.oauth_identities WHERE provider=%s AND issuer=%s AND provider_subject=%s FOR UPDATE', pair).fetchone()
            if not current or current[0] != subject['id']:
                raise AuthError(401, 'unauthenticated')
            result = self.auth._issue_session(connection,subject,password_proven=False)
            self._audit(connection,name,subject['id'],'login')
            return result

    def _audit(self, connection, name, subject, action):
        connection.execute('INSERT INTO qubite_core.oauth_audit(provider,subject_id,action,source,created_at) VALUES (%s,%s,%s,%s,%s)',
                           (name,subject,action,'web',self.clock()))

    def identities(self, raw):
        if not valid_token(raw, 'qbt_s_'):
            raise AuthError(401, 'unauthenticated')
        with database(self.settings) as connection:
            subject, _ = self.auth._session(connection, raw)
            rows = connection.execute('SELECT provider,linked_at FROM qubite_core.oauth_identities WHERE subject_id=%s ORDER BY provider', (subject['id'],)).fetchall()
            return {'items': [{'provider': row[0], 'linked_at': row[1]} for row in rows]}

    def unlink(self, name, raw, csrf, password, ip):
        provider(name)
        self.auth.reauth(raw,csrf,password,ip)
        with database(self.settings) as connection:
            subject, _ = self._link_context(connection,raw,csrf)
            row = connection.execute('DELETE FROM qubite_core.oauth_identities WHERE subject_id=%s AND provider=%s RETURNING subject_id', (subject['id'],name)).fetchone()
            if not row:
                raise AuthError(404,'not_found')
            # Invalidate pending links and sessions issued by the removed provider.
            connection.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1,updated_at=%s WHERE id=%s', (self.clock(),subject['id']))
            connection.execute('UPDATE qubite_core.sessions SET revoked_at=COALESCE(revoked_at,%s) WHERE subject_id=%s', (self.clock(),subject['id']))
            self._audit(connection,name,subject['id'],'unlink')


def set_enabled(settings, name, enabled):
    """Trusted local operator only. No HTTP grant or environment-based auto-enable."""
    provider(name)
    if type(enabled) is not bool or (enabled and not settings.oauth_client(name).configured):
        raise AuthError(400,'provider_not_configured')
    with database(settings) as connection:
        row = connection.execute('''UPDATE qubite_core.oauth_providers SET enabled=%s,version=version+1,updated_at=CURRENT_TIMESTAMP
            WHERE provider=%s RETURNING version''', (enabled,name)).fetchone()
        if not row:
            raise AuthError(503,'identity_unavailable')
        connection.execute('INSERT INTO qubite_core.oauth_audit(provider,action,source,created_at) VALUES (%s,%s,%s,CURRENT_TIMESTAMP)',
                           (name,'provider_enable' if enabled else 'provider_disable','local_operator'))
        return row[0]
