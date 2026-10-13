"""Real web-session routes. A profile/owner flag grants no module or AI access."""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr

from .http import credential, csrf_header
from .store import AuthError, AuthStore


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AuthFault(StrictModel):
    code: str


class Login(StrictModel):
    email: StrictStr = Field(repr=False)
    password: StrictStr = Field(repr=False)


class Reauth(StrictModel):
    password: StrictStr = Field(repr=False)


class Profile(StrictModel):
    id: UUID
    email: str
    display_name: str | None
    platform_owner: bool


class SessionMetadata(StrictModel):
    id: UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    absolute_expires_at: datetime
    current: bool


class SessionResult(StrictModel):
    subject: Profile
    session: SessionMetadata


class SessionList(StrictModel):
    items: list[SessionMetadata]


class CSRF(StrictModel):
    csrf_token: str


def create_router(settings, clock=None):
    store=AuthStore(settings,clock)
    router=APIRouter(tags=['identity'], responses={
        400:{'model':AuthFault},401:{'model':AuthFault},403:{'model':AuthFault},
        404:{'model':AuthFault},429:{'model':AuthFault},503:{'model':AuthFault},
        '4XX':{'model':AuthFault, 'description':'Controlled client error; validation never includes input'}
    })

    def cookies(request, expected):
        kind, raw=credential(request.scope,settings)
        if kind!=expected:
            raise AuthError(401 if expected=='session' else 403,'unauthenticated' if expected=='session' else 'csrf_failed')
        return raw

    def set_cookie(response, name, value, max_age):
        response.set_cookie(name,value,max_age=max_age,httponly=True,secure=not settings.auth_local_http,
                            samesite='lax',path='/')

    def clear_cookie(response,name):
        response.delete_cookie(name,path='/',httponly=True,secure=not settings.auth_local_http,samesite='lax')

    @router.get('/api/v1/auth/csrf',response_model=CSRF,operation_id='auth_csrf')
    def csrf(request:Request,response:Response):
        kind,raw=credential(request.scope,settings)
        if kind=='session':
            token=store.authenticated(raw,action='csrf')
        else:
            token=store.preauth_csrf(raw) if kind=='preauth' else None
            if token is None:
                raw,token=store.new_preauth(request.client.host)
                set_cookie(response,settings.preauth_cookie,raw,300)
        return {'csrf_token':token}

    @router.post('/api/v1/auth/session',response_model=SessionResult,operation_id='auth_login')
    def login(body:Login,request:Request,response:Response):
        raw=cookies(request,'preauth'); nonce=csrf_header(request)
        token,result=store.login(body.email,body.password,raw,nonce,request.client.host)
        set_cookie(response,settings.session_cookie,token,2592000)
        clear_cookie(response,settings.preauth_cookie)
        return result

    @router.get('/api/v1/me',response_model=Profile,operation_id='auth_profile')
    def me(request:Request):
        return store.authenticated(cookies(request,'session'))

    @router.get('/api/v1/auth/sessions',response_model=SessionList,operation_id='auth_sessions')
    def sessions(request:Request):
        return store.authenticated(cookies(request,'session'),action='sessions')

    @router.delete('/api/v1/auth/sessions/{session_id}',status_code=204,operation_id='auth_revoke_session')
    def revoke(session_id:UUID,request:Request):
        current=store.authenticated(cookies(request,'session'),csrf=csrf_header(request),action='revoke',target=session_id)
        response=Response(status_code=204)
        if current:
            clear_cookie(response,settings.session_cookie)
        return response

    @router.post('/api/v1/auth/logout',status_code=204,operation_id='auth_logout')
    def logout(request:Request):
        store.authenticated(cookies(request,'session'),csrf=csrf_header(request),action='logout')
        response=Response(status_code=204)
        clear_cookie(response,settings.session_cookie)
        return response

    @router.post('/api/v1/auth/logout-all',status_code=204,operation_id='auth_logout_all')
    def logout_all(request:Request):
        store.authenticated(cookies(request,'session'),csrf=csrf_header(request),action='logout-all')
        response=Response(status_code=204)
        clear_cookie(response,settings.session_cookie)
        return response

    @router.post('/api/v1/auth/reauth',status_code=204,operation_id='auth_reauth')
    def reauth(body:Reauth,request:Request):
        store.reauth(cookies(request,'session'),csrf_header(request),body.password,request.client.host)
        return Response(status_code=204)

    return router
