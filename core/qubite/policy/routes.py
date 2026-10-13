"""Policy metadata HTTP and a read-only WS probe; no domain data or provider calls."""
import asyncio
from urllib.parse import urlsplit
import re
from uuid import UUID

from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..identity.auth.http import credential, csrf_header, headers
from ..identity.auth.routes import AuthFault
from ..identity.auth.store import AuthError
from .models import Catalog, Decision, OwnAccess, PolicyCommand, Receipt, StreamCheck, Subscribe, Target
from .store import PolicyStore

HTTP_PATHS = {'/api/v1/me/access', '/api/v1/policy/check', '/api/v1/owner/policy', '/api/v1/owner/policy/commands'}
BODY_PATHS = {'/api/v1/policy/check', '/api/v1/owner/policy/commands'}
STREAM_PATH = '/api/v1/policy/stream'


def create_router(settings, clock=None):
    store = PolicyStore(settings, clock)
    router = APIRouter(tags=['policy'], responses={
        code: {'model': AuthFault} for code in (400, 401, 403, 409, 428, 429, 503, '4XX')})

    def session(request):
        kind, raw = credential(request.scope, settings)
        if kind != 'session': raise AuthError(401, 'unauthenticated')
        return raw

    def etag(response, result):
        response.headers['ETag'] = f'"policy-{result["revision"]}"'
        return result

    @router.get('/api/v1/me/access', response_model=OwnAccess, operation_id='policy_own_access')
    def access(request: Request, response: Response):
        return etag(response, store.own_access(session(request)))

    @router.get('/api/v1/owner/policy', response_model=Catalog, operation_id='policy_owner_catalog')
    def catalog(request: Request, response: Response):
        return etag(response, store.catalog(session(request)))

    @router.post('/api/v1/policy/check', response_model=Decision, operation_id='policy_check')
    def check(body: Target, request: Request):
        return store.check_session(session(request), body, csrf=csrf_header(request))

    @router.post('/api/v1/owner/policy/commands', response_model=Receipt, operation_id='policy_owner_command')
    def command(body: PolicyCommand, request: Request, response: Response):
        expected = headers(request.scope, 'if-match')
        identifier = headers(request.scope, 'idempotency-key')
        if not expected: raise AuthError(428, 'policy_precondition_required')
        if len(expected) != 1 or not re.fullmatch(r'"policy-[1-9][0-9]{0,17}"', expected[0]) or len(identifier) != 1:
            raise AuthError(400, 'invalid_request')
        try: command_id = UUID(identifier[0])
        except ValueError: raise AuthError(400, 'invalid_request') from None
        result = store.command(session(request), csrf_header(request), body, int(expected[0][8:-1]), command_id)
        return etag(response, result)

    @router.websocket(STREAM_PATH)
    async def stream(websocket: WebSocket):
        try:
            scope = websocket.scope
            if settings.auth_origin is None:
                raise AuthError(503, 'identity_unavailable')
            if (headers(scope, 'host') != [urlsplit(settings.auth_origin).netloc]
                    or headers(scope, 'origin') != [settings.auth_origin]
                    or scope.get('query_string') or headers(scope, 'sec-websocket-protocol')
                    or 'cross-site' in headers(scope, 'sec-fetch-site')):
                raise AuthError(403, 'forbidden')
            raw = session(websocket)
            # Validate cookie/session before accepting; CSRF in first frame, never URL.
            await asyncio.to_thread(store.own_access, raw)
            await websocket.accept()
            frame = await asyncio.wait_for(websocket.receive_text(), timeout=15)
            if len(frame.encode('utf-8')) > 4096: raise AuthError(400, 'invalid_request')
            subscription = Subscribe.model_validate_json(frame)
            if subscription.target.action != 'read': raise AuthError(403, 'forbidden')
            token = await asyncio.to_thread(store.issue_delegation, raw, subscription.target, 'ws', csrf=subscription.csrf_token)
            async def recheck():
                return await asyncio.to_thread(store.execute_delegated, token, 'ws', subscription.target,
                                               lambda db, receipt: receipt)
            await websocket.send_json(await recheck())
            while True:
                try:
                    frame = await asyncio.wait_for(websocket.receive_text(), timeout=1)
                except asyncio.TimeoutError:
                    await recheck()  # Close idle subscription after revoke too; no payload feed.
                    continue
                if len(frame.encode('utf-8')) > 4096: raise AuthError(400, 'invalid_request')
                StreamCheck.model_validate_json(frame)
                await websocket.send_json(await recheck())
        except WebSocketDisconnect:
            return
        except (ValidationError, asyncio.TimeoutError, UnicodeError, AuthError) as error:
            unavailable = isinstance(error, AuthError) and error.status == 503
            await websocket.close(code=1013 if unavailable else 1008,
                                  reason='unavailable' if unavailable else 'forbidden')

    return router
