"""OAuth HTTP contract. Provider proof is obtained server-side, never from JSON."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import Field, StrictStr

from ..auth.http import credential, csrf_header, headers
from ..auth.routes import AuthFault, Reauth, SessionResult, StrictModel
from ..auth.store import AuthError
from ..auth.tokens import valid_token
from .store import OAuthStore

ProviderName = Literal['google', 'yandex', 'vk', 'telegram']


class Start(StrictModel):
    intent: Literal['login', 'link']
    password: StrictStr | None = Field(default=None, repr=False)


class Authorization(StrictModel):
    authorization_url: str


class ProviderStatus(StrictModel):
    provider: ProviderName
    available: bool


class ProviderList(StrictModel):
    items: list[ProviderStatus]


class Linked(StrictModel):
    provider: ProviderName
    linked_at: datetime


class LinkedList(StrictModel):
    items: list[Linked]


def browser_cookie(request, settings):
    values = {}
    for header in headers(request.scope, 'cookie'):
        for part in header.split(';'):
            name, sep, value = part.strip().partition('=')
            if name in {'__Host-qubite_oauth', 'qubite_local_oauth'}:
                if not sep or name in values:
                    raise AuthError(400, 'invalid_request')
                values[name] = value
    if set(values) - {settings.oauth_cookie}:
        raise AuthError(401, 'unauthenticated')
    value = values.get(settings.oauth_cookie)
    if not valid_token(value, 'qbt_f_'):
        raise AuthError(403, 'oauth_state_failed')
    return value


def create_router(settings, clock=None, exchange=None):
    store = OAuthStore(settings, clock, exchange)
    router = APIRouter(tags=['oauth'], responses={
        c: {'model': AuthFault} for c in (400, 401, 403, 404, 409, 429, 502, 503, '4XX')})

    @router.get('/api/v1/auth/oauth/providers', response_model=ProviderList, operation_id='oauth_providers')
    def providers():
        return store.providers()

    @router.post('/api/v1/auth/oauth/{provider}/start', response_model=Authorization, operation_id='oauth_start')
    def start(provider: ProviderName, body: Start, request: Request, response: Response):
        kind, raw = credential(request.scope, settings)
        if kind != ('session' if body.intent == 'link' else 'preauth'):
            raise AuthError(403, 'csrf_failed')
        browser, result = store.start(provider, body.intent, raw, csrf_header(request), body.password, request.client.host)
        response.set_cookie(settings.oauth_cookie, browser, max_age=300, httponly=True,
                            secure=not settings.auth_local_http, samesite='lax', path='/')
        return result

    @router.get('/api/v1/auth/oauth/{provider}/callback', response_model=SessionResult,
                responses={204: {'description': 'Identity linked; no new session'},
                           303: {'description': 'Browser navigation only: fixed same-origin completion route, no credentials'}}, operation_id='oauth_callback')
    def callback(provider: ProviderName, request: Request, response: Response):
        html = (headers(request.scope, 'sec-fetch-mode') == ['navigate']
                and any('text/html' in value for value in headers(request.scope, 'accept')))
        try:
            # Queries exist only here. Never accept a caller-selected return target.
            pairs = request.query_params.multi_items()
            query = dict(pairs)
            allowed = {'code', 'state', 'device_id', 'error', 'error_description', 'iss'}
            if (len(request.scope.get('query_string', b'')) > 4096 or len(pairs) != len(query)
                    or set(query) - allowed or 'state' not in query or ('code' in query) == ('error' in query)
                    or any(not v or len(v) > 1024 or not all(32 <= ord(c) < 127 for c in v) for v in query.values())
                    or ('device_id' in query and (provider != 'vk' or len(query['device_id']) > 128))):
                raise AuthError(400, 'invalid_request')
            from .providers import provider as definition
            if query.get('iss', definition(provider).issuer) != definition(provider).issuer:
                raise AuthError(403, 'oauth_state_failed')
            kind, raw = credential(request.scope, settings)
            token, result = store.complete(provider, query['state'], browser_cookie(request, settings), raw, kind,
                query.get('code'), query.get('device_id'), query.get('error'), request.client.host)
        except AuthError as error:
            if not html:
                raise
            safe = error.code if error.code in {
                'oauth_identity_unlinked', 'oauth_identity_conflict', 'oauth_context_changed',
                'oauth_state_failed', 'provider_denied', 'provider_disabled', 'provider_not_configured',
                'provider_invalid_response', 'rate_limited', 'identity_unavailable'
            } else 'oauth_state_failed'
            response = RedirectResponse('/#/auth/login?error=' + safe, status_code=303)
            response.delete_cookie(settings.oauth_cookie, path='/', httponly=True,
                                   secure=not settings.auth_local_http, samesite='lax')
            return response
        if html:
            response = RedirectResponse('/#/auth/complete' if token is not None else '/#/auth/linked', status_code=303)
        response.delete_cookie(settings.oauth_cookie, path='/', httponly=True,
                               secure=not settings.auth_local_http, samesite='lax')
        if token is None:
            if not html:
                response.status_code = 204
            return response
        response.set_cookie(settings.session_cookie, token, max_age=2592000, httponly=True,
                            secure=not settings.auth_local_http, samesite='lax', path='/')
        response.delete_cookie(settings.preauth_cookie, path='/', httponly=True,
                               secure=not settings.auth_local_http, samesite='lax')
        return response if html else result

    @router.get('/api/v1/me/oauth', response_model=LinkedList, operation_id='oauth_identities')
    def identities(request: Request):
        kind, raw = credential(request.scope, settings)
        if kind != 'session':
            raise AuthError(401, 'unauthenticated')
        return store.identities(raw)

    @router.delete('/api/v1/me/oauth/{provider}', status_code=204, operation_id='oauth_unlink')
    def unlink(provider: ProviderName, body: Reauth, request: Request):
        kind, raw = credential(request.scope, settings)
        if kind != 'session':
            raise AuthError(401, 'unauthenticated')
        store.unlink(provider,raw,csrf_header(request),body.password,request.client.host)
        response = Response(status_code=204)
        response.delete_cookie(settings.session_cookie, path='/', httponly=True,
                               secure=not settings.auth_local_http, samesite='lax')
        return response

    return router
