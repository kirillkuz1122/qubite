from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import Field, StrictBool, StrictInt, StrictStr, model_validator
from ..identity.auth.routes import StrictModel
from ..policy.models import EntitlementCommand, AICommand, VisibilityCommand, ModuleCommand
from ..ai.models import BudgetLimit, Timezone, DispatchSettings


class AccountCommand(StrictModel):
    kind: Literal['account']
    subject_id: UUID
    blocked: StrictBool


class SessionsCommand(StrictModel):
    kind: Literal['revoke_sessions']
    subject_id: UUID


class RegistrationCommand(StrictModel):
    kind: Literal['registration']
    mode: Literal['disabled', 'invite', 'public']


Change = Annotated[EntitlementCommand | AICommand | VisibilityCommand | ModuleCommand |
                   BudgetLimit | Timezone | DispatchSettings | AccountCommand | SessionsCommand |
                   RegistrationCommand, Field(discriminator='kind')]


class Batch(StrictModel):
    changes: Annotated[list[Change], Field(min_length=1, max_length=32)]

    @model_validator(mode='after')
    def unique_targets(self):
        seen = set()
        for c in self.changes:
            key = (c.kind, *(str(getattr(c, k, '')) for k in
                            ('subject_id', 'module', 'action', 'provider', 'model', 'scope', 'key', 'period')))
            if key in seen:
                raise ValueError('Duplicate change')
            seen.add(key)
        return self


class UserPage(StrictModel):
    after: UUID | None = None
    search: Annotated[StrictStr, Field(max_length=160)] = ''


class BudgetQuery(StrictModel):
    scope: Literal['global', 'user', 'module', 'project', 'model']
    key: Annotated[StrictStr, Field(min_length=1, max_length=145)]


class AuditPage(StrictModel):
    before: UUID | None = None


class Receipt(StrictModel):
    id: UUID
    revision: StrictStr
    count: StrictInt


T=TypeVar('T')
class Metadata(StrictModel,Generic[T]):
    data: T


class ModuleInfo(StrictModel):
    id: str
    name: str
    visibility: Literal['hidden','locked']
    installed: bool
    enabled: bool
    released: bool


class RegistrationInfo(StrictModel):
    mode: Literal['disabled','invite','public']
    revision: int
    consent_version: str


class State(StrictModel):
    revision: str
    timezone: str
    timeout_seconds: int
    registration: RegistrationInfo
    now: datetime
    reauth_until: datetime | None
    modules: list[ModuleInfo]


class UserInfo(StrictModel):
    id: UUID
    email: str
    display_name: str | None
    status: Literal['pending','active','blocked']
    verified_at: datetime | None
    auth_version: int
    created_at: datetime
    platform_owner: bool


class Users(StrictModel):
    revision: str
    items: list[UserInfo]
    next: UUID | None


class GrantInfo(StrictModel):
    module: str
    action: Literal['read','write','manage','ai']
    effect: Literal['allow','deny']
    expires_at: datetime | None


class ModelGrantInfo(StrictModel):
    module: str
    provider: str
    model: str
    effect: Literal['allow','deny']
    expires_at: datetime | None


class Detail(StrictModel):
    revision: str
    subject_id: UUID
    grants: list[GrantInfo]
    models: list[ModelGrantInfo]
    more_models: bool


class BudgetInfo(StrictModel):
    period: Literal['day','month','all']
    usd_micro: int | None
    requests: int | None
    tokens: int | None
    spent_usd: int
    spent_requests: int
    spent_tokens: int
    reserved_usd: int
    reserved_requests: int
    reserved_tokens: int
    remaining_usd: int | None
    ends_at: datetime | None
    timezone: str


class Route(StrictModel):
    provider: str
    model: str


class Budget(StrictModel):
    revision: str
    scope: Literal['global','user','module','project','model']
    key: str
    items: list[BudgetInfo]
    freezes: list[Route]


class ReviewItem(StrictModel):
    change: Change
    current: list[str | int | bool | datetime | None] | None


class Review(StrictModel):
    revision: str
    items: list[ReviewItem]


class Event(StrictModel):
    id: UUID
    actor_id: UUID | None
    source: Literal['console','policy','budget','registration']
    changes: list[dict]
    created_at: datetime


class Audit(StrictModel):
    items: list[Event]
    next: UUID | None
