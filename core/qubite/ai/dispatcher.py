"""Bounded, durable MOCK dispatcher. No startup worker or public/provider API.

Claim is scheduling, not authorization. Arm rechecks the originating session and
commits sending intent before handing off to the sealed mock adapter. No DB lock
spans provider await. Uncertain delivery is never automatically replayed.
"""
import asyncio
from dataclasses import dataclass
from datetime import timedelta
import hashlib
import hmac
from uuid import UUID, uuid4

from .budgets import BudgetStore, fingerprint, identifier, validated
from .models import Price, UsageBound, Usage, quote
from .mock import MockProvider, NotSent, Success
from ..identity.auth.store import AuthError, database
from ..policy.models import Target


@dataclass(frozen=True)
class Claim:
    invocation_id: UUID
    token: UUID


@dataclass(frozen=True)
class Ticket:
    claim: Claim
    number: int
    provider_request_id: UUID
    timeout_seconds: int


class Dispatcher(BudgetStore):
    @staticmethod
    def _job(db, invocation):
        row = db.execute('''SELECT status,lease_token,lease_until,attempts,next_attempt_at,expires_at,timeout_seconds,reason
            FROM qubite_core.ai_dispatch_jobs WHERE invocation_id=%s FOR UPDATE''', (invocation,)).fetchone()
        if not row: raise AuthError(503,'dispatch_unavailable')
        return row

    def status(self, invocation):
        """Internal metadata only; an eventual Console endpoint must add owner/user auth."""
        identifier(invocation)
        with database(self.settings) as db:
            self._lock(db);self._budget_lock(db)
            row=self._invocation(db,invocation);job=self._job(db,invocation)
            return {**self._receipt(row),'status':job[0],'attempts':job[3], 'reason':job[7],
                    'timeout_seconds':job[6], 'manual_choice_required':job[7] in {'provider_unavailable','retries_exhausted','not_sent_after_unknown'}}

    def claim(self, invocation=None):
        if invocation is not None:identifier(invocation)
        with database(self.settings) as db:
            self._lock(db);self._budget_lock(db);now=self._now()
            row=db.execute('''SELECT i.id FROM qubite_core.ai_budget_invocations i
                JOIN qubite_core.ai_dispatch_jobs j ON j.invocation_id=i.id
                WHERE (%s::uuid IS NULL OR i.id=%s) AND i.state IN ('reserved','dispatched') AND
                ((j.status IN ('queued','retry_wait') AND j.next_attempt_at<=%s)
                  OR (j.status='leased' AND j.lease_until<=%s))
                ORDER BY j.next_attempt_at,i.id LIMIT 1 FOR UPDATE OF i SKIP LOCKED''',
                (invocation,invocation,now,now)).fetchone()
            if not row:return None
            job=self._job(db,row[0]);token=uuid4()
            db.execute('''UPDATE qubite_core.ai_dispatch_jobs SET status='leased',lease_token=%s,lease_until=%s
                WHERE invocation_id=%s''',(token,now+timedelta(seconds=job[6]+15),row[0]))
            return Claim(row[0],token)

    def _event_locked(self, db, row, kind, *, provider_request_id=None, usage=None, proof=False):
        # Fresh internal UUID cannot collide with a caller's replay key. The invocation
        # is already locked; no public event lock is acquired after it.
        data=dict(provider_request_id=str(provider_request_id) if provider_request_id else None,
                  usage=usage.model_dump() if usage else None)
        return self._apply_record(db,row,uuid4(),kind,data,provider_request_id,usage,proven_not_sent=proof)

    def _release(self, db, row, reason):
        self._event_locked(db,row,'released',proof=row[1]!='reserved')
        db.execute("UPDATE qubite_core.ai_dispatch_jobs SET reason=%s WHERE invocation_id=%s",(reason,row[0]))

    def _origin(self, db, invocation):
        origin=db.execute('SELECT subject_id,session_id,created_at FROM qubite_core.ai_budget_invocations WHERE id=%s',
                          (invocation,)).fetchone()
        if not origin:raise AuthError(404,'budget_not_found')
        subject=self._subject(db,origin[0])
        session=db.execute('''SELECT subject_id,auth_version,revoked_at,expires_at,absolute_expires_at
            FROM qubite_core.sessions WHERE id=%s FOR UPDATE''',(origin[1],)).fetchone()
        now=self._now()
        if now<origin[2]:raise AuthError(503,'budget_clock_invalid')
        if (not session or session[0]!=subject['id'] or session[1]!=subject['auth_version']
                or session[2] is not None or now>=min(session[3],session[4])):
            raise AuthError(401,'unauthenticated')
        return subject

    def _live(self, db, row, subject, revision, budget_revision):
        target=Target.model_validate(row[5])
        if target.provider!='mock' or target.action!='ai':raise AuthError(403,'dispatch_provider_forbidden')
        self._authorize_permissions(db,subject,target)
        previous=db.execute('SELECT policy_revision,budget_revision FROM qubite_core.ai_budget_invocations WHERE id=%s',
                            (row[0],)).fetchone()
        if previous!=(revision,budget_revision):raise AuthError(403,'dispatch_policy_changed')
        if db.execute('SELECT 1 FROM qubite_core.ai_budget_freezes WHERE provider=%s AND model=%s',
                      (target.provider,target.model)).fetchone():raise AuthError(403,'budget_route_frozen')
        price=db.execute('SELECT snapshot FROM qubite_core.ai_budget_prices WHERE id=%s',(row[6],)).fetchone()
        try:
            price=Price.model_validate(price[0]) if price else None
            if not price or price.id!=row[6] or price.model!=target.model or price.expires_at<=self._now():raise ValueError()
            if quote(price,UsageBound.model_validate(row[7]))!=row[2]:raise ValueError()
        except ValueError:raise AuthError(403,'budget_price_unavailable') from None
        mandatory=db.execute('''SELECT a.scope,l.usd_micro FROM qubite_core.ai_budget_accounts a
            LEFT JOIN qubite_core.ai_budget_limits l ON l.account_id=a.id AND l.period='all'
            WHERE (a.scope='global' AND a.key='*') OR (a.scope='user' AND a.key=%s)''',
            (str(subject['id']),)).fetchall()
        if len(mandatory)!=2 or any(r[1] is None for r in mandatory):raise AuthError(403,'budget_missing')
        # Current ledger already includes this reservation: never add it a second time.
        rows=db.execute('''SELECT b.id,b.account_id,b.period,b.spent_usd,b.reserved_usd,b.spent_requests,
            b.reserved_requests,b.spent_tokens,b.reserved_tokens,l.usd_micro,l.requests,l.tokens
            FROM qubite_core.ai_budget_buckets b JOIN qubite_core.ai_budget_allocations a ON a.bucket_id=b.id
            LEFT JOIN qubite_core.ai_budget_limits l ON l.account_id=b.account_id AND l.period=b.period
            WHERE a.invocation_id=%s ORDER BY b.id FOR UPDATE OF b''',(row[0],)).fetchall()
        if not rows:raise AuthError(403,'budget_missing')
        for b in rows:
            carry=db.execute('''SELECT COALESCE(sum(reserved_usd),0),COALESCE(sum(reserved_requests),0),
                COALESCE(sum(reserved_tokens),0) FROM qubite_core.ai_budget_buckets
                WHERE account_id=%s AND period=%s AND id<>%s''',(b[1],b[2],b[0])).fetchone()
            for cap,spent,held,old in zip(b[9:],b[3:9:2],b[4:9:2],carry):
                if cap is not None and (cap==0 or spent+held+old>cap):raise AuthError(403,'budget_exhausted')

    def arm(self, claim, payload):
        """Commit at-most-once sending intent; only Dispatcher.run consumes the ticket."""
        if not isinstance(claim,Claim):raise AuthError(400,'invalid_dispatch_claim')
        identifier(claim.invocation_id);identifier(claim.token)
        if type(payload) is not bytes or not 1<=len(payload)<=65536:raise AuthError(400,'invalid_dispatch_payload')
        with database(self.settings) as db:
            revision=self._lock(db)
            # Auth locks before invocation locks, as in reserve/logout-all. Invalid
            # origin is remembered so a definitely unsubmitted reservation can close.
            subject=None;denial=None
            try:subject=self._origin(db,claim.invocation_id)
            except AuthError as error:
                if error.status not in {401,403}:raise
                denial=error.code
            budget_revision,_=self._budget_lock(db)
            row=self._invocation(db,claim.invocation_id)
            self._key_lock(db,('route/'+row[5]['provider']+'/'+row[5]['model']).encode())
            job=self._job(db,row[0]);now=self._now()
            if job[0]!='leased' or job[1]!=claim.token or job[2]<=now:
                raise AuthError(409,'dispatch_stale_claim')
            data=dict(target=row[5],price=str(row[6]),bound=row[7],payload_hash=hashlib.sha256(payload).hexdigest())
            saved=db.execute('SELECT fingerprint FROM qubite_core.ai_budget_invocations WHERE id=%s',(row[0],)).fetchone()[0]
            if not hmac.compare_digest(bytes(saved),fingerprint(data)):raise AuthError(409,'dispatch_payload_mismatch')
            if now>=job[5]:denial='queue_expired'
            if denial is None:
                try:self._live(db,row,subject,revision,budget_revision)
                except (AuthError,ValueError) as error:
                    if isinstance(error,AuthError) and error.status not in {400,401,403}:raise
                    denial=error.code if isinstance(error,AuthError) else 'invalid_dispatch_target'
            if denial:
                self._release(db,row,denial)
                return None
            if job[3]>=3:
                self._release(db,row,'retries_exhausted');return None
            number=job[3]+1
            # Stable logical provider request ID across proven-not-sent retries.
            request=db.execute('SELECT provider_request_id FROM qubite_core.ai_budget_invocations WHERE id=%s',(row[0],)).fetchone()[0]
            request=request or uuid4()
            self._event_locked(db,row,'dispatched',provider_request_id=request)
            db.execute('''INSERT INTO qubite_core.ai_dispatch_attempts VALUES(%s,%s,%s,%s,'sending',%s,%s,NULL)''',
                       (row[0],number,claim.token,uuid4(),now,now+timedelta(seconds=job[6])))
            db.execute('''UPDATE qubite_core.ai_dispatch_jobs SET status='sending',attempts=%s,
                lease_until=%s,reason=NULL WHERE invocation_id=%s''',(number,now+timedelta(seconds=job[6]+15),row[0]))
            return Ticket(claim,number,request,job[6])

    def finish(self, ticket, result):
        """Trusted mock response/reconciliation. Never invokes a provider."""
        if not isinstance(ticket,Ticket):raise AuthError(400,'invalid_dispatch_ticket')
        if result is not None and type(result) not in {NotSent,Success}:raise AuthError(400,'invalid_mock_result')
        if type(result) is NotSent and type(result.retryable) is not bool:raise AuthError(400,'invalid_mock_result')
        usage=validated(result.usage,Usage) if type(result) is Success else None
        with database(self.settings) as db:
            self._lock(db);self._budget_lock(db)
            row=self._invocation(db,ticket.claim.invocation_id)
            self._key_lock(db,('route/'+row[5]['provider']+'/'+row[5]['model']).encode())
            job=self._job(db,row[0]);now=self._now()
            attempt=db.execute('''SELECT state FROM qubite_core.ai_dispatch_attempts
                WHERE invocation_id=%s AND number=%s AND lease_token=%s FOR UPDATE''',
                (row[0],ticket.number,ticket.claim.token)).fetchone()
            if not attempt:raise AuthError(409,'dispatch_stale_claim')
            if attempt[0]=='not_sent' and type(result) is NotSent:return self._receipt(row)
            if row[1] in {'released','settled'}:
                if usage and row[4]!=usage.model_dump():raise AuthError(409,'budget_conflict')
                return self._receipt(row)
            if job[1]!=ticket.claim.token or job[0] not in {'sending','unknown'}:
                raise AuthError(409,'dispatch_stale_claim')
            if type(result) is NotSent:
                was_unknown=job[0]=='unknown'
                db.execute("UPDATE qubite_core.ai_dispatch_attempts SET state='not_sent',finished_at=%s WHERE invocation_id=%s AND number=%s",(now,row[0],ticket.number))
                if not was_unknown and result.retryable and ticket.number<3 and now<job[5]:
                    db.execute('''UPDATE qubite_core.ai_dispatch_jobs SET status='retry_wait',lease_token=NULL,
                        lease_until=NULL,next_attempt_at=%s,reason='not_sent' WHERE invocation_id=%s''',
                        (now+timedelta(seconds=2**(ticket.number-1)),row[0]))
                else:self._release(db,row,'not_sent_after_unknown' if was_unknown else
                                   'retries_exhausted' if result.retryable else 'provider_unavailable')
            elif usage:
                self._event_locked(db,row,'settled',usage=usage)
                db.execute("UPDATE qubite_core.ai_dispatch_attempts SET state='succeeded',finished_at=%s WHERE invocation_id=%s AND number=%s",(now,row[0],ticket.number))
            else:
                self._event_locked(db,row,'unknown')
                db.execute("UPDATE qubite_core.ai_dispatch_jobs SET reason='delivery_unknown' WHERE invocation_id=%s",(row[0],))
                db.execute("UPDATE qubite_core.ai_dispatch_attempts SET state='unknown',finished_at=%s WHERE invocation_id=%s AND number=%s",(now,row[0],ticket.number))
            return self._receipt(self._invocation(db,row[0]))

    async def run(self, claim, payload, provider):
        if type(provider) is not MockProvider:raise AuthError(400,'mock_provider_required')
        ticket=self.arm(claim,payload)
        if ticket is None:return self.status(claim.invocation_id)
        try:
            async with asyncio.timeout(ticket.timeout_seconds):
                result=await provider.send(ticket,payload)
        except asyncio.CancelledError:
            self.finish(ticket,None)
            raise
        except Exception:
            result=None
        try:return self.finish(ticket,result)
        except (ValueError,AuthError) as error:
            if isinstance(error,AuthError) and error.code not in {'invalid_budget_request','invalid_mock_result'}:raise
            # Invalid provider evidence is uncertain, never a free refund/retry.
            return self.finish(ticket,None)

    def recover(self, *, limit=100):
        if type(limit) is not int or not 1<=limit<=100:raise AuthError(400,'invalid_dispatch_limit')
        changed=0
        # One invocation per transaction: never accumulate locks across different
        # routes/periods/users while another worker settles their shared buckets.
        for _ in range(limit):
            with database(self.settings) as db:
                self._lock(db);self._budget_lock(db);now=self._now()
                candidate=db.execute('''SELECT i.id FROM qubite_core.ai_budget_invocations i
                    JOIN qubite_core.ai_dispatch_jobs j ON j.invocation_id=i.id
                    WHERE (j.status='sending' AND j.lease_until<=%s) OR
                      (j.status IN ('queued','leased','retry_wait') AND j.expires_at<=%s)
                    ORDER BY i.id LIMIT 1 FOR UPDATE OF i SKIP LOCKED''',(now,now)).fetchone()
                if not candidate:break
                row=self._invocation(db,candidate[0])
                self._key_lock(db,('route/'+row[5]['provider']+'/'+row[5]['model']).encode())
                job=self._job(db,row[0])
                if job[0]=='sending':
                    self._event_locked(db,row,'unknown')
                    db.execute("UPDATE qubite_core.ai_dispatch_attempts SET state='unknown' WHERE invocation_id=%s AND state='sending'",(row[0],))
                    db.execute("UPDATE qubite_core.ai_dispatch_jobs SET reason='worker_lost' WHERE invocation_id=%s",(row[0],))
                else:self._release(db,row,'queue_expired')
                changed+=1
        return changed
