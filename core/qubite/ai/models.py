"""Exact integer USD accounting and internal, server-approved mock pricing."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, StrictInt, StrictStr, model_validator
from ..identity.auth.routes import StrictModel
from ..policy.models import Provider, Model

MAX = 10**12
Amount = Annotated[StrictInt, Field(ge=0, le=MAX)]
Positive = Annotated[StrictInt, Field(ge=1, le=MAX)]
Period = Literal['all', 'day', 'month']


class BudgetLimit(StrictModel):
    kind: Literal['limit'] = 'limit'
    scope: Literal['global', 'user', 'module', 'project', 'model']
    key: StrictStr
    period: Period
    usd_micro: Amount | None = None
    requests: Amount | None = None
    tokens: Amount | None = None

    @model_validator(mode='after')
    def dimensions(self):
        if all(v is None for v in (self.usd_micro, self.requests, self.tokens)):
            raise ValueError('At least one explicit cap is required')
        if self.scope == 'global' and self.key != '*':
            raise ValueError('Global key must be *')
        if not 1 <= len(self.key) <= 145:
            raise ValueError('Invalid scope key')
        if self.scope in {'user', 'project'} and str(UUID(self.key)) != self.key:
            raise ValueError('Canonical UUID required')
        if self.scope == 'model':
            from pydantic import TypeAdapter
            provider, model = self.key.split('/', 1)
            TypeAdapter(Provider).validate_python(provider)
            TypeAdapter(Model).validate_python(model)
        if self.scope == 'module':
            from pydantic import TypeAdapter
            from ..policy.models import Module
            TypeAdapter(Module).validate_python(self.key)
        return self


class Timezone(StrictModel):
    kind: Literal['timezone'] = 'timezone'
    name: StrictStr

    @model_validator(mode='after')
    def known_zone(self):
        if not 1 <= len(self.name) <= 100:
            raise ValueError('Invalid timezone')
        try: ZoneInfo(self.name)
        except (ZoneInfoNotFoundError, ValueError): raise ValueError('Unknown IANA timezone') from None
        return self


class BindProject(StrictModel):
    kind: Literal['bind_project'] = 'bind_project'
    resource_id: UUID
    project_id: UUID


class Price(StrictModel):
    kind: Literal['price'] = 'price'
    id: UUID
    provider: Literal['mock'] = 'mock'
    model: Model
    currency: Literal['USD'] = 'USD'
    input_per_million: Amount
    output_per_million: Amount
    fixed_usd_micro: Amount = 0
    max_input: Positive
    max_output: Positive
    expires_at: datetime

    @model_validator(mode='after')
    def aware(self):
        if self.expires_at.tzinfo is None:
            raise ValueError('Expiry must have a timezone')
        return self


class UsageBound(StrictModel):
    input_tokens: Amount
    max_output_tokens: Amount


class Usage(StrictModel):
    input_tokens: Amount
    output_tokens: Amount
    # Trusted mock billing evidence, not a browser-supplied cost.
    usd_micro: Amount


def quote(price: Price, bound: UsageBound) -> int:
    if bound.input_tokens > price.max_input or bound.max_output_tokens > price.max_output:
        raise ValueError('Usage upper bound exceeds approved price')
    def ceil_charge(tokens, rate): return (tokens * rate + 999_999) // 1_000_000
    cost = (ceil_charge(bound.input_tokens, price.input_per_million)
            + ceil_charge(bound.max_output_tokens, price.output_per_million) + price.fixed_usd_micro)
    if cost > MAX:
        raise ValueError('Cost exceeds bounded integer range')
    return cost


def boundaries(now: datetime, zone: str, period: str):
    local = now.astimezone(ZoneInfo(zone))
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == 'month':
        start = start.replace(day=1)
        end = start.replace(year=start.year+1, month=1) if start.month == 12 else start.replace(month=start.month+1)
    else:
        from datetime import timedelta
        end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)
