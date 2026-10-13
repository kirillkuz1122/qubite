"""Registration and owner controls API; React screens are a separate task."""
from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import Field, StrictBool, StrictInt, StrictStr

from ..auth.http import credential, csrf_header, headers
from ..auth.routes import AuthFault, StrictModel
from ..auth.store import AuthError
from .store import RegistrationStore


class Register(StrictModel):
    email: StrictStr = Field(max_length=320, repr=False)
    password: StrictStr = Field(max_length=256, repr=False)
    display_name: StrictStr | None = Field(default=None, max_length=160, repr=False)
    consent_version: StrictStr = Field(min_length=1, max_length=80)
    consent_accepted: StrictBool
    invite_token: StrictStr | None = Field(default=None, max_length=64, repr=False)


class RegistrationAccepted(StrictModel):
    code: Literal['registration_accepted'] = 'registration_accepted'


class RegistrationConfig(StrictModel):
    mode: Literal['disabled','invite','public']
    revision: int
    consent_version: str


class Mode(StrictModel):
    mode: Literal['disabled','invite','public']


class Invite(StrictModel):
    email: StrictStr | None = Field(default=None, max_length=320, repr=False)
    ttl_seconds: StrictInt = Field(default=604800, ge=60, le=604800)


class IssuedInvite(StrictModel):
    id: UUID
    token: str = Field(repr=False)
    email: str | None = Field(repr=False)
    expires_at: datetime


class InviteMetadata(StrictModel):
    id: UUID
    email: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    redeemed_at: datetime | None


class Invites(StrictModel):
    items: list[InviteMetadata]


def create_router(settings, clock=None, transport=None):
    store = RegistrationStore(settings, clock, transport)
    router = APIRouter(tags=['registration'], responses={
        400: {'model': AuthFault},
        '4XX': {'model': AuthFault, 'description': 'Controlled client error; no submitted values'},
        503: {'model': AuthFault}})

    def cookie(request, expected):
        kind, raw = credential(request.scope, settings)
        if kind != expected:
            raise AuthError(401 if expected == 'session' else 403,
                            'unauthenticated' if expected == 'session' else 'csrf_failed')
        return raw

    def etag(response, result):
        response.headers['ETag'] = '"registration-' + str(result['revision']) + '"'
        return result

    @router.get('/api/v1/auth/registration', response_model=RegistrationConfig, operation_id='registration_config')
    def config(request: Request, response: Response):
        credential(request.scope, settings)
        return etag(response, store.config())

    @router.post('/api/v1/auth/register', response_model=RegistrationAccepted, status_code=202, operation_id='registration_create')
    def register(body: Register, request: Request, response: Response):
        store.register(body, cookie(request, 'preauth'), csrf_header(request), request.client.host)
        response.delete_cookie(settings.preauth_cookie, path='/', httponly=True,
                               secure=not settings.auth_local_http, samesite='lax')
        return RegistrationAccepted()

    @router.get('/api/v1/owner/registration', response_model=RegistrationConfig, operation_id='owner_registration_config')
    def owner_config(request: Request, response: Response):
        return etag(response, store.owner_config(cookie(request, 'session')))

    @router.put('/api/v1/owner/registration', response_model=RegistrationConfig, operation_id='owner_registration_mode')
    def mode(body: Mode, request: Request, response: Response):
        values = headers(request.scope, 'if-match')
        match = re.fullmatch(r'"registration-([1-9][0-9]{0,17})"', values[0]) if len(values) == 1 else None
        if not match:
            raise AuthError(428, 'precondition_required')
        return etag(response, store.set_mode(cookie(request, 'session'), csrf_header(request), body.mode, int(match[1])))

    @router.get('/api/v1/owner/registration/invites', response_model=Invites, operation_id='owner_registration_invites')
    def invites(request: Request):
        return store.invites(cookie(request, 'session'))

    @router.post('/api/v1/owner/registration/invites', response_model=IssuedInvite, status_code=201, operation_id='owner_registration_invite')
    def invite(body: Invite, request: Request):
        raw = cookie(request, 'session'); csrf = csrf_header(request)
        values = headers(request.scope, 'idempotency-key')
        try:
            iid = UUID(values[0]) if len(values) == 1 and len(values[0]) == 36 else None
        except ValueError:
            iid = None
        if iid is None:
            raise AuthError(400, 'idempotency_required')
        return store.create_invite(raw, csrf, body.email, body.ttl_seconds, iid)

    @router.delete('/api/v1/owner/registration/invites/{invite_id}', status_code=204, operation_id='owner_registration_revoke')
    def revoke(invite_id: UUID, request: Request):
        store.revoke(cookie(request, 'session'), csrf_header(request), invite_id)
        return Response(status_code=204)

    return router
