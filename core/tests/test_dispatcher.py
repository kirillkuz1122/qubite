"""Real PG, sealed mock, fault injection and process death; zero external calls."""
import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import multiprocessing
import os
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest
from pydantic import ValidationError

from qubite.ai import Dispatcher, DispatchSettings, BudgetLimit, Usage
from qubite.ai.dispatcher import Claim
from qubite.ai.mock import MockProvider, Success, NotSent
from qubite.config import Settings
from qubite.identity.auth.store import AuthError
from qubite.migrations import apply, check, load_migrations, Migration, MigrationError
from test_auth import auth, client, member, challenge
from test_policy import policy, raw, command
from test_budgets import budget, configure, reserve, buckets, limit

PAYLOAD=b'synthetic input only'


def dispatcher(b):return Dispatcher(b[0][0],b[0][2])


def run(d,claim,provider=None,payload=PAYLOAD):
    return asyncio.run(d.run(claim,payload,provider or MockProvider()))


def test_success_uses_atomic_outbox_and_never_holds_locks_during_provider_await(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider()
    claim=d.claim(r['id']);ticket=d.arm(claim,PAYLOAD)
    assert ticket.timeout_seconds==60 and d.status(r['id'])['status']=='sending'
    # Separate DB connection can lock the invocation while the adapter runs.
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute("SET lock_timeout='100ms'")
        assert db.execute('SELECT id FROM qubite_core.ai_budget_invocations WHERE id=%s FOR UPDATE NOWAIT',(r['id'],)).fetchone()
    result=asyncio.run(provider.send(ticket,PAYLOAD));d.finish(ticket,result)
    assert provider.calls==provider.deliveries==1
    assert d.status(r['id'])['status']=='settled' and d.claim(r['id']) is None
    assert buckets(b)[0][:6]==(400_000,0,1,0,3,0)
    assert d.finish(ticket,result)['state']=='settled'
    assert buckets(b)[0][0]==400_000


def test_safe_retry_is_at_most_three_total_attempts_with_one_and_two_second_backoff(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider(('not_sent','not_sent','success'))
    for number in range(1,4):
        claim=d.claim(r['id']);assert claim
        run(d,claim,provider)
        assert d.status(r['id'])['attempts']==number
        if number<3:
            assert d.claim(r['id']) is None
            b[0][2].advance(2**(number-1))
    assert provider.calls==3 and provider.deliveries==1 and d.claim(r['id']) is None
    assert buckets(b)[0][:6]==(400_000,0,1,0,3,0)


def test_three_confirmed_not_sent_exhausts_attempts_releases_all_and_requires_manual_choice(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider(('not_sent',))
    for number in range(1,4):
        run(d,d.claim(r['id']),provider);b[0][2].advance(2**(number-1))
    status=d.status(r['id'])
    assert status['status']=='released' and status['reason']=='retries_exhausted' and status['manual_choice_required']
    assert provider.calls==3 and provider.deliveries==0 and d.claim(r['id']) is None
    assert buckets(b)[0][:6]==(0,0,0,0,0,0)


def test_unavailable_has_no_automatic_fallback_and_other_model_needs_new_reservation(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);first=MockProvider(('unavailable',));other=MockProvider()
    run(d,d.claim(r['id']),first)
    assert first.calls==1 and first.deliveries==other.calls==0
    assert d.status(r['id'])['manual_choice_required']
    assert d.claim(r['id']) is None and buckets(b)[0][:2]==(0,0)


@pytest.mark.parametrize('outcome',['unknown','error','timeout'])
def test_uncertain_delivery_keeps_reserve_and_never_retries_or_falls_back(budget,outcome):
    b,p=budget;configure(b,DispatchSettings(timeout_seconds=1));r=reserve(b,p);d=dispatcher(b)
    provider=MockProvider((outcome,));run(d,d.claim(r['id']),provider)
    assert provider.calls==provider.deliveries==1
    assert d.status(r['id'])['status']=='unknown' and d.claim(r['id']) is None
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5)
    b[0][2].advance(32*86400);assert d.recover()==0
    assert buckets(b)[0][1]==600_000


@pytest.mark.parametrize('fault',['grant','acl','membership','module','uninstalled','session','blocked','budget_zero','budget_missing','tokens','requests','price_expired','price_unknown','frozen','revision'])
def test_live_recheck_after_claim_denies_before_provider_and_releases_only_unsent(budget,fault):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);claim=d.claim(r['id']);provider=MockProvider()
    if fault in {'grant','acl','membership','module'}:
        bodies={
          'grant':dict(kind='ai_grant',subject_id=str(b[3].id),module='docs',provider='mock',model='model-1',effect='deny'),
          'acl':dict(kind='acl',subject_id=str(b[3].id),resource_id=str(b[5].resource_id),action='ai',effect='deny'),
          'membership':dict(kind='membership',subject_id=str(b[3].id),workspace_id=str(b[5].workspace_id),role='editor',enabled=False),
          'module':dict(kind='module',module='docs',enabled=False)}
        assert command(b[1],bodies[fault]).status_code==200
    else:
        with psycopg.connect(b[0][0].database_url) as db:
            if fault=='uninstalled':db.execute("UPDATE qubite_core.policy_modules SET installed=false WHERE id='docs'")
            elif fault=='session':db.execute('UPDATE qubite_core.sessions SET revoked_at=%s WHERE subject_id=%s',(b[0][2](),b[3].id))
            elif fault=='blocked':db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(b[3].id,))
            elif fault=='budget_zero':db.execute('UPDATE qubite_core.ai_budget_limits SET usd_micro=0')
            elif fault=='budget_missing':db.execute('DELETE FROM qubite_core.ai_budget_limits')
            elif fault in {'tokens','requests'}:db.execute('UPDATE qubite_core.ai_budget_limits SET '+fault+'=0')
            elif fault=='price_expired':db.execute("UPDATE qubite_core.ai_budget_prices SET snapshot=jsonb_set(snapshot,'{expires_at}',to_jsonb(%s::text))",((b[0][2]()-timedelta(seconds=1)).isoformat(),))
            elif fault=='price_unknown':db.execute("UPDATE qubite_core.ai_budget_prices SET snapshot=jsonb_set(snapshot,'{currency}','\"RUB\"')")
            elif fault=='frozen':db.execute("INSERT INTO qubite_core.ai_budget_freezes VALUES('mock','model-1',%s,%s)",(r['id'],b[0][2]()))
            elif fault=='revision':db.execute('UPDATE qubite_core.policy_state SET revision=revision+1')
    result=run(d,claim,provider)
    assert result['state']=='released' and provider.calls==provider.deliveries==0
    assert buckets(b)[0][:6]==(0,0,0,0,0,0)


def test_revocation_between_known_unsent_attempts_stops_retry_without_charging(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider(('not_sent','success'))
    run(d,d.claim(r['id']),provider);b[0][2].advance(1)
    assert command(b[1],dict(kind='module',module='docs',enabled=False)).status_code==200
    run(d,d.claim(r['id']),provider)
    assert provider.calls==1 and provider.deliveries==0
    assert buckets(b)[0][:6]==(0,0,0,0,0,0)


def test_revocation_after_committed_intent_does_not_erase_inflight_usage(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);ticket=d.arm(d.claim(r['id']),PAYLOAD);provider=MockProvider()
    assert command(b[1],dict(kind='module',module='docs',enabled=False)).status_code==200
    result=asyncio.run(provider.send(ticket,PAYLOAD));d.finish(ticket,result)
    assert provider.deliveries==1 and buckets(b)[0][:6]==(400_000,0,1,0,3,0)
    with pytest.raises(AuthError,match='forbidden'):reserve(b,p)


def test_budget_change_between_reserve_and_send_cancels_stale_authority(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider()
    limit(b,usd_micro=300_000)
    run(d,d.claim(r['id']),provider)
    assert provider.calls==0 and buckets(b)[0][:6]==(0,0,0,0,0,0)


def test_wrong_payload_or_adapter_never_calls_and_does_not_destroy_valid_reservation(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);claim=d.claim(r['id'])
    with pytest.raises(AuthError,match='dispatch_payload_mismatch'):run(d,claim,payload=b'other input')
    with pytest.raises(AuthError,match='mock_provider_required'):asyncio.run(d.run(claim,PAYLOAD,object()))
    class Unsafe(MockProvider):pass
    with pytest.raises(AuthError,match='mock_provider_required'):asyncio.run(d.run(claim,PAYLOAD,Unsafe()))
    assert buckets(b)[0][1]==600_000
    assert run(d,claim)['state']=='settled'


def test_invalid_usage_evidence_stays_unknown_without_freeing_money(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider(usage='untrusted usage')
    run(d,d.claim(r['id']),provider)
    assert d.status(r['id'])['status']=='unknown' and provider.calls==1
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5) and d.claim(r['id']) is None


def test_actual_overrun_freezes_already_queued_calls_without_losing_billing(budget):
    b,p=budget;r=reserve(b,p);r2=reserve(b,p);d=dispatcher(b)
    first=MockProvider(usage=Usage(input_tokens=2,output_tokens=1,usd_micro=2_500_000));second=MockProvider()
    run(d,d.claim(r['id']),first);run(d,d.claim(r2['id']),second)
    assert first.deliveries==1 and second.calls==0
    assert buckets(b)[0][:6]==(2_500_000,0,1,0,3,0)


def test_cancelled_coroutine_and_timeout_keep_money_and_accept_late_verified_usage(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);provider=MockProvider(delay=0.2)
    async def cancel():
        task=asyncio.create_task(d.run(d.claim(r['id']),PAYLOAD,provider))
        await asyncio.sleep(0.02);task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
    asyncio.run(cancel())
    assert d.status(r['id'])['status']=='unknown' and provider.deliveries==1
    assert buckets(b)[0][1]==600_000
    # Existing trusted accounting reconciliation does not require a live grant.
    b[4].record(r['id'],uuid4(),'settled',usage=Usage(input_tokens=2,output_tokens=1,usd_micro=450_000))
    assert buckets(b)[0][:2]==(450_000,0) and d.claim(r['id']) is None


def test_late_proven_not_sent_closes_unknown_without_resuming_automatic_retry(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);ticket=d.arm(d.claim(r['id']),PAYLOAD)
    b[0][2].advance(76);d.recover()
    assert d.status(r['id'])['status']=='unknown' and buckets(b)[0][1]==600_000
    d.finish(ticket,NotSent())
    assert d.status(r['id'])['reason']=='not_sent_after_unknown' and d.status(r['id'])['manual_choice_required']
    assert d.claim(r['id']) is None and buckets(b)[0][:6]==(0,0,0,0,0,0)


def test_lease_token_cannot_be_reused_and_generic_release_has_no_proof_bypass(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);claim=d.claim(r['id']);ticket=d.arm(claim,PAYLOAD)
    with pytest.raises(AuthError,match='dispatch_stale_claim'):d.arm(claim,PAYLOAD)
    with pytest.raises(AuthError,match='dispatch_stale_claim'):d.finish(replace(ticket,claim=Claim(r['id'],uuid4())),NotSent())
    with pytest.raises(AuthError,match='budget_state_conflict'):b[4].record(r['id'],uuid4(),'released')
    assert buckets(b)[0][1]==600_000


def crash_worker(url,now,invocation,point,pipe):
    d=Dispatcher(Settings(url),lambda:now);claim=d.claim(invocation)
    if point=='claim':pipe.send(claim)
    else:
        ticket=d.arm(claim,PAYLOAD)
        deliveries=0
        if point=='sent':
            provider=MockProvider();asyncio.run(provider.send(ticket,PAYLOAD));deliveries=provider.deliveries
        pipe.send((ticket,deliveries))
    pipe.close();os._exit(17)


def crash(b,invocation,point):
    ctx=multiprocessing.get_context('spawn');parent,child=ctx.Pipe(duplex=False)
    process=ctx.Process(target=crash_worker,args=(b[0][0].database_url,b[0][2](),invocation,point,child));process.start();child.close()
    try:
        assert parent.poll(20);result=parent.recv();process.join(timeout=10);assert process.exitcode==17
        return result
    finally:
        if process.is_alive():process.terminate();process.join(timeout=5)
        parent.close()


def test_process_death_before_arm_can_reclaim_with_new_fence_and_no_duplicate_send(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);old=crash(b,r['id'],'claim')
    b[0][2].advance(76);fresh=d.claim(r['id']);assert fresh.token!=old.token
    with pytest.raises(AuthError,match='dispatch_stale_claim'):run(d,old)
    provider=MockProvider();run(d,fresh,provider)
    assert provider.deliveries==1 and buckets(b)[0][0]==400_000


@pytest.mark.parametrize('point',['armed','sent'])
def test_process_death_after_intent_is_unknown_even_if_send_did_not_happen(budget,point):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);ticket,deliveries=crash(b,r['id'],point)
    assert deliveries==(1 if point=='sent' else 0)
    b[0][2].advance(76)
    assert d.recover()==1 and d.recover()==0
    assert d.status(r['id'])['status']=='unknown' and d.claim(r['id']) is None
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5)
    if point=='sent':
        d.finish(ticket,Success(Usage(input_tokens=2,output_tokens=1,usd_micro=400_000)))
        assert buckets(b)[0][:2]==(400_000,0)


def test_queue_ttl_releases_only_proven_unsent_and_preserves_identity(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);b[0][2].advance(301)
    assert d.recover()==1 and d.status(r['id'])['reason']=='queue_expired'
    assert buckets(b)[0][:6]==(0,0,0,0,0,0) and d.claim(r['id']) is None
    assert b[4].authenticated(raw(b[2]))['id']==b[3].id


def test_failed_final_db_write_keeps_reserve_and_does_not_repeat_provider(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);ticket=d.arm(d.claim(r['id']),PAYLOAD);provider=MockProvider()
    result=asyncio.run(provider.send(ticket,PAYLOAD))
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute("ALTER TABLE qubite_core.ai_budget_events ADD CONSTRAINT prevent_settle CHECK(kind<>'settled')")
    with pytest.raises(AuthError,match='identity_unavailable'):d.finish(ticket,result)
    assert provider.deliveries==1 and buckets(b)[0][1]==600_000
    b[0][2].advance(76);d.recover();assert d.claim(r['id']) is None
    with psycopg.connect(b[0][0].database_url) as db:db.execute('ALTER TABLE qubite_core.ai_budget_events DROP CONSTRAINT prevent_settle')
    assert d.finish(ticket,result)['state']=='settled' and provider.deliveries==1


def claim_worker(url,now,invocation,barrier,queue):
    d=Dispatcher(Settings(url),lambda:now);provider=MockProvider();barrier.wait(timeout=20)
    for _ in range(50):
        claim=d.claim(invocation)
        if claim:asyncio.run(d.run(claim,PAYLOAD,provider))
    queue.put((provider.calls,provider.deliveries))


def test_two_processes_100_claims_send_exactly_once(budget):
    b,p=budget;r=reserve(b,p);ctx=multiprocessing.get_context('spawn');barrier=ctx.Barrier(3);queue=ctx.Queue()
    children=[ctx.Process(target=claim_worker,args=(b[0][0].database_url,b[0][2](),r['id'],barrier,queue)) for _ in range(2)]
    for process in children:process.start()
    try:
        barrier.wait(timeout=20);results=[queue.get(timeout=40) for _ in children]
        for process in children:process.join(timeout=10);assert process.exitcode==0
        assert sum(r[0] for r in results)==sum(r[1] for r in results)==1
        assert buckets(b)[0][:6]==(400_000,0,1,0,3,0)
    finally:
        for process in children:
            if process.is_alive():process.terminate();process.join(timeout=5)
        queue.close();queue.join_thread()


@pytest.mark.parametrize('value',[True,0,301,1.1,'60'])
def test_timeout_strict_bounds(value):
    with pytest.raises(ValidationError):DispatchSettings(timeout_seconds=value)


def test_configurable_timeout_uses_existing_guarded_owner_protocol(budget):
    b,p=budget;cmd=DispatchSettings(timeout_seconds=120)
    with pytest.raises(AuthError,match='forbidden'):configure(b,cmd,actor=b[2])
    with pytest.raises(AuthError,match='csrf_failed'):configure(b,cmd,csrf='bad')
    configure(b,cmd);r=reserve(b,p);d=dispatcher(b)
    assert d.arm(d.claim(r['id']),PAYLOAD).timeout_seconds==120
    assert b[4].configuration(raw(b[1]))['timeout_seconds']==120


def test_migration_preserves_old_pending_and_never_replays_uncertain_old_outbox(database_url):
    s=Settings(database_url);ms=load_migrations();apply(s,ms[:9])
    subject,session,price,account,bucket=uuid4(),uuid4(),uuid4(),uuid4(),uuid4()
    now=datetime(2030,1,1,tzinfo=timezone.utc)
    cases=[('reserved','pending','queued'),('dispatched','marked','unknown'),('unknown','marked','unknown'),
           ('settled','closed','settled'),('released','closed','released'),('reserved','marked','unknown')]
    ids=[]
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical,status) VALUES(%s,'keep@example.test','keep@example.test','active')",(subject,))
        db.execute('''INSERT INTO qubite_core.sessions(id,subject_id,token_hash,csrf_hash,auth_version,created_at,last_seen_at,
            expires_at,absolute_expires_at,reauthed_at,password_proven) VALUES(%s,%s,%s,%s,1,%s,%s,%s,%s,%s,true)''',
            (session,subject,b's'*32,b'c'*32,now,now,now+timedelta(days=1),now+timedelta(days=1),now))
        db.execute('INSERT INTO qubite_core.ai_budget_prices VALUES(%s,%s,%s)',(price,Jsonb({}),now))
        db.execute("INSERT INTO qubite_core.ai_budget_accounts VALUES(%s,'global','*')",(account,))
        db.execute("INSERT INTO qubite_core.ai_budget_buckets(id,account_id,period,starts_at,timezone,reserved_usd,reserved_requests,reserved_tokens) VALUES(%s,%s,'all',%s,'Asia/Yekaterinburg',2400000,4,20)",(bucket,account,now))
        for state,outbox,_ in cases:
            invocation=uuid4();ids.append(invocation)
            db.execute('''INSERT INTO qubite_core.ai_budget_invocations(id,subject_id,session_id,idempotency_key,
                fingerprint,target,usage_bound,price_id,policy_revision,budget_revision,reserved_usd,reserved_tokens,state,created_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,1,1,600000,5,%s,%s)''',
                (invocation,subject,session,uuid4(),b'f'*32,Jsonb({}),Jsonb({}),price,state,now))
            db.execute('INSERT INTO qubite_core.ai_budget_outbox VALUES(%s,%s)',(invocation,outbox))
            if state in {'reserved','dispatched','unknown'}:db.execute('INSERT INTO qubite_core.ai_budget_allocations VALUES(%s,%s)',(invocation,bucket))
    # Transactional schema failure leaves all previous tables/metadata intact.
    broken=Migration(ms[9].version,ms[9].sql+'\nSELECT no_dispatch_function();','a'*64)
    with pytest.raises(MigrationError):apply(s,(*ms[:9],broken))
    with psycopg.connect(database_url) as db:
        assert db.execute("SELECT to_regclass('qubite_core.ai_dispatch_jobs')").fetchone()[0] is None
        assert db.execute("SELECT count(*) FROM information_schema.columns WHERE table_schema='qubite_core' AND table_name='ai_budget_state' AND column_name='timeout_seconds'").fetchone()[0]==0
    assert apply(s)==('0010_dispatcher', '0011_owner_console') and apply(s)==() and check(s)=='0011_owner_console'
    with psycopg.connect(database_url) as db:
        for invocation,(state,_,job) in zip(ids,cases):
            assert db.execute('SELECT state,subject_id,session_id,reserved_usd FROM qubite_core.ai_budget_invocations WHERE id=%s',(invocation,)).fetchone()==(state,subject,session,600000)
            assert db.execute('SELECT status,timeout_seconds,attempts FROM qubite_core.ai_dispatch_jobs WHERE invocation_id=%s',(invocation,)).fetchone()==(job,60,0)
        assert db.execute('SELECT reserved_usd,reserved_requests,reserved_tokens FROM qubite_core.ai_budget_buckets WHERE id=%s',(bucket,)).fetchone()==(2400000,4,20)
    with pytest.raises(MigrationError):apply(s,ms[:9])


def test_dispatch_schema_drift_and_failed_arm_have_zero_provider_calls(budget):
    b,p=budget;r=reserve(b,p);d=dispatcher(b);claim=d.claim(r['id']);provider=MockProvider()
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute("ALTER TABLE qubite_core.ai_dispatch_attempts ADD CHECK(number<0)")
    with pytest.raises(AuthError,match='identity_unavailable'):run(d,claim,provider)
    assert provider.calls==0 and buckets(b)[0][1]==600_000
    assert d.status(r['id'])['state']=='reserved'
    with psycopg.connect(b[0][0].database_url) as db:db.execute('DROP TABLE qubite_core.ai_dispatch_attempts')
    with pytest.raises(AuthError,match='identity_unavailable'):d.claim(r['id'])
