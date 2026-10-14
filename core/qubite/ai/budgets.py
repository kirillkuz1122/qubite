"""Transactional mock ledger. Receipts are bookkeeping, never provider capabilities.

Lock order: migration -> policy -> Auth rows (web only) -> budget config ->
event/idempotency -> invocation -> accounts -> sorted bucket IDs. No network I/O.
"""
from datetime import datetime, timezone
import hashlib
import json
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from pydantic import ValidationError

from ..identity.auth.store import AuthError, database
from ..policy.models import Target
from ..policy.store import PolicyStore
from .models import BudgetLimit, BindProject, Price, Timezone, UsageBound, Usage, quote, boundaries

BUDGET_LOCK = 0x515542425544
ALL_START = datetime(1970, 1, 1, tzinfo=timezone.utc)


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).digest()


def validated(value, cls):
    try:
        # Revalidate even internal model_copy/model_construct objects.
        if not isinstance(value, cls): raise ValueError()
        return cls.model_validate(value.model_dump())
    except (ValueError, ValidationError):
        raise AuthError(400, 'invalid_budget_request') from None


def identifier(value):
    if not isinstance(value, UUID): raise AuthError(400, 'invalid_budget_request')
    return value


class BudgetStore(PolicyStore):
    @staticmethod
    def _budget_lock(db, *, write=False):
        fn = 'pg_advisory_xact_lock' if write else 'pg_advisory_xact_lock_shared'
        db.execute('SELECT '+fn+'(%s)', (BUDGET_LOCK,))
        row = db.execute('SELECT revision,timezone FROM qubite_core.ai_budget_state WHERE singleton').fetchone()
        if not row: raise AuthError(503, 'budget_unavailable')
        try: Timezone(name=row[1])
        except ValueError: raise AuthError(503, 'budget_timezone_unavailable') from None
        return row

    @staticmethod
    def _key_lock(db, key):
        # Separate two-int advisory namespace, collision only serializes transactions.
        number = int.from_bytes(hashlib.sha256(key).digest()[:4], 'big', signed=True)
        db.execute('SELECT pg_advisory_xact_lock(%s,%s)', (0x514149, number))

    def _now(self):
        now = self.clock()
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise AuthError(503, 'budget_clock_invalid')
        return now.astimezone(timezone.utc)

    @staticmethod
    def _account(db, scope, key):
        db.execute('''INSERT INTO qubite_core.ai_budget_accounts(id,scope,key) VALUES(%s,%s,%s)
            ON CONFLICT(scope,key) DO NOTHING''', (uuid4(), scope, key))
        return db.execute('SELECT id FROM qubite_core.ai_budget_accounts WHERE scope=%s AND key=%s FOR UPDATE',
                          (scope, key)).fetchone()[0]

    def configuration(self, raw):
        """Owner-only metadata for a future Console adapter; no HTTP route yet."""
        with database(self.settings) as db:
            self._lock(db)
            subject, _ = self._web(db, raw)
            self._owner(subject)
            revision, zone = self._budget_lock(db)
            limits = db.execute('''SELECT a.scope,a.key,l.period,l.usd_micro,l.requests,l.tokens
                FROM qubite_core.ai_budget_limits l JOIN qubite_core.ai_budget_accounts a ON a.id=l.account_id
                ORDER BY a.scope,a.key,l.period''').fetchall()
            return dict(revision=revision, timezone=zone, limits=[dict(scope=r[0],key=r[1],period=r[2],
                        usd_micro=r[3],requests=r[4],tokens=r[5]) for r in limits])

    def configure(self, raw, csrf, command, expected, command_id):
        """Guarded internal owner hook. No silent resets, deletes or price replacement."""
        if type(expected) is not int or expected < 1: raise AuthError(400, 'invalid_budget_request')
        identifier(command_id)
        cls = next((c for c in (BudgetLimit, BindProject, Price, Timezone) if isinstance(command, c)), None)
        if cls is None: raise AuthError(400, 'invalid_budget_request')
        command = validated(command, cls)
        data = command.model_dump(mode='json'); hashed = fingerprint(data)
        with database(self.settings) as db:
            # Exclusive policy lock also invalidates old delegated revision probes.
            self._lock(db, write=True)
            subject, row = self._web(db, raw)
            self._csrf(row, csrf); self._owner(subject, row, self._now())
            revision, _ = self._budget_lock(db, write=True)
            replay = db.execute('''SELECT actor_id,request_hash,expected_revision,revision
                FROM qubite_core.ai_budget_audit WHERE command_id=%s''', (command_id,)).fetchone()
            if replay:
                if replay[0] != subject['id'] or bytes(replay[1]) != hashed or replay[2] != expected:
                    raise AuthError(409, 'budget_conflict')
                return dict(revision=replay[3])
            if revision != expected: raise AuthError(409, 'budget_conflict')
            before = None
            if isinstance(command, BudgetLimit):
                if command.scope == 'user': self._exists(db, 'subjects', 'id', UUID(command.key))
                if command.scope == 'module': self._exists(db, 'policy_modules', 'id', command.key)
                if command.scope == 'project':
                    project = db.execute("SELECT 1 FROM qubite_core.policy_resources WHERE id=%s AND module='projects'",
                                         (UUID(command.key),)).fetchone()
                    if not project: raise AuthError(400, 'invalid_budget_request')
                account = self._account(db, command.scope, command.key)
                old = db.execute('''SELECT usd_micro,requests,tokens FROM qubite_core.ai_budget_limits
                    WHERE account_id=%s AND period=%s''', (account, command.period)).fetchone()
                before = list(old) if old else None
                db.execute('''INSERT INTO qubite_core.ai_budget_limits VALUES(%s,%s,%s,%s,%s)
                    ON CONFLICT(account_id,period) DO UPDATE SET usd_micro=EXCLUDED.usd_micro,
                    requests=EXCLUDED.requests,tokens=EXCLUDED.tokens''',
                    (account,command.period,command.usd_micro,command.requests,command.tokens))
            elif isinstance(command, Timezone):
                before = db.execute('SELECT timezone FROM qubite_core.ai_budget_state WHERE singleton').fetchone()[0]
                db.execute('UPDATE qubite_core.ai_budget_state SET timezone=%s WHERE singleton', (command.name,))
            elif isinstance(command, Price):
                if command.expires_at <= self._now(): raise AuthError(400, 'invalid_budget_request')
                if db.execute('SELECT 1 FROM qubite_core.ai_budget_prices WHERE id=%s', (command.id,)).fetchone():
                    raise AuthError(409, 'price_immutable')
                db.execute('INSERT INTO qubite_core.ai_budget_prices VALUES(%s,%s,%s)',
                           (command.id,Jsonb(data),self._now()))
            else:
                project = db.execute('SELECT workspace_id,module FROM qubite_core.policy_resources WHERE id=%s',
                                     (command.project_id,)).fetchone()
                resource = db.execute('SELECT workspace_id FROM qubite_core.policy_resources WHERE id=%s',
                                      (command.resource_id,)).fetchone()
                if not project or project[1] != 'projects' or not resource or project[0] != resource[0]:
                    raise AuthError(400, 'invalid_budget_request')
                old = db.execute('SELECT project_id FROM qubite_core.ai_budget_project_bindings WHERE resource_id=%s',
                                 (command.resource_id,)).fetchone()
                before = str(old[0]) if old else None
                db.execute('''INSERT INTO qubite_core.ai_budget_project_bindings VALUES(%s,%s)
                    ON CONFLICT(resource_id) DO UPDATE SET project_id=EXCLUDED.project_id''',
                           (command.resource_id,command.project_id))
            db.execute('UPDATE qubite_core.ai_budget_state SET revision=revision+1 WHERE singleton')
            db.execute('UPDATE qubite_core.policy_state SET revision=revision+1 WHERE singleton')
            db.execute('INSERT INTO qubite_core.ai_budget_audit VALUES(%s,%s,%s,%s,%s,%s,%s)',
                       (command_id,subject['id'],hashed,expected,revision+1,Jsonb(dict(before=before,after=data)),self._now()))
            return dict(revision=revision+1)

    @staticmethod
    def _receipt(row):
        return dict(id=row[0], state=row[1], reserved_usd_micro=row[2], reserved_tokens=row[3], usage=row[4])

    @staticmethod
    def _invocation(db, invocation):
        identifier(invocation)
        row = db.execute('''SELECT id,state,reserved_usd,reserved_tokens,usage,target,price_id,usage_bound
            FROM qubite_core.ai_budget_invocations WHERE id=%s FOR UPDATE''', (invocation,)).fetchone()
        if not row: raise AuthError(404, 'budget_not_found')
        return row

    def _bucket(self, db, account, period, zone, now):
        # Accounts are locked in stable scope/key order, including lazily created ones.
        row = db.execute('''SELECT id,starts_at,ends_at FROM qubite_core.ai_budget_buckets
            WHERE account_id=%s AND period=%s ORDER BY starts_at DESC LIMIT 1''', (account,period)).fetchone()
        if row:
            if now < row[1]: raise AuthError(503, 'budget_clock_invalid')
            if row[2] is None or now < row[2]: return row[0]
        start, end = (ALL_START, None) if period == 'all' else boundaries(now, zone, period)
        if row: start = max(start, row[2])
        key = uuid4()
        db.execute('''INSERT INTO qubite_core.ai_budget_buckets(id,account_id,period,starts_at,ends_at,timezone)
            VALUES(%s,%s,%s,%s,%s,%s)''', (key,account,period,start,end,zone))
        return key

    def reserve(self, raw, csrf, target, price_id, bound, idempotency_key, payload_hash):
        """Trusted server input; raw prompt is not stored. Does not send/permit a provider call."""
        target = validated(target, Target); bound = validated(bound, UsageBound)
        identifier(price_id); identifier(idempotency_key)
        if (target.action != 'ai' or target.provider != 'mock' or type(payload_hash) is not bytes
                or len(payload_hash) != 32): raise AuthError(400, 'invalid_budget_request')
        data = dict(target=target.model_dump(mode='json'),price=str(price_id),bound=bound.model_dump(),
                    payload_hash=payload_hash.hex())
        hashed = fingerprint(data)
        with database(self.settings) as db:
            policy_revision = self._lock(db)
            subject, session = self._web(db, raw)
            self._csrf(session, csrf)
            self._authorize_permissions(db, subject, target)
            revision, zone = self._budget_lock(db)
            now = self._now()
            self._key_lock(db, subject['id'].bytes + idempotency_key.bytes)
            old = db.execute('''SELECT id,fingerprint FROM qubite_core.ai_budget_invocations
                WHERE subject_id=%s AND idempotency_key=%s''', (subject['id'],idempotency_key)).fetchone()
            if old:
                if bytes(old[1]) != hashed: raise AuthError(409, 'budget_conflict')
                return self._receipt(self._invocation(db, old[0]))
            self._key_lock(db, ('route/'+target.provider+'/'+target.model).encode())
            if db.execute('SELECT 1 FROM qubite_core.ai_budget_freezes WHERE provider=%s AND model=%s',
                          (target.provider,target.model)).fetchone(): raise AuthError(403, 'budget_route_frozen')
            row = db.execute('SELECT snapshot FROM qubite_core.ai_budget_prices WHERE id=%s', (price_id,)).fetchone()
            try:
                price = Price.model_validate(row[0]) if row else None
                if not price or price.id != price_id or price.model != target.model or price.expires_at <= now:
                    raise ValueError()
                cost = quote(price, bound)
            except (ValueError, ValidationError): raise AuthError(403, 'budget_price_unavailable') from None
            tokens = bound.input_tokens + bound.max_output_tokens
            project = db.execute('SELECT project_id FROM qubite_core.ai_budget_project_bindings WHERE resource_id=%s',
                                 (target.resource_id,)).fetchone()
            scopes = [('global','*'),('user',str(subject['id'])),('module',target.module),
                      ('model',target.provider+'/'+target.model)]
            if project: scopes.append(('project',str(project[0])))
            elif target.module == 'projects': scopes.append(('project',str(target.resource_id)))
            buckets, limits = [], {}
            for scope, key in sorted(scopes):
                account = self._account(db, scope, key)
                rows = db.execute('SELECT period,usd_micro,requests,tokens FROM qubite_core.ai_budget_limits WHERE account_id=%s',
                                  (account,)).fetchall()
                caps = {r[0]: r[1:] for r in rows}
                if scope in {'global','user'} and ('all' not in caps or caps['all'][0] is None):
                    raise AuthError(403, 'budget_missing')
                for period in ('all','day','month'):
                    bucket = self._bucket(db, account, period, zone, now)
                    buckets.append(bucket)
                    if period in caps: limits[bucket] = caps[period]
            locked = db.execute('''SELECT id,account_id,period,spent_usd,reserved_usd,spent_requests,
                reserved_requests,spent_tokens,reserved_tokens FROM qubite_core.ai_budget_buckets
                WHERE id=ANY(%s) ORDER BY id FOR UPDATE''', (buckets,)).fetchall()
            for b in locked:
                if b[0] not in limits: continue
                # Unfinished old-period reservations consume new-period headroom too.
                carry = db.execute('''SELECT COALESCE(sum(reserved_usd),0),COALESCE(sum(reserved_requests),0),
                    COALESCE(sum(reserved_tokens),0) FROM qubite_core.ai_budget_buckets
                    WHERE account_id=%s AND period=%s AND id<>%s''', (b[1],b[2],b[0])).fetchone()
                for cap, spent, held, inherited, estimate in zip(limits[b[0]], b[3::2], b[4::2], carry, (cost,1,tokens)):
                    if cap is not None and (cap == 0 or spent+held+inherited+estimate > cap):
                        raise AuthError(403, 'budget_exhausted')
            invocation = uuid4()
            db.execute('''INSERT INTO qubite_core.ai_budget_invocations(id,subject_id,session_id,idempotency_key,
                fingerprint,target,usage_bound,price_id,policy_revision,budget_revision,reserved_usd,reserved_tokens,state,created_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'reserved',%s)''',
                (invocation,subject['id'],session[0],idempotency_key,hashed,Jsonb(data['target']),Jsonb(data['bound']),price_id,
                 policy_revision,revision,cost,tokens,now))
            for b in locked:
                db.execute('''UPDATE qubite_core.ai_budget_buckets SET reserved_usd=reserved_usd+%s,
                    reserved_requests=reserved_requests+1,reserved_tokens=reserved_tokens+%s WHERE id=%s''', (cost,tokens,b[0]))
                db.execute('INSERT INTO qubite_core.ai_budget_allocations VALUES(%s,%s)', (invocation,b[0]))
            db.execute('INSERT INTO qubite_core.ai_budget_outbox(invocation_id) VALUES(%s)', (invocation,))
            return self._receipt(self._invocation(db, invocation))

    def _event(self, db, row, event_id, kind, data):
        replay = db.execute('SELECT invocation_id,kind,data FROM qubite_core.ai_budget_events WHERE event_id=%s', (event_id,)).fetchone()
        if replay:
            if replay != (row[0], kind, data): raise AuthError(409, 'budget_conflict')
            return True
        return False

    def record(self, invocation, event_id, kind, *, provider_request_id=None, usage=None):
        """Trusted MOCK ledger events only, not a dispatcher or public webhook.

        Unknown may settle after reliable usage; no timeout/TTL releases. Settlement
        deliberately does not require a live originating session or current grant.
        """
        identifier(invocation); identifier(event_id)
        if kind not in {'dispatched','unknown','released','settled'}: raise AuthError(400, 'invalid_budget_request')
        if kind == 'dispatched': identifier(provider_request_id)
        elif provider_request_id is not None: raise AuthError(400, 'invalid_budget_request')
        if kind == 'settled': usage = validated(usage, Usage)
        elif usage is not None: raise AuthError(400, 'invalid_budget_request')
        data = dict(provider_request_id=str(provider_request_id) if provider_request_id else None,
                    usage=usage.model_dump() if usage else None)
        with database(self.settings) as db:
            self._lock(db)
            self._budget_lock(db)
            self._key_lock(db, b'event'+event_id.bytes)
            if provider_request_id is not None:
                self._key_lock(db, b'provider-request'+provider_request_id.bytes)
            row = self._invocation(db, invocation)
            self._key_lock(db, ('route/'+row[5]['provider']+'/'+row[5]['model']).encode())
            if self._event(db, row, event_id, kind, data): return self._receipt(row)
            existing = db.execute('SELECT data FROM qubite_core.ai_budget_events WHERE invocation_id=%s AND kind=%s',
                                  (invocation,kind)).fetchone()
            if existing:
                if existing[0] != data: raise AuthError(409, 'budget_conflict')
                db.execute('INSERT INTO qubite_core.ai_budget_events VALUES(%s,%s,%s,%s,%s)',
                           (event_id,invocation,kind,Jsonb(data),self._now()))
                return self._receipt(row)
            permitted = {'dispatched': {'reserved'}, 'unknown': {'dispatched'},
                         'released': {'reserved'}, 'settled': {'dispatched','unknown'}}
            if row[1] not in permitted[kind]: raise AuthError(409, 'budget_state_conflict')
            if kind in {'released','settled'}:
                buckets = db.execute('''SELECT b.id FROM qubite_core.ai_budget_buckets b
                    JOIN qubite_core.ai_budget_allocations a ON a.bucket_id=b.id
                    WHERE a.invocation_id=%s ORDER BY b.id FOR UPDATE OF b''', (invocation,)).fetchall()
                spent = usage.usd_micro if usage else 0
                used = usage.input_tokens + usage.output_tokens if usage else 0
                for b in buckets:
                    db.execute('''UPDATE qubite_core.ai_budget_buckets SET reserved_usd=reserved_usd-%s,
                        reserved_requests=reserved_requests-1,reserved_tokens=reserved_tokens-%s,
                        spent_usd=spent_usd+%s,spent_requests=spent_requests+%s,spent_tokens=spent_tokens+%s WHERE id=%s''',
                        (row[2],row[3],spent,1 if usage else 0,used,b[0]))
                if usage and (spent > row[2] or usage.input_tokens > row[7]['input_tokens']
                              or usage.output_tokens > row[7]['max_output_tokens']):
                    target = row[5]
                    db.execute('''INSERT INTO qubite_core.ai_budget_freezes VALUES(%s,%s,%s,%s)
                        ON CONFLICT(provider,model) DO NOTHING''', (target['provider'],target['model'],invocation,self._now()))
                db.execute("UPDATE qubite_core.ai_budget_outbox SET state='closed' WHERE invocation_id=%s", (invocation,))
            elif kind == 'dispatched':
                duplicate = db.execute('SELECT 1 FROM qubite_core.ai_budget_invocations WHERE provider_request_id=%s',
                                       (provider_request_id,)).fetchone()
                if duplicate: raise AuthError(409, 'budget_conflict')
                db.execute("UPDATE qubite_core.ai_budget_outbox SET state='marked' WHERE invocation_id=%s", (invocation,))
            db.execute('''UPDATE qubite_core.ai_budget_invocations SET state=%s,
                provider_request_id=COALESCE(%s,provider_request_id),usage=%s WHERE id=%s''',
                (kind,provider_request_id,Jsonb(data['usage']) if usage else None,invocation))
            db.execute('INSERT INTO qubite_core.ai_budget_events VALUES(%s,%s,%s,%s,%s)',
                       (event_id,invocation,kind,Jsonb(data),self._now()))
            return self._receipt(self._invocation(db, invocation))
