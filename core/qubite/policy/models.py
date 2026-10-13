"""Strict policy metadata contracts; no actor, role or budget claims in checks."""
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, StrictBool, StrictInt, StrictStr, model_validator
from ..identity.auth.routes import StrictModel

Action = Literal['read', 'write', 'manage', 'ai']
Effect = Literal['allow', 'deny']
Module = Annotated[StrictStr, Field(pattern=r'^[a-z][a-z0-9_]{0,31}$')]
Provider = Annotated[StrictStr, Field(pattern=r'^[a-z][a-z0-9_-]{0,47}$')]
Model = Annotated[StrictStr, Field(pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$')]


class Target(StrictModel):
    module: Module
    action: Action
    workspace_id: UUID
    resource_id: UUID
    provider: Provider | None = None
    model: Model | None = None

    @model_validator(mode='after')
    def ai_target(self):
        if (self.action == 'ai') != (self.provider is not None and self.model is not None):
            raise ValueError('AI requires an exact provider/model')
        if self.action != 'ai' and (self.provider is not None or self.model is not None):
            raise ValueError('Unexpected provider/model')
        return self


class Command(StrictModel):
    reason: Literal['grant', 'revoke', 'configure', 'create', 'manual']


class ModuleCommand(Command):
    kind: Literal['module']
    module: Module
    enabled: StrictBool


class Expiring(Command):
    expires_at: datetime | None = None

    @model_validator(mode='after')
    def aware_expiry(self):
        if self.expires_at is not None and self.expires_at.tzinfo is None:
            raise ValueError('Expiry must have a timezone')
        return self


class EntitlementCommand(Expiring):
    kind: Literal['entitlement']
    module: Module
    subject_id: UUID
    action: Action
    effect: Effect


class WorkspaceCommand(Command):
    kind: Literal['workspace']
    workspace_id: UUID
    owner_id: UUID


class MembershipCommand(Expiring):
    kind: Literal['membership']
    workspace_id: UUID
    subject_id: UUID
    role: Literal['viewer', 'editor', 'manager', 'organizer', 'moderator', 'admin']
    enabled: StrictBool


class ResourceCommand(Command):
    kind: Literal['resource']
    resource_id: UUID
    workspace_id: UUID
    module: Module


class ACLCommand(Expiring):
    kind: Literal['acl']
    resource_id: UUID
    subject_id: UUID
    action: Action
    effect: Effect


class AICommand(Expiring):
    kind: Literal['ai_grant']
    module: Module
    subject_id: UUID
    provider: Provider
    model: Model
    effect: Effect


PolicyCommand = Annotated[ModuleCommand | EntitlementCommand | WorkspaceCommand | MembershipCommand |
                          ResourceCommand | ACLCommand | AICommand, Field(discriminator='kind')]


class Receipt(StrictModel):
    revision: StrictInt


class Decision(Receipt):
    allowed: Literal[True] = True


class ModuleState(StrictModel):
    module: str
    installed: bool
    enabled: bool


class Catalog(Receipt):
    items: list[ModuleState]


class AccessItem(StrictModel):
    module: str
    action: Action
    expires_at: datetime | None


class OwnAccess(Receipt):
    items: list[AccessItem]


class Subscribe(StrictModel):
    csrf_token: StrictStr = Field(repr=False)
    target: Target


class StreamCheck(StrictModel):
    type: Literal['check']
