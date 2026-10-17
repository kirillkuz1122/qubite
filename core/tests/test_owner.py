"""Owner console against disposable PostgreSQL; no external requests or operator data."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import psycopg
import pytest

from qubite.owner.store import OwnerStore
from qubite.owner.models import Batch, BudgetQuery
from qubite.identity.auth.store import AuthError
from test_auth import auth, client, login, member, challenge, mutate, PASSWORD, ORIGIN
from test_policy import policy, raw, command, checked

BASE='/api/v1/owner/console'


def apply(c,changes,*,etag=None,key=None):
    return c.post(BASE+'/commands',json={'changes':changes},headers={
        'Origin':ORIGIN,'X-CSRF-Token':challenge(c),'If-Match':etag or c.get(BASE).headers['etag'],
        'Idempotency-Key':str(key or uuid4())})


def grant(user,action='write'):
    return dict(kind='entitlement',subject_id=str(user.id),module='docs',action=action,effect='allow',reason='manual')


def test_batch_updates_grants_caps_registration_once_and_records_metadata(policy):
    a,c,u,user,_,_=policy;tag=c.get(BASE).headers['etag']
    changes=[grant(user),dict(kind='limit',scope='user',key=str(user.id),period='day',usd_micro=5_000_000),
             dict(kind='registration',mode='invite')]
    r=apply(c,changes,etag=tag);assert r.status_code==200,r.text
    assert r.json()['count']==3 and r.headers['etag']!='"'+tag+'"'
    assert any(x['action']=='write' for x in u.get('/api/v1/me/access').json()['items'])
    assert c.get('/api/v1/owner/registration').json()['mode']=='invite'
    event=next(e for e in mutate(c,BASE+'/audit',json={}).json()['data']['items'] if e['id']==r.json()['id'])
    assert event['source']=='console' and len(event['changes'])==3
    assert PASSWORD not in str(event) and 'qbt_s_' not in str(event)
    assert c.get(BASE+'/receipts/'+r.json()['id']).json()==r.json()


@pytest.mark.parametrize('invalid',[
    dict(kind='module',module='search',enabled=True,reason='manual'),
    dict(kind='catalog_visibility',module='tournaments',visibility='hidden',reason='manual'),
    dict(kind='limit',scope='project',key=str(uuid4()),period='day',usd_micro=1),
    dict(kind='ai_grant',subject_id=str(uuid4()),module='docs',provider='openai',model='any',effect='allow',reason='manual'),
])
def test_bad_last_change_rolls_back_whole_batch(policy,invalid):
    a,c,u,user,_,_=policy;etag=c.get(BASE).headers['etag']
    r=apply(c,[grant(user),invalid]);assert r.status_code==400,r.text
    assert c.get(BASE).headers['etag']==etag
    assert not any(x['action']=='write' for x in u.get('/api/v1/me/access').json()['items'])
    with psycopg.connect(a[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.owner_console_commands').fetchone()[0]==0


def test_cas_and_lost_response_replay_do_not_duplicate(policy):
    _,c,_,user,_,_=policy;tag=c.get(BASE).headers['etag'];key=uuid4();changes=[grant(user)]
    r=apply(c,changes,etag=tag,key=key);assert r.status_code==200
    assert apply(c,changes,etag=tag,key=key).json()==r.json()
    assert apply(c,[grant(user,'manage')],etag=tag,key=key).status_code==409
    assert apply(c,changes,etag=tag).status_code==409


def test_two_saves_same_revision_only_one_wins(policy):
    a,c,_,user,_,_=policy;store=OwnerStore(a[0],a[2]);etag=store.state(raw(c))['revision'];csrf=challenge(c)
    def save(action):
        try: return store.apply(raw(c),csrf,Batch(changes=[grant(user,action)]),etag,uuid4())['count']
        except AuthError as e: return e.status
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(save,['write','manage']))
    assert sorted(results)==[1,409]


@pytest.mark.parametrize('path,method,body',[
    ('','get',None),('/users','post',{}),('/budget','post',dict(scope='global',key='*')),
    ('/audit','post',{}),('/review','post',dict(changes=[dict(kind='registration',mode='public')])),
    ('/commands','post',dict(changes=[dict(kind='registration',mode='public')])),
    ('/receipts/'+str(uuid4()),'get',None),('/users/'+str(uuid4()),'get',None),
])
def test_nonowner_and_anonymous_cannot_read_or_write(policy,path,method,body):
    a,_,u,_,_,_=policy
    for c,expected in [(u,403),(client(a),401)]:
        kwargs={'json':body,'headers':{'Origin':ORIGIN,'X-CSRF-Token':challenge(c),
                    'If-Match':'"owner-1-1-1"','Idempotency-Key':str(uuid4())}} if method=='post' else {}
        r=getattr(c,method)(BASE+path,**kwargs)
        assert r.status_code==expected,(path,r.text)
        assert r.headers['cache-control']=='no-store'
        if c is not u:c.close()


def test_reauth_expiry_and_csrf_require_live_proof(policy):
    a,c,_,user,_,_=policy;a[2].advance(301)
    assert apply(c,[grant(user)]).json()['code']=='reauth_required'
    assert mutate(c,'/api/v1/auth/reauth',json={'password':PASSWORD}).status_code==204
    assert apply(c,[grant(user)]).status_code==200
    r=c.post(BASE+'/users',json={},headers={'Origin':ORIGIN,'X-CSRF-Token':'qbt_c_'+'A'*43})
    assert r.status_code==403


@pytest.mark.parametrize('headers',[
    {'Origin':'https://evil.example.test'}, {'Host':'evil.example.test','Origin':ORIGIN},
    {'Origin':ORIGIN,'Authorization':'Bearer fake'}, {'Origin':ORIGIN,'Sec-Fetch-Site':'cross-site'}
])
def test_new_surface_preserves_origin_credentials_guard(policy,headers):
    c=policy[1];r=c.post(BASE+'/users',json={},headers=headers)
    assert r.status_code in (400,401,403)


@pytest.mark.parametrize('change',[
    dict(kind='registration',mode='public',platform_owner=True),
    dict(kind='dispatcher',timeout_seconds=True),
    dict(kind='limit',scope='global',key='*',period='day',usd_micro=-1),
    dict(kind='limit',scope='global',key='*',period='day'),
    dict(kind='workspace',workspace_id=str(uuid4()),owner_id=str(uuid4()),reason='manual'),
])
def test_invalid_or_out_of_scope_commands_never_mutate(policy,change):
    c=policy[1];tag=c.get(BASE).headers['etag']
    assert apply(c,[change]).status_code==400
    assert c.get(BASE).headers['etag']==tag


def test_duplicate_targets_and_missing_ifmatch_rejected(policy):
    c=policy[1];change=grant(policy[3])
    assert apply(c,[change,change]).status_code==400
    r=mutate(c,BASE+'/commands',json={'changes':[change]})
    assert r.status_code==428
    assert c.get(BASE+'?token=private').status_code==400


@pytest.mark.parametrize('kind',['account','revoke_sessions'])
def test_owner_cannot_be_blocked_or_demoted_from_console(policy,kind):
    a,c,_,_,_,_=policy;change=dict(kind=kind,subject_id=str(a[1].id))
    if kind=='account':change['blocked']=True
    assert apply(c,[change]).json()['code']=='owner_protected'
    assert c.get('/api/v1/me').status_code==200


def test_block_and_unblock_preserve_verification_and_revoke_sessions(policy):
    a,c,u,user,_,target=policy
    assert apply(c,[dict(kind='account',subject_id=str(user.id),blocked=True)]).status_code==200
    assert u.get('/api/v1/me').status_code==401
    assert apply(c,[dict(kind='account',subject_id=str(user.id),blocked=False)]).status_code==200
    with psycopg.connect(a[0].database_url) as db:
        assert db.execute('SELECT status,email_verified_at,auth_version FROM qubite_core.subjects WHERE id=%s',
                          (user.id,)).fetchone()==('pending',None,3)
    assert login(u,user.email_original).status_code==401


def test_grants_do_not_grant_object_acl_or_paid_authority(policy):
    _,c,u,user,_,target=policy
    assert apply(c,[grant(user,'manage'),grant(user,'ai'),dict(kind='ai_grant',module='docs',subject_id=str(user.id),
        provider='mock',model='m',effect='allow',reason='manual')]).status_code==200
    assert checked(u,target.model_copy(update={'action':'manage'})).status_code==403
    assert checked(u,target.model_copy(update={'action':'ai','provider':'mock','model':'m'})).status_code==403


def test_budget_read_is_readonly_and_holds_old_period_reserves(policy):
    a,c,_,user,_,_=policy
    from qubite.ai import BudgetStore, BudgetLimit
    b=BudgetStore(a[0],a[2]);b.configure(raw(c),challenge(c),BudgetLimit(scope='global',key='*',period='day',usd_micro=100),1,uuid4())
    with psycopg.connect(a[0].database_url) as db:
        account=db.execute("SELECT id FROM qubite_core.ai_budget_accounts WHERE scope='global'").fetchone()[0]
        for days,spent,held in [(-2,50,30),(0,20,10)]:
            start=a[2]()+timedelta(days=days)
            db.execute('''INSERT INTO qubite_core.ai_budget_buckets(id,account_id,period,starts_at,ends_at,timezone,spent_usd,reserved_usd)
                VALUES(%s,%s,'day',%s,%s,'Asia/Yekaterinburg',%s,%s)''',(uuid4(),account,start,start+timedelta(days=1),spent,held))
    data=mutate(c,BASE+'/budget',json=dict(scope='global',key='*')).json()['data']
    assert data['items'][0]['remaining_usd']==40
    assert data['items'][0]['reserved_usd']==40 and data['items'][0]['spent_usd']==20
    with psycopg.connect(a[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_buckets').fetchone()[0]==2


def test_user_keyset_search_and_metadata_are_bounded(policy):
    _,c,_,user,_,_=policy
    page=mutate(c,BASE+'/users',json={'search':user.email_original}).json()['data']
    assert len(page['items'])==1 and page['items'][0]['id']==str(user.id)
    assert mutate(c,BASE+'/users',json={'search':'%'}).json()['data']['items']==[]
    assert c.get(BASE+'/users/'+str(user.id)).json()['data']['grants'][0]['action']=='read'


def test_final_receipt_failure_rolls_back_grants_and_caps(policy):
    a,c,u,user,_,_=policy
    with psycopg.connect(a[0].database_url) as db:
        db.execute('ALTER TABLE qubite_core.owner_console_commands ADD CONSTRAINT reject_receipt CHECK(false)')
    r=apply(c,[grant(user),dict(kind='limit',scope='global',key='*',period='all',usd_micro=500)])
    assert r.status_code==503
    assert not any(g['action']=='write' for g in u.get('/api/v1/me/access').json()['items'])
    with psycopg.connect(a[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.ai_budget_accounts').fetchone()[0]==0


@pytest.mark.parametrize('query',[
    dict(scope='user',key='broken'),dict(scope='global',key='wrong'),
    dict(scope='model',key='missing-slash'),dict(scope='module',key='../tournaments')])
def test_invalid_budget_lookup_sanitized_without_traceback(policy,query):
    r=mutate(policy[1],BASE+'/budget',json=query)
    assert r.status_code==400 and r.json()=={'code':'invalid_budget_request'}


def test_receipt_and_pending_edits_do_not_survive_session_revocation_as_authority(policy):
    a,c,_,user,_,_=policy;r=apply(c,[grant(user)]);tag=c.get(BASE).headers['etag']
    with psycopg.connect(a[0].database_url) as db:db.execute('UPDATE qubite_core.sessions SET revoked_at=%s',(a[2](),))
    assert c.get(BASE+'/receipts/'+r.json()['id']).status_code==401
    assert c.post(BASE+'/commands',json={'changes':[grant(user,'manage')]},headers={
        'Origin':ORIGIN,'If-Match':tag,'Idempotency-Key':str(uuid4()),'X-CSRF-Token':'qbt_c_'+'A'*43}).status_code==401


def test_forward0011_preserves_existing_accounts_grants_and_held_money(database_url):
    from qubite.config import Settings
    from qubite.migrations import apply,check,load_migrations
    settings=Settings(database_url);old=load_migrations()[:-1];apply(settings,old)
    subject,account,bucket=uuid4(),uuid4(),uuid4()
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical,status) VALUES(%s,'preserved@example.test','preserved@example.test','active')",(subject,))
        db.execute("INSERT INTO qubite_core.policy_entitlements VALUES(%s,'docs','read','allow',NULL)",(subject,))
        db.execute("INSERT INTO qubite_core.ai_budget_accounts VALUES(%s,'global','*')",(account,))
        db.execute("INSERT INTO qubite_core.ai_budget_buckets(id,account_id,period,starts_at,timezone,reserved_usd) VALUES(%s,%s,'all','1970-01-01Z','Asia/Yekaterinburg',700)",(bucket,account))
        before=db.execute('SELECT * FROM qubite_core.subjects WHERE id=%s',(subject,)).fetchone()
    assert apply(settings)==('0011_owner_console',) and apply(settings)==() and check(settings)=='0011_owner_console'
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT * FROM qubite_core.subjects WHERE id=%s',(subject,)).fetchone()==before
        assert db.execute('SELECT reserved_usd FROM qubite_core.ai_budget_buckets WHERE id=%s',(bucket,)).fetchone()==(700,)
        assert db.execute('SELECT effect FROM qubite_core.policy_entitlements WHERE subject_id=%s',(subject,)).fetchone()==('allow',)


def test_review_reads_actual_values_without_applying_draft(policy):
    a,c,u,user,_,_=policy;tag=c.get(BASE).headers['etag']
    changes=[grant(user),dict(kind='catalog_visibility',module='docs',visibility='hidden',reason='configure')]
    r=mutate(c,BASE+'/review',json={'changes':changes})
    assert r.status_code==200 and r.headers['etag']==tag
    assert r.json()['data']['items'][0]['current'] is None
    assert r.json()['data']['items'][1]['current']==['locked']
    assert c.get(BASE).headers['etag']==tag
    with psycopg.connect(a[0].database_url) as db:assert db.execute('SELECT count(*) FROM qubite_core.owner_console_commands').fetchone()[0]==0
