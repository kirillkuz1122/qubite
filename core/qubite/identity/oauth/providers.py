"""Fixed upstream endpoints, bounded transport and verified identity proofs."""
from dataclasses import dataclass, field
import base64
import hashlib
import hmac
import json
import math
import re
from threading import BoundedSemaphore
import time
from urllib.parse import urlencode

import httpx
import jwt

from ..auth.store import AuthError


@dataclass(frozen=True)
class Provider:
    name: str
    issuer: str
    authorize: str
    token: str
    scope: str
    info: str | None = None
    jwks: str | None = None


PROVIDERS = {
    'google': Provider('google', 'https://accounts.google.com', 'https://accounts.google.com/o/oauth2/v2/auth',
                       'https://oauth2.googleapis.com/token', 'openid', jwks='https://www.googleapis.com/oauth2/v3/certs'),
    'telegram': Provider('telegram', 'https://oauth.telegram.org', 'https://oauth.telegram.org/auth',
                         'https://oauth.telegram.org/token', 'openid', jwks='https://oauth.telegram.org/.well-known/jwks.json'),
    'yandex': Provider('yandex', 'https://login.yandex.ru', 'https://oauth.yandex.ru/authorize',
                       'https://oauth.yandex.ru/token', 'login:info', info='https://login.yandex.ru/info'),
    'vk': Provider('vk', 'https://id.vk.ru', 'https://id.vk.ru/authorize',
                   'https://id.vk.ru/oauth2/auth', 'vkid.personal_info', info='https://id.vk.ru/oauth2/user_info'),
}


def provider(name):
    if name not in PROVIDERS:
        raise AuthError(404, 'provider_not_found')
    return PROVIDERS[name]


def derived(browser, state, purpose):
    return base64.urlsafe_b64encode(hmac.digest(browser.encode('ascii'),
        (purpose + '\0' + state).encode('ascii'), 'sha256')).rstrip(b'=').decode('ascii')


def fingerprint(client, callback):
    return hashlib.sha256(json.dumps([client.provider, client.client_id, client.secret, callback,
                                     'code-pkce-rs256-v1'], separators=(',', ':')).encode()).digest()


def authorize(client, callback, state, browser):
    p = provider(client.provider)
    verifier = derived(browser, state, 'pkce')
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    params = dict(client_id=client.client_id, redirect_uri=callback, response_type='code', scope=p.scope,
                  state=state, code_challenge=challenge, code_challenge_method='S256')
    if p.jwks:
        params['nonce'] = derived(browser, state, 'nonce')
    if p.name == 'google':
        params['prompt'] = 'select_account'
    if p.name == 'yandex':
        params['force_confirm'] = 'yes'
    if p.name == 'vk':
        params['code_challenge_method'] = 's256'  # Exact VK SDK convention.
    return p.authorize + '?' + urlencode(params)


@dataclass(frozen=True)
class IdentityProof:
    provider: str
    issuer: str
    subject: str = field(repr=False)


def identifier(value):
    if type(value) is int:
        value = str(value) if value > 0 else None
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.:@-]{1,255}', value):
        raise AuthError(502, 'provider_invalid_response')
    return value


SLOTS = BoundedSemaphore(4)


class Exchange:
    def __init__(self, *, transport=None, network_enabled=False):
        self.transport, self.network_enabled = transport, network_enabled

    def available(self):
        return self.transport is not None or self.network_enabled

    def request(self, method, url, **kwargs):
        if not self.available():
            raise AuthError(503, 'provider_transport_unavailable')
        allowed = {u for p in PROVIDERS.values() for u in (p.token, p.info, p.jwks) if u}
        if url not in allowed:
            raise AuthError(502, 'provider_invalid_response')
        try:
            # No proxies/cookies/redirects/retries. Fixed HTTPS endpoints only.
            with httpx.Client(transport=self.transport, trust_env=False, follow_redirects=False,
                              timeout=httpx.Timeout(3, connect=1)) as client:
                with client.stream(method, url, **kwargs) as response:
                    if response.status_code != 200 or response.headers.get('content-type', '').split(';')[0] != 'application/json':
                        raise AuthError(502, 'provider_invalid_response')
                    data = bytearray()
                    deadline = time.monotonic() + 5
                    for chunk in response.iter_bytes():
                        data.extend(chunk)
                        if len(data) > 65536 or time.monotonic() > deadline:
                            raise AuthError(502, 'provider_invalid_response')
                    def unique_pairs(pairs):
                        result = {}
                        for key, value in pairs:
                            if key in result:
                                raise ValueError('Duplicate JSON member')
                            result[key] = value
                        return result
                    result = json.loads(data, object_pairs_hook=unique_pairs)
                    if not isinstance(result, dict) or 'error' in result:
                        raise AuthError(502, 'provider_invalid_response')
                    return result
        except (httpx.HTTPError, ValueError, UnicodeError, RecursionError):
            raise AuthError(502, 'provider_unavailable') from None

    def oidc(self, client, token, nonce, now):
        p = provider(client.provider)
        try:
            if not isinstance(token, str) or not 1 <= len(token) <= 16384:
                raise ValueError()
            header = jwt.get_unverified_header(token)
            if (header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str)
                    or not 1 <= len(header['kid']) <= 128 or set(header) & {'jku', 'x5u', 'jwk', 'crit'}):
                raise ValueError()
            keys = self.request('GET', p.jwks).get('keys')
            if not isinstance(keys, list) or not 1 <= len(keys) <= 8:
                raise ValueError()
            matches = [k for k in keys if isinstance(k, dict) and k.get('kid') == header['kid']]
            if len(matches) != 1:
                raise ValueError()
            jwk = matches[0]
            if (jwk.get('kty') != 'RSA' or jwk.get('use', 'sig') != 'sig'
                    or jwk.get('alg', 'RS256') != 'RS256' or jwk.get('key_ops', ['verify']) != ['verify']):
                raise ValueError()
            if (not isinstance(jwk.get('n'), str) or not 342 <= len(jwk['n']) <= 683
                    or not isinstance(jwk.get('e'), str) or not 1 <= len(jwk['e']) <= 8
                    or set(jwk) & {'d','p','q','dp','dq','qi','oth'}):
                raise ValueError()
            key = jwt.PyJWK.from_dict(jwk, algorithm='RS256').key
            if not 2048 <= key.key_size <= 4096:
                raise ValueError()
            issuers = [p.issuer, 'accounts.google.com'] if p.name == 'google' else [p.issuer]
            claims = jwt.decode(token, key, algorithms=['RS256'], audience=client.client_id, issuer=issuers,
                options={'require': ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce'],
                         'verify_exp': False, 'verify_iat': False, 'verify_nbf': False})
            seconds = now.timestamp()
            for name in ('exp', 'iat'):
                if type(claims[name]) not in (int, float) or not math.isfinite(claims[name]):
                    raise ValueError()
            if not claims['iat'] <= seconds + 30 or not seconds < claims['exp'] or claims['exp'] <= claims['iat']:
                raise ValueError()
            if 'nbf' in claims and (type(claims['nbf']) not in (int, float) or not claims['nbf'] <= seconds + 30):
                raise ValueError()
            aud = claims['aud']
            if isinstance(aud, list) and len(aud) > 1 and claims.get('azp') != client.client_id:
                raise ValueError()
            if 'azp' in claims and claims['azp'] != client.client_id:
                raise ValueError()
            if not isinstance(claims['nonce'], str) or not hmac.compare_digest(claims['nonce'], nonce):
                raise ValueError()
            sub = identifier(claims['sub'])
            return IdentityProof(p.name, p.issuer, sub)
        except (jwt.PyJWTError, ValueError, TypeError, AttributeError):
            raise AuthError(502, 'provider_invalid_response') from None

    def exchange(self, client, callback, state, browser, code, device_id, now):
        if not SLOTS.acquire(blocking=False):
            raise AuthError(429, 'rate_limited')
        try:
            return self._exchange(client,callback,state,browser,code,device_id,now)
        finally:
            SLOTS.release()

    def _exchange(self, client, callback, state, browser, code, device_id, now):
        p = provider(client.provider)
        data = dict(grant_type='authorization_code', code=code, client_id=client.client_id,
                    redirect_uri=callback, code_verifier=derived(browser, state, 'pkce'))
        kwargs = {}
        if p.name == 'vk':
            if not device_id:
                raise AuthError(400, 'invalid_request')
            data.update(state=state, device_id=device_id)
        elif p.name in {'telegram', 'yandex'}:
            kwargs['auth'] = httpx.BasicAuth(client.client_id, client.secret)
        else:
            data['client_secret'] = client.secret
        token = self.request('POST', p.token, data=data, **kwargs)
        if p.jwks:
            return self.oidc(client, token.get('id_token'), derived(browser, state, 'nonce'), now)
        access = token.get('access_token')
        expires = token.get('expires_in')
        if (not isinstance(access, str) or not 1 <= len(access) <= 4096
                or not all(32 < ord(c) < 127 for c in access) or type(expires) is not int or expires <= 0
                or not isinstance(token.get('token_type'), str) or token['token_type'].lower() != 'bearer'):
            raise AuthError(502, 'provider_invalid_response')
        if p.name == 'yandex':
            info = self.request('GET', p.info, headers={'Authorization': 'OAuth ' + access})
            if info.get('client_id') != client.client_id:
                raise AuthError(502, 'provider_invalid_response')
            sub = identifier(info.get('id'))
        else:
            if token.get('state') != state:
                raise AuthError(502, 'provider_invalid_response')
            info = self.request('POST', p.info, data={'client_id': client.client_id, 'access_token': access})
            user = info.get('user')
            if not isinstance(user, dict):
                raise AuthError(502, 'provider_invalid_response')
            sub = identifier(user.get('user_id'))
            if sub != identifier(token.get('user_id')):
                raise AuthError(502, 'provider_invalid_response')
        # Email/name/username/phone/roles are deliberately not identity authority.
        return IdentityProof(p.name, p.issuer, sub)
