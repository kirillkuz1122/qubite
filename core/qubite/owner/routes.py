import re
from uuid import UUID

from fastapi import APIRouter, Request, Response

from ..identity.auth.http import credential, csrf_header, headers
from ..identity.auth.routes import AuthFault
from ..identity.auth.store import AuthError
from .models import Batch, UserPage, BudgetQuery, AuditPage, Metadata, Receipt, State, Users, Detail, Budget, Review, Audit
from .store import OwnerStore


def create_router(settings, clock=None):
    store=OwnerStore(settings,clock)
    router=APIRouter(prefix='/api/v1/owner/console',tags=['owner'],responses={
        code:{'model':AuthFault} for code in (400,401,403,404,409,428,429,503)})

    def session(request):
        kind,raw=credential(request.scope,settings)
        if kind!='session': raise AuthError(401,'unauthenticated')
        return raw

    def metadata(response,result):
        if 'revision' in result: response.headers['ETag']='"'+result['revision']+'"'
        return dict(data=result)

    @router.get('',response_model=Metadata[State],operation_id='owner_console_state')
    def state(request:Request,response:Response):
        return metadata(response,store.state(session(request)))

    @router.post('/users',response_model=Metadata[Users],operation_id='owner_console_users')
    def users(body:UserPage,request:Request,response:Response):
        return metadata(response,store.users(session(request),csrf_header(request),body))

    @router.get('/users/{subject_id}',response_model=Metadata[Detail],operation_id='owner_console_user')
    def user(subject_id:UUID,request:Request,response:Response):
        return metadata(response,store.user(session(request),subject_id))

    @router.post('/budget',response_model=Metadata[Budget],operation_id='owner_console_budget')
    def budget(body:BudgetQuery,request:Request,response:Response):
        return metadata(response,store.budget(session(request),csrf_header(request),body))

    @router.post('/audit',response_model=Metadata[Audit],operation_id='owner_console_audit')
    def audit(body:AuditPage,request:Request,response:Response):
        return metadata(response,store.audit(session(request),csrf_header(request),body))

    @router.post('/review',response_model=Metadata[Review],operation_id='owner_console_review')
    def review(body:Batch,request:Request,response:Response):
        return metadata(response,store.review(session(request),csrf_header(request),body))

    @router.get('/receipts/{identifier}',response_model=Receipt,operation_id='owner_console_receipt')
    def receipt(identifier:UUID,request:Request):
        return store.receipt(session(request),identifier)

    @router.post('/commands',response_model=Receipt,operation_id='owner_console_apply')
    def apply(body:Batch,request:Request,response:Response):
        match=headers(request.scope,'if-match'); ids=headers(request.scope,'idempotency-key')
        if not match: raise AuthError(428,'precondition_required')
        if len(match)!=1 or not re.fullmatch(r'"owner-[1-9][0-9]{0,17}-[1-9][0-9]{0,17}-[1-9][0-9]{0,17}"',match[0]):
            raise AuthError(400,'invalid_request')
        try:
            if len(ids)!=1 or len(ids[0])!=36: raise ValueError()
            identifier=UUID(ids[0])
        except ValueError: raise AuthError(400,'idempotency_required') from None
        result=store.apply(session(request),csrf_header(request),body,match[0][1:-1],identifier)
        response.headers['ETag']='"'+result['revision']+'"'
        return result

    return router
