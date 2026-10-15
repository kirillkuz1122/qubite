"""Deterministic in-process provider. No HTTP client, keys, URLs or external calls."""
import asyncio
from dataclasses import dataclass

from .models import Usage


@dataclass(frozen=True)
class NotSent:
    retryable: bool = True


@dataclass(frozen=True)
class Success:
    usage: Usage


class MockProvider:
    __slots__ = ('steps','usage','delay','calls','deliveries')

    def __init__(self, steps=('success',), *, usage=None, delay=0):
        if (not isinstance(steps, tuple) or not steps or len(steps)>3
                or any(s not in {'success','not_sent','unavailable','timeout','unknown','error'} for s in steps)
                or type(delay) not in {int,float} or not 0 <= delay <= 5):
            raise ValueError('Invalid mock script')
        self.steps = steps
        self.usage = usage or Usage(input_tokens=2,output_tokens=1,usd_micro=400_000)
        self.delay = delay
        self.calls = 0
        self.deliveries = 0

    async def send(self, ticket, payload):
        step = self.steps[min(self.calls,len(self.steps)-1)]
        self.calls += 1
        if step in {'not_sent','unavailable'}:
            return NotSent(retryable=step=='not_sent')
        self.deliveries += 1
        if step=='timeout': await asyncio.sleep(ticket.timeout_seconds+1)
        if self.delay: await asyncio.sleep(self.delay)
        if step=='error': raise RuntimeError('Synthetic unclassified failure')
        if step=='unknown': return None
        return Success(self.usage)
