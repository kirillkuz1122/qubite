"""Real PostgreSQL accounting, two independent processes; no external providers."""
from datetime import datetime, timedelta, timezone
import hashlib
import multiprocessing
from uuid import uuid4

import psycopg
import pytest
from pydantic import ValidationError

from qubite.ai import BudgetStore, BudgetLimit, BindProject, Price, Timezone, UsageBound, Usage
from qubite.ai.models import boundaries, quote
from qubite.config import Settings
from qubite.identity.auth.store import AuthError
from qubite.migrations import apply, check, load_migrations, Migration, MigrationError
from qubite.policy import Target
from test_auth import auth, client, member, login, challenge
from test_policy import policy, raw, command, grant_action, checked

HASH = hashlib.sha256(b'synthetic input only').digest()
BOUND = UsageBound(input_tokens=2,max_output_tokens=3)


def configure(b, cmd, *, expected=None, key=None, actor=None, csrf=None):
    _, c, _, _, store, _ = b
    actor = actor or c
    expected = store.configuration(raw(c))['revision'] if expected is None else expected
    return store.configure(raw(actor),csrf or challenge(actor),cmd,expected,key or uuid4())


def limit(b, scope='global', key='*', period='all', usd_micro=2_000_000, requests=None, tokens=None):
    return configure(b, BudgetLimit(scope=scope,key=key,period=period,usd_micro=usd_micro,requests=requests,tokens=tokens))


@pytest.fixture
def budget(policy):
    a,c,u,user,_,t = policy
    grant_action(policy,'ai')
    assert command(c,dict(kind='ai_grant',subject_id=str(user.id),module='docs',provider='mock',model='model-1',effect='allow')).status_code==200
    store=BudgetStore(a[0],a[2]); target=Target(**{**t.model_dump(),'action':'ai','provider':'mock','model':'model-1'})
    b=(a,c,u,user,store,target)
    limit(b);limit(b,'user',str(user.id))
    price=Price(id=uuid4(),model='model-1',input_per_million=0,output_per_million=0,
                fixed_usd_micro=600_000,max_input=100,max_output=100,expires_at=a[2]()+timedelta(days=60))
    configure(b,price)
    yield b,price


def reserve(b, price, *, key=None, target=None, bound=BOUND, payload=HASH, actor=None, csrf=None):
    _,_,u,_,store,t=b; u=actor or u
    return store.reserve(raw(u),csrf or challenge(u),target or t,price.id,bound,key or uuid4(),payload)


def buckets(b, scope='global', period='all'):
    with psycopg.connect(b[0][0].database_url) as db:
        return db.execute('''SELECT b.spent_usd,b.reserved_usd,b.spent_requests,b.reserved_requests,
            b.spent_tokens,b.reserved_tokens,b.starts_at,b.ends_at,b.timezone
            FROM qubite_core.ai_budget_buckets b JOIN qubite_core.ai_budget_accounts a ON a.id=b.account_id
            WHERE a.scope=%s AND b.period=%s ORDER BY b.starts_at''',(scope,period)).fetchall()


def dispatch(b,r):
    return b[4].record(r['id'],uuid4(),'dispatched',provider_request_id=uuid4())


def settle(b,r,usage=None,event=None):
    return b[4].record(r['id'],event or uuid4(),'settled',usage=usage or Usage(input_tokens=2,output_tokens=1,usd_micro=400_000))


def test_reserve_is_atomic_with_outbox_allocations_and_exact_usage_settlement(budget):
    b,p=budget;r=reserve(b,p)
    assert r['reserved_usd_micro']==600_000 and r['reserved_tokens']==5 and r['state']=='reserved'
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5)
    with psycopg.connect(b[0][0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_allocations').fetchone()[0]==12
        assert db.execute('SELECT state FROM qubite_core.ai_budget_outbox').fetchone()[0]=='pending'
        assert db.execute('SELECT usage_bound FROM qubite_core.ai_budget_invocations').fetchone()[0]==BOUND.model_dump()
    dispatch(b,r);s=settle(b,r)
    assert s['state']=='settled' and s['usage']['usd_micro']==400_000
    assert buckets(b)[0][:6]==(400_000,0,1,0,3,0)


def test_release_before_dispatch_reclaims_all_dimensions(budget):
    b,p=budget;r=reserve(b,p)
    assert b[4].record(r['id'],uuid4(),'released')['state']=='released'
    assert buckets(b)[0][:6]==(0,0,0,0,0,0)
    assert reserve(b,p)['state']=='reserved'


@pytest.mark.parametrize('kind',['released','settled'])
def test_no_release_dispatched_or_settle_without_dispatch(budget,kind):
    b,p=budget;r=reserve(b,p)
    if kind=='released':dispatch(b,r)
    with pytest.raises(AuthError,match='budget_state_conflict'):
        b[4].record(r['id'],uuid4(),kind,usage=Usage(input_tokens=0,output_tokens=0,usd_micro=0) if kind=='settled' else None)
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5)


def test_unknown_keeps_reserve_across_timeout_month_and_reconciles_original_buckets(budget):
    b,p=budget
    limit(b,period='month',usd_micro=1_000_000)
    r=reserve(b,p);dispatch(b,r);b[4].record(r['id'],uuid4(),'unknown')
    b[0][2].advance(32*86400)
    assert login(b[2],b[3].email_original).status_code==200
    with pytest.raises(AuthError,match='budget_exhausted'):reserve(b,p)
    # Failed reserve creates no orphan next-period buckets/outbox/invocations.
    assert len(buckets(b,period='month'))==1
    assert buckets(b,period='month')[0][1]==600_000
    settle(b,r)
    r2=reserve(b,p)
    assert r2['id']!=r['id'] and len(buckets(b,period='month'))==2
    assert buckets(b,period='month')[0][:2]==(400_000,0)


@pytest.mark.parametrize('period',['all','day','month'])
@pytest.mark.parametrize('dimension',['usd_micro','requests','tokens'])
def test_each_period_and_dimension_blocks_atomically(budget,period,dimension):
    b,p=budget
    values=dict(usd_micro=2_000_000,requests=None,tokens=None)
    values[dimension]={'usd_micro':1_000_000,'requests':1,'tokens':9}[dimension]
    limit(b,period=period,**values)
    reserve(b,p)
    with pytest.raises(AuthError,match='budget_exhausted'):reserve(b,p)
    with psycopg.connect(b[0][0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_invocations').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_outbox').fetchone()[0]==1


@pytest.mark.parametrize('scope',['global','user','module','model','project'])
def test_every_applicable_scope_intersects_instead_of_overriding(budget,scope):
    b,p=budget
    keys={'global':'*','user':str(b[3].id),'module':'docs','model':'mock/model-1'}
    if scope=='project':
        project=uuid4();t=b[5]
        assert command(b[1],dict(kind='resource',resource_id=str(project),workspace_id=str(t.workspace_id),module='projects')).status_code==200
        configure(b,BindProject(resource_id=t.resource_id,project_id=project));keys['project']=str(project)
    limit(b,scope,keys[scope],usd_micro=500_000)
    with pytest.raises(AuthError,match='budget_exhausted'):reserve(b,p)
    assert buckets(b)==[]


def test_new_limits_and_timezone_changes_do_not_reset_preexisting_spend(budget):
    b,p=budget;r=reserve(b,p);dispatch(b,r);settle(b,r)
    original=buckets(b,period='day')[0]
    limit(b,period='day',usd_micro=900_000)
    configure(b,Timezone(name='America/New_York'))
    assert b[4].configuration(raw(b[1]))['timezone']=='America/New_York'
    with pytest.raises(AuthError,match='budget_exhausted'):reserve(b,p)
    assert buckets(b,period='day')[0]==original
    b[0][2].advance(86400)
    r2=reserve(b,p)
    assert r2['state']=='reserved'
    rows=buckets(b,period='day')
    assert len(rows)==2 and rows[1][8]=='America/New_York' and rows[1][6]>=rows[0][7]
    assert buckets(b)[0][:2]==(400_000,600_000)


def test_lower_cap_preserves_accounting_raise_cap_is_not_a_reset(budget):
    b,p=budget;r=reserve(b,p);dispatch(b,r);settle(b,r)
    limit(b,usd_micro=300_000)
    with pytest.raises(AuthError,match='budget_exhausted'):reserve(b,p)
    limit(b,usd_micro=1_000_000)
    reserve(b,p)
    assert buckets(b)[0][:2]==(400_000,600_000)


def test_reserve_idempotency_hash_and_live_revoke(budget):
    b,p=budget;key=uuid4();r=reserve(b,p,key=key)
    assert reserve(b,p,key=key)==r
    for kwargs in [dict(payload=b'x'*32),dict(bound=UsageBound(input_tokens=1,max_output_tokens=3))]:
        with pytest.raises(AuthError,match='budget_conflict'):reserve(b,p,key=key,**kwargs)
    assert command(b[1],dict(kind='ai_grant',subject_id=str(b[3].id),module='docs',provider='mock',model='model-1',effect='deny')).status_code==200
    with pytest.raises(AuthError,match='forbidden'):reserve(b,p,key=key)
    assert buckets(b)[0][:2]==(0,600_000)


def test_double_settle_repeated_and_distinct_event_ids_never_double_charge(budget):
    b,p=budget;r=reserve(b,p);dispatch(b,r);key=uuid4()
    s=settle(b,r,event=key)
    assert settle(b,r,event=key)==s and settle(b,r)==s
    with pytest.raises(AuthError,match='budget_conflict'):
        settle(b,r,Usage(input_tokens=2,output_tokens=1,usd_micro=399_999))
    assert buckets(b)[0][:6]==(400_000,0,1,0,3,0)


@pytest.mark.parametrize('overrun',['money','tokens','output_only'])
def test_actual_over_estimate_records_full_cost_and_freezes_route(budget,overrun):
    b,p=budget;r=reserve(b,p);dispatch(b,r)
    u=Usage(input_tokens=2,output_tokens=1,usd_micro=2_500_000) if overrun=='money' else Usage(
        input_tokens=2 if overrun=='tokens' else 0,output_tokens=4,usd_micro=400_000)
    settle(b,r,u)
    assert buckets(b)[0][0]==u.usd_micro and buckets(b)[0][1]==0
    with pytest.raises(AuthError,match='budget_route_frozen'):reserve(b,p)
    p2=p.model_copy(update={'id':uuid4()});configure(b,p2)
    with pytest.raises(AuthError,match='budget_route_frozen'):reserve(b,p2)


@pytest.mark.parametrize('failure',['price_missing','price_expired','wrong_model','over_bound','price_poisoned','global_missing','user_missing','zero','csrf','blocked','uninstalled','grant'])
def test_unavailable_or_unauthorized_reserve_fails_before_any_bookkeeping(budget,failure):
    b,p=budget;kw={'csrf':challenge(b[2])}
    if failure=='price_missing':p=p.model_copy(update={'id':uuid4()})
    elif failure=='price_expired':b[0][2].advance(61*86400);assert login(b[2],b[3].email_original).status_code==200
    elif failure=='wrong_model':p=p.model_copy(update={'id':uuid4(),'model':'model-2'});configure(b,p)
    elif failure=='over_bound':kw['bound']=UsageBound(input_tokens=101,max_output_tokens=1)
    elif failure=='zero':limit(b,usd_micro=0)
    elif failure=='grant':assert command(b[1],dict(kind='ai_grant',subject_id=str(b[3].id),module='docs',provider='mock',model='model-1',effect='deny')).status_code==200
    else:
        with psycopg.connect(b[0][0].database_url) as db:
            if failure=='price_poisoned':db.execute("UPDATE qubite_core.ai_budget_prices SET snapshot=jsonb_set(snapshot,'{currency}','\"RUB\"')")
            elif failure.endswith('missing'):
                scope='global' if failure.startswith('global') else 'user'
                db.execute('DELETE FROM qubite_core.ai_budget_limits WHERE account_id IN(SELECT id FROM qubite_core.ai_budget_accounts WHERE scope=%s)',(scope,))
            elif failure=='blocked':db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(b[3].id,))
            elif failure=='uninstalled':db.execute("UPDATE qubite_core.policy_modules SET installed=false WHERE id='docs'")
    with pytest.raises(AuthError):
        if failure=='csrf':b[4].reserve(raw(b[2]),'bad',b[5],p.id,BOUND,uuid4(),HASH)
        else:reserve(b,p,**kw)
    with psycopg.connect(b[0][0].database_url) as db:
        for table in ('ai_budget_invocations','ai_budget_outbox','ai_budget_allocations','ai_budget_buckets'):
            assert db.execute('SELECT count(*) FROM qubite_core.'+table).fetchone()[0]==0


def test_paid_generic_gate_stays_closed_even_after_valid_reservation(budget):
    b,p=budget;reserve(b,p)
    calls=[]
    with pytest.raises(AuthError,match='budget_gate_unavailable'):
        b[4].execute_session(raw(b[2]),b[5],lambda *a:calls.append(1),csrf=challenge(b[2]))
    assert calls==[] and checked(b[2],b[5]).status_code==403
    for path in ('/api/v1/ai/reserve','/api/v1/owner/ai/budgets','/api/v1/ai/webhook'):
        assert b[2].post(path,json={'budget':True}).status_code==404


def test_settlement_after_revocation_and_session_expiry_preserves_billing(budget):
    b,p=budget;r=reserve(b,p);dispatch(b,r)
    assert command(b[1],dict(kind='ai_grant',subject_id=str(b[3].id),module='docs',provider='mock',model='model-1',effect='deny')).status_code==200
    b[0][2].advance(31*86400)
    assert settle(b,r)['state']=='settled' and buckets(b)[0][:2]==(400_000,0)


def test_price_immutable_nonmock_and_forged_models_are_rejected(budget):
    b,p=budget
    with pytest.raises(AuthError,match='price_immutable'):configure(b,p)
    with pytest.raises(AuthError,match='invalid_budget_request'):
        reserve(b,p,target=b[5].model_copy(update={'provider':'openrouter'}))
    with pytest.raises(AuthError,match='invalid_budget_request'):
        reserve(b,p,bound=BOUND.model_construct(input_tokens=True,max_output_tokens=1))
    assert buckets(b)==[]


def test_project_binding_requires_real_project_and_same_workspace(budget):
    b,p=budget;w,project=uuid4(),uuid4()
    assert command(b[1],dict(kind='workspace',workspace_id=str(w),owner_id=str(b[3].id))).status_code==200
    assert command(b[1],dict(kind='resource',resource_id=str(project),workspace_id=str(w),module='projects')).status_code==200
    for invalid in [BindProject(resource_id=b[5].resource_id,project_id=project),
                    BindProject(resource_id=b[5].resource_id,project_id=b[5].resource_id)]:
        with pytest.raises(AuthError,match='invalid_budget_request'):configure(b,invalid)
    with pytest.raises(AuthError,match='invalid_budget_request'):limit(b,'project',str(uuid4()))
    assert reserve(b,p)['state']=='reserved'


def test_provider_request_and_event_identity_cannot_be_reused_for_other_invocation(budget):
    b,p=budget;r=reserve(b,p);r2=reserve(b,p);eid,provider=uuid4(),uuid4()
    b[4].record(r['id'],eid,'dispatched',provider_request_id=provider)
    with pytest.raises(AuthError,match='budget_conflict'):b[4].record(r2['id'],eid,'dispatched',provider_request_id=uuid4())
    with pytest.raises(AuthError,match='budget_conflict'):b[4].record(r2['id'],uuid4(),'dispatched',provider_request_id=provider)
    assert buckets(b)[0][:6]==(0,1_200_000,0,2,0,10)


def test_poisoned_timezone_and_backwards_clock_do_not_create_fresh_allowance(budget):
    b,p=budget;reserve(b,p);b[0][2].advance(86400);reserve(b,p)
    b[0][2].advance(-86400)
    with pytest.raises(AuthError,match='budget_clock_invalid'):reserve(b,p)
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute("UPDATE qubite_core.ai_budget_state SET timezone='Unknown/Zone'")
    with pytest.raises(AuthError,match='budget_timezone_unavailable'):reserve(b,p)
    assert buckets(b)[0][:2]==(0,1_200_000)


def test_outbox_write_failure_rolls_back_reservation_and_all_counters(budget):
    b,p=budget
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute("ALTER TABLE qubite_core.ai_budget_outbox ADD CHECK(state<>'pending')")
    with pytest.raises(AuthError,match='identity_unavailable'):reserve(b,p)
    assert buckets(b)==[]
    with psycopg.connect(b[0][0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_invocations').fetchone()[0]==0


@pytest.mark.parametrize('field,value',[('usd_micro',True),('usd_micro',0.1),('usd_micro','100'),('requests',-1),('tokens',10**12+1)])
def test_no_bool_float_string_negative_overflow_caps(field,value):
    with pytest.raises(ValidationError):BudgetLimit(scope='global',key='*',period='all',**{field:value})


def test_integer_pricing_rounds_up_without_float_and_validates_upper_bound():
    p=Price(id=uuid4(),model='m',input_per_million=1,output_per_million=1,max_input=100,max_output=100,
            expires_at=datetime(2030,2,1,tzinfo=timezone.utc))
    assert quote(p,UsageBound(input_tokens=1,max_output_tokens=1))==2
    assert quote(p,UsageBound(input_tokens=0,max_output_tokens=0))==0
    with pytest.raises(ValueError):quote(p,UsageBound(input_tokens=101,max_output_tokens=0))


@pytest.mark.parametrize('now,zone,period,start,end',[
    ('2030-01-01T19:00:00+00:00','Asia/Yekaterinburg','day','2030-01-01T19:00:00+00:00','2030-01-02T19:00:00+00:00'),
    ('2030-01-31T19:00:00+00:00','Asia/Yekaterinburg','month','2030-01-31T19:00:00+00:00','2030-02-28T19:00:00+00:00'),
    ('2024-03-10T12:00:00+00:00','America/New_York','day','2024-03-10T05:00:00+00:00','2024-03-11T04:00:00+00:00'),
    ('2024-11-03T12:00:00+00:00','America/New_York','day','2024-11-03T04:00:00+00:00','2024-11-04T05:00:00+00:00')])
def test_calendar_midnight_month_and_dst(now,zone,period,start,end):
    assert boundaries(datetime.fromisoformat(now),zone,period)==(datetime.fromisoformat(start),datetime.fromisoformat(end))


def test_owner_controls_require_csrf_reauth_version_and_idempotency(budget):
    b,p=budget;cmd=Timezone(name='UTC');key=uuid4();rev=b[4].configuration(raw(b[1]))['revision']
    with pytest.raises(AuthError,match='forbidden'):configure(b,cmd,actor=b[2])
    with pytest.raises(AuthError,match='csrf_failed'):configure(b,cmd,csrf='bad')
    result=configure(b,cmd,expected=rev,key=key)
    assert configure(b,cmd,expected=rev,key=key)==result
    with pytest.raises(AuthError,match='budget_conflict'):configure(b,Timezone(name='Europe/London'),expected=rev,key=key)
    with pytest.raises(AuthError,match='budget_conflict'):configure(b,cmd,expected=rev)
    b[0][2].advance(301)
    with pytest.raises(AuthError,match='reauth_required'):configure(b,cmd)
    with pytest.raises(ValidationError):Timezone(name='Unknown/Secret')
    with psycopg.connect(b[0][0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_audit WHERE command_id=%s',(key,)).fetchone()[0]==1


def test_owner_has_no_automatic_budget_or_content_bypass(budget):
    b,p=budget;owner=b[0][1]
    with pytest.raises(AuthError,match='forbidden'):reserve(b,p,actor=b[1])
    t=b[5]
    for body in [dict(kind='entitlement',subject_id=str(owner.id),module='docs',action='ai',effect='allow'),
                 dict(kind='membership',subject_id=str(owner.id),workspace_id=str(t.workspace_id),role='editor',enabled=True),
                 dict(kind='acl',subject_id=str(owner.id),resource_id=str(t.resource_id),action='ai',effect='allow'),
                 dict(kind='ai_grant',subject_id=str(owner.id),module='docs',provider='mock',model='model-1',effect='allow')]:
        assert command(b[1],body).status_code==200
    with pytest.raises(AuthError,match='budget_missing'):reserve(b,p,actor=b[1])
    limit(b,'user',str(owner.id),usd_micro=0)
    with pytest.raises(AuthError,match='budget_exhausted'):reserve(b,p,actor=b[1])


def race_worker(url,now,cookie,csrf,target,price,key,count,barrier,queue,mode='reserve',invocation=None):
    store=BudgetStore(Settings(url),lambda:now)
    barrier.wait(timeout=20);ok=[];failed=[]
    for _ in range(count):
        try:
            if mode=='settle':r=store.record(invocation,uuid4(),'settled',usage=Usage(input_tokens=2,output_tokens=1,usd_micro=400_000))
            else:r=store.reserve(cookie,csrf,Target.model_validate(target),price,BOUND,key or uuid4(),HASH)
            ok.append(r['id'])
        except AuthError as e:failed.append(e.code)
    queue.put((ok,failed))


def run_race(b,p,*,keys=(None,None),count=50,mode='reserve',invocation=None,second=None):
    ctx=multiprocessing.get_context('spawn');barrier=ctx.Barrier(3);queue=ctx.Queue()
    targets=[(raw(b[2]),challenge(b[2]),b[5],p.id),second or (raw(b[2]),challenge(b[2]),b[5],p.id)]
    children=[]
    for key,(cookie,csrf,target,price) in zip(keys,targets):
        process=ctx.Process(target=race_worker,args=(b[0][0].database_url,b[0][2](),cookie,csrf,target.model_dump(mode='json'),price,key,count,barrier,queue,mode,invocation))
        process.start();children.append(process)
    try:
        barrier.wait(timeout=20)
        output=[queue.get(timeout=60) for _ in children]
        for process in children:process.join(timeout=10);assert process.exitcode==0
        return [x for o,_ in output for x in o],[x for _,f in output for x in f]
    finally:
        for process in children:
            if process.is_alive():process.terminate();process.join(timeout=5)
        queue.close();queue.join_thread()


def test_two_processes_100_requests_independent_users_models_cannot_exceed_global_cap(budget):
    b,p=budget;limit(b,usd_micro=1_000_000)
    other=member(b[0],email='second@example.test');t=b[5];p2=p.model_copy(update={'id':uuid4(),'model':'model-2'});configure(b,p2)
    for body in [dict(kind='entitlement',subject_id=str(other.id),module='docs',action='ai',effect='allow'),
                 dict(kind='membership',subject_id=str(other.id),workspace_id=str(t.workspace_id),role='editor',enabled=True),
                 dict(kind='acl',subject_id=str(other.id),resource_id=str(t.resource_id),action='ai',effect='allow'),
                 dict(kind='ai_grant',subject_id=str(other.id),module='docs',provider='mock',model='model-2',effect='allow')]:
        assert command(b[1],body).status_code==200
    limit(b,'user',str(other.id))
    with client(b[0]) as u2:
        assert login(u2,other.email_original).status_code==200
        second=(raw(u2),challenge(u2),t.model_copy(update={'model':'model-2'}),p2.id)
        ok,failed=run_race(b,p,second=second)
    assert len(ok)==1 and len(failed)==99 and set(failed)=={'budget_exhausted'}
    dispatch(b,dict(id=ok[0]))
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5)


def test_two_processes_replayed_key_and_double_settle_are_exactly_once(budget):
    b,p=budget;key=uuid4();ok,failed=run_race(b,p,keys=(key,key),count=10)
    assert not failed and len(ok)==20 and len(set(ok))==1
    r=dict(id=ok[0]);dispatch(b,r)
    ok,failed=run_race(b,p,count=10,mode='settle',invocation=r['id'])
    assert not failed and len(ok)==20 and buckets(b)[0][:6]==(400_000,0,1,0,3,0)


def test_budget_migration_is_additive_atomic_and_old_core_cannot_write(database_url):
    s=Settings(database_url);ms=load_migrations();apply(s,ms[:8]);sid=uuid4()
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical) VALUES(%s,'keep@example.test','keep@example.test')",(sid,))
        db.execute("INSERT INTO qubite_core.policy_entitlements VALUES(%s,'docs','ai','allow',NULL)",(sid,))
    broken=Migration(ms[8].version,ms[8].sql+'\nSELECT missing_budget_function();','b'*64)
    with pytest.raises(MigrationError):apply(s,(*ms[:8],broken))
    with psycopg.connect(database_url) as db:
        assert db.execute("SELECT to_regclass('qubite_core.ai_budget_state')").fetchone()[0] is None
    assert apply(s)==('0009_budgets',) and apply(s)==() and check(s)=='0009_budgets'
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT subject_id FROM qubite_core.policy_entitlements').fetchone()[0]==sid
        assert db.execute('SELECT revision,timezone FROM qubite_core.ai_budget_state').fetchone()==(1,'Asia/Yekaterinburg')
        with pytest.raises(MigrationError):apply(s,ms[:8])


def test_budget_schema_drift_and_failed_event_roll_back_without_releasing_money(budget):
    b,p=budget;r=reserve(b,p);dispatch(b,r);nonce=challenge(b[2])
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute("ALTER TABLE qubite_core.ai_budget_events ADD CHECK(kind<>'settled')")
    with pytest.raises(AuthError):settle(b,r)
    assert buckets(b)[0][:6]==(0,600_000,0,1,0,5)
    with psycopg.connect(b[0][0].database_url) as db:
        db.execute('DROP TABLE qubite_core.ai_budget_events')
    with pytest.raises(AuthError,match='identity_unavailable'):reserve(b,p,csrf=nonce)
