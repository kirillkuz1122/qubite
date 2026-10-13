"""POST-only email proofs; no raw proof, account existence or password in output."""
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import Field, StrictStr

from ..auth.http import credential, csrf_header
from ..auth.routes import AuthFault, StrictModel
from .store import ChallengeStore


class EmailRequest(StrictModel):
    email: StrictStr = Field(max_length=320,repr=False)


class Proof(StrictModel):
    challenge_id: UUID
    token: StrictStr = Field(max_length=64,repr=False)


class ResetProof(Proof):
    password: StrictStr = Field(max_length=256,repr=False)


class Accepted(StrictModel):
    code: str = 'request_accepted'


def create_router(settings,clock=None,transport=None):
    store=ChallengeStore(settings,clock,transport)
    router=APIRouter(tags=['identity'],responses={
        400:{'model':AuthFault},401:{'model':AuthFault},403:{'model':AuthFault},
        429:{'model':AuthFault},503:{'model':AuthFault},
        '4XX':{'model':AuthFault,'description':'Controlled error without input'}
    })

    def context(request):
        kind,raw=credential(request.scope,settings)
        return kind,raw,csrf_header(request),request.client.host

    def clear(response):
        # Never turn a possession proof into an authenticated session.
        for name in (settings.preauth_cookie,settings.session_cookie):
            response.delete_cookie(name,path='/',httponly=True,secure=not settings.auth_local_http,samesite='lax')

    @router.post('/api/v1/auth/email/verify/request',response_model=Accepted,status_code=202,operation_id='email_verify_request')
    def verify_request(body:EmailRequest,request:Request):
        store.request('verify',body.email,*context(request))
        return Accepted()

    @router.post('/api/v1/auth/email/reset/request',response_model=Accepted,status_code=202,operation_id='email_reset_request')
    def reset_request(body:EmailRequest,request:Request):
        store.request('reset',body.email,*context(request))
        return Accepted()

    @router.post('/api/v1/auth/email/verify/confirm',status_code=204,operation_id='email_verify_confirm')
    def verify_confirm(body:Proof,request:Request):
        store.confirm('verify',body.challenge_id,body.token,*context(request))
        response=Response(status_code=204); clear(response)
        return response

    @router.post('/api/v1/auth/email/reset/confirm',status_code=204,operation_id='email_reset_confirm')
    def reset_confirm(body:ResetProof,request:Request):
        store.confirm('reset',body.challenge_id,body.token,*context(request),password=body.password)
        response=Response(status_code=204); clear(response)
        return response

    return router
