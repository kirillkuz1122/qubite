"""Narrow ASGI limits and strict credentials; never decode legacy percent cookies."""
from urllib.parse import urlsplit
import re

from starlette.responses import JSONResponse

from .store import AuthError
from .tokens import valid_token

PATHS = {'/api/v1/auth/csrf', '/api/v1/auth/session', '/api/v1/me',
         '/api/v1/auth/sessions', '/api/v1/auth/logout', '/api/v1/auth/logout-all', '/api/v1/auth/reauth'}
EMAIL_PATHS = {f'/api/v1/auth/email/{purpose}/{action}'
               for purpose in ('verify','reset') for action in ('request','confirm')}
POLICY_PATHS = {'/api/v1/me/access', '/api/v1/policy/check', '/api/v1/owner/policy', '/api/v1/owner/policy/commands',
                '/api/v1/me/modules', '/api/v1/owner/modules'}
POLICY_BODY_PATHS = {'/api/v1/policy/check', '/api/v1/owner/policy/commands'}
REGISTRATION_PATHS = {'/api/v1/auth/registration', '/api/v1/auth/register',
                      '/api/v1/owner/registration', '/api/v1/owner/registration/invites'}
REGISTRATION_BODY_PATHS = {'/api/v1/auth/register', '/api/v1/owner/registration',
                           '/api/v1/owner/registration/invites'}
PATHS |= EMAIL_PATHS | POLICY_PATHS | REGISTRATION_PATHS
LEGACY = {'qb_session', '__Host-qubite_search'}
ALL_COOKIES = LEGACY | {'__Host-qubite_session','__Host-qubite_preauth','qubite_local_session','qubite_local_preauth'}


def sensitive(path):
    return (path in PATHS or path.startswith('/api/v1/auth/sessions/')
            or path.startswith('/api/v1/me/modules/')
            or re.fullmatch(r'/api/v1/owner/registration/invites/[^/]+', path) is not None
            or path == '/api/v1/auth/oauth/providers'
            or re.fullmatch(r'/api/v1/auth/oauth/[^/]+/(start|callback)', path) is not None
            or path == '/api/v1/me/oauth' or re.fullmatch(r'/api/v1/me/oauth/[^/]+', path) is not None)


def headers(scope, name):
    return [v.decode('latin-1') for k,v in scope['headers'] if k.lower()==name.encode('ascii')]


def credential(scope, settings):
    cookie_headers = headers(scope,'cookie')
    auth = headers(scope,'authorization')
    if len(auth)>1 or sum(len(x) for x in cookie_headers)>4096 or any(len(x)>512 for x in auth):
        raise AuthError(400,'invalid_request')
    found = {}
    for header in cookie_headers:
        for part in header.split(';'):
            if not part.strip():
                continue
            name, sep, value = part.strip().partition('=')
            if not sep:
                raise AuthError(400,'invalid_request')
            if name in ALL_COOKIES:
                if name in found:
                    raise AuthError(400,'invalid_request')
                found[name]=value
    if auth and found:
        raise AuthError(400,'invalid_request')
    if auth:
        # AUTH-012/013 add typed bearer resolvers. Never use a web/refresh token as Bearer.
        raise AuthError(401,'unauthenticated')
    expected = {settings.session_cookie, settings.preauth_cookie}
    if set(found)-expected:
        raise AuthError(400 if set(found)&expected else 401,'invalid_request' if set(found)&expected else 'unauthenticated')
    if len(found)>1:
        raise AuthError(400,'invalid_request')
    if settings.session_cookie in found:
        value=found[settings.session_cookie]
        if not valid_token(value,'qbt_s_'):
            raise AuthError(401,'unauthenticated')
        return 'session', value
    if settings.preauth_cookie in found:
        value=found[settings.preauth_cookie]
        if not valid_token(value,'qbt_p_'):
            raise AuthError(401,'unauthenticated')
        return 'preauth', value
    return None, None


def csrf_header(request):
    values=headers(request.scope,'x-csrf-token')
    if len(values)!=1 or not valid_token(values[0],'qbt_c_'):
        raise AuthError(403,'csrf_failed')
    return values[0]


class AuthGuard:
    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope['type']!='http' or not sensitive(scope['path']):
            return await self.app(scope,receive,send)
        async def private_send(message):
            if message['type']=='http.response.start':
                message=dict(message)
                hs=[(k,v) for k,v in message['headers'] if k.lower()!=b'cache-control']
                message['headers']=hs+[(b'cache-control',b'no-store'),(b'referrer-policy',b'no-referrer'),(b'x-content-type-options',b'nosniff')]
            await send(message)
        try:
            if self.settings.auth_origin is None:
                raise AuthError(503,'identity_unavailable')
            host=headers(scope,'host'); origin=headers(scope,'origin')
            if len(host)!=1 or len(origin)>1:
                raise AuthError(400,'invalid_request')
            if host[0]!=urlsplit(self.settings.auth_origin).netloc:
                raise AuthError(403,'csrf_failed')
            callback = scope['method'] == 'GET' and re.fullmatch(r'/api/v1/auth/oauth/[^/]+/callback', scope['path']) is not None
            if scope.get('query_string') and not callback:
                raise AuthError(400,'invalid_request')
            if 'cross-site' in headers(scope,'sec-fetch-site') and not (callback and headers(scope,'sec-fetch-mode') == ['navigate']):
                raise AuthError(403,'csrf_failed')
            if origin and origin[0]!=self.settings.auth_origin:
                raise AuthError(403,'csrf_failed')
            mutation=scope['method'] in {'POST','DELETE','PUT','PATCH'}
            if mutation and origin!=[self.settings.auth_origin]:
                raise AuthError(403,'csrf_failed')
            if mutation:
                lengths=headers(scope,'content-length')
                if len(lengths)>1 or (lengths and (not re.fullmatch(r'[0-9]{1,10}',lengths[0]) or int(lengths[0])>8192)):
                    raise AuthError(400,'invalid_request')
                body=bytearray()
                while True:
                    message=await receive()
                    if message['type']=='http.disconnect':
                        return
                    body.extend(message.get('body',b''))
                    if len(body)>8192:
                        raise AuthError(400,'invalid_request')
                    if not message.get('more_body',False):
                        break
                content=headers(scope,'content-type')
                if body and (len(content)!=1 or content[0].split(';')[0].strip().lower()!='application/json'):
                    raise AuthError(400,'invalid_request')
                oauth_json = re.fullmatch(r'/api/v1/auth/oauth/[^/]+/start|/api/v1/me/oauth/[^/]+',scope['path']) is not None
                if body and scope['path'] not in {'/api/v1/auth/session','/api/v1/auth/reauth'} | EMAIL_PATHS | POLICY_BODY_PATHS | REGISTRATION_BODY_PATHS and not oauth_json:
                    raise AuthError(400,'invalid_request')
                async def replay():
                    return {'type':'http.request','body':bytes(body),'more_body':False}
                receive=replay
            await self.app(scope,receive,private_send)
        except AuthError as error:
            await JSONResponse({'code':error.code},status_code=error.status)(scope,receive,private_send)
