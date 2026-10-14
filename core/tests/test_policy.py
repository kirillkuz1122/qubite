"""Real PG/session/REST/job/tool/WS policy tests; synthetic subjects, zero providers."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
from pathlib import Path
from threading import Event
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError
import psycopg
import pytest
from starlette.websockets import WebSocketDisconnect

from qubite.app import create_app
from qubite.config import Settings
from qubite.identity.auth.store import AuthError
from qubite.identity.auth.tokens import csrf_for, digest, issue
from qubite.migrations import apply, check, load_migrations, Migration, MigrationError
from qubite.policy import PolicyStore, Target
from qubite.policy.models import PolicyCommand
from test_auth import auth, client, login, member, mutate, challenge, PASSWORD, ORIGIN

COMMAND = TypeAdapter(PolicyCommand)
CHECK = '/api/v1/policy/check'
MANAGE = '/api/v1/owner/policy/commands'
CATALOG = '/api/v1/owner/policy'
STREAM = '/api/v1/policy/stream'


def command(c, data, *, expected=None, key=None):
    expected = expected or c.get(CATALOG).headers['etag']
    return c.post(MANAGE, json={'reason': 'manual', **data}, headers={
        'Origin': ORIGIN, 'X-CSRF-Token': challenge(c), 'If-Match': expected,
        'Idempotency-Key': str(key or uuid4())})


@pytest.fixture
def policy(auth):
    c = client(auth)
    assert login(c).status_code == 200
    user = member(auth)
    workspace, resource = uuid4(), uuid4()
    with psycopg.connect(auth[0].database_url) as db:
        # Fixture module registrar, not a real Docs installation/domain engine.
        db.execute("UPDATE qubite_core.policy_modules SET installed=true WHERE id IN ('docs','tournaments')")
    for data in [
        dict(kind='module', module='docs', enabled=True),
        dict(kind='workspace', workspace_id=str(workspace), owner_id=str(user.id)),
        dict(kind='resource', resource_id=str(resource), workspace_id=str(workspace), module='docs'),
        dict(kind='entitlement', module='docs', subject_id=str(user.id), action='read', effect='allow'),
        dict(kind='membership', workspace_id=str(workspace), subject_id=str(user.id), role='editor', enabled=True),
        dict(kind='acl', resource_id=str(resource), subject_id=str(user.id), action='read', effect='allow')]:
        r = command(c, data)
        assert r.status_code == 200, r.text
    u = client(auth)
    assert login(u, user.email_original).status_code == 200
    store = PolicyStore(auth[0], auth[2])
    target = Target(module='docs', action='read', workspace_id=workspace, resource_id=resource)
    yield auth, c, u, user, store, target
    u.close(); c.close()


def raw(c): return c.cookies.get('__Host-qubite_session')


def checked(c, target): return mutate(c, CHECK, json=target.model_dump(mode='json'))


def grant_action(p, action):
    _, c, _, user, _, t = p
    for data in [dict(kind='entitlement', subject_id=str(user.id), module='docs', action=action, effect='allow'),
                 dict(kind='acl', subject_id=str(user.id), resource_id=str(t.resource_id), action=action, effect='allow')]:
        assert command(c, data).status_code == 200


def test_fresh_owner_and_member_no_automatic_grants(auth):
    s = member(auth)
    with client(auth) as c:
        for email in ['Owner@example.test', s.email_original]:
            assert login(c, email).status_code == 200
            assert c.get('/api/v1/me/access').json()['items'] == []
            target = Target(module='docs', action='read', workspace_id=uuid4(), resource_id=uuid4())
            assert checked(c, target).json() == {'code': 'forbidden'}
            assert c.get('/api/v1/me').status_code == 200
            status = c.get(CATALOG).status_code
            assert status == (200 if email.startswith('Owner') else 403)


def test_read_write_manage_are_independent_and_metadata_has_no_private_payload(policy):
    _, _, u, _, _, t = policy
    assert checked(u, t).json()['allowed']
    for action in ['write', 'manage', 'ai']:
        target = t.model_copy(update={'action': action})
        if action == 'ai': target = Target(**{**t.model_dump(), 'action': 'ai', 'provider': 'mock', 'model': 'model-1'})
        assert checked(u, target).status_code == 403
    grant_action(policy, 'write')
    assert checked(u, t.model_copy(update={'action': 'write'})).status_code == 200
    assert checked(u, t.model_copy(update={'action': 'manage'})).status_code == 403
    r = u.get('/api/v1/me/access')
    assert [item['action'] for item in r.json()['items']] == ['read', 'write']
    assert 'no-store' in r.headers['cache-control']
    assert set(r.json()) == {'revision', 'items'}


@pytest.mark.parametrize('layer', ['uninstalled', 'disabled', 'entitlement', 'membership', 'acl', 'wrong_workspace', 'wrong_resource', 'wrong_module', 'unknown_module'])
def test_each_gate_layer_denies_without_invoking_effect(policy, layer):
    auth, c, u, user, store, t = policy
    if layer == 'uninstalled':
        with psycopg.connect(auth[0].database_url) as db: db.execute("UPDATE qubite_core.policy_modules SET installed=false WHERE id='docs'")
    elif layer == 'disabled': assert command(c, dict(kind='module', module='docs', enabled=False)).status_code == 200
    elif layer == 'entitlement': assert command(c, dict(kind='entitlement', module='docs', subject_id=str(user.id), action='read', effect='deny')).status_code == 200
    elif layer == 'membership': assert command(c, dict(kind='membership', workspace_id=str(t.workspace_id), subject_id=str(user.id), role='editor', enabled=False)).status_code == 200
    elif layer == 'acl': assert command(c, dict(kind='acl', resource_id=str(t.resource_id), subject_id=str(user.id), action='read', effect='deny')).status_code == 200
    else:
        changes = {'wrong_workspace': {'workspace_id': uuid4()}, 'wrong_resource': {'resource_id': uuid4()},
                   'wrong_module': {'module': 'tournaments'}, 'unknown_module': {'module': 'unknown'}}
        t = t.model_copy(update=changes[layer])
    calls = []
    with pytest.raises(AuthError) as err: store.execute_session(raw(u), t, lambda *a: calls.append(1))
    assert err.value.status == 403 and calls == []
    response = checked(u, t)
    assert response.status_code == 403 and response.json() == {'code': 'forbidden'}


@pytest.mark.parametrize('scope', ['entitlement', 'membership', 'acl'])
def test_expiry_is_checked_live_not_only_at_grant(policy, scope):
    auth, c, u, user, _, t = policy
    expires = (auth[2]()+timedelta(seconds=2)).isoformat()
    body = dict(kind=scope, subject_id=str(user.id), expires_at=expires)
    if scope == 'entitlement': body.update(module='docs', action='read', effect='allow')
    if scope == 'membership': body.update(workspace_id=str(t.workspace_id), role='viewer', enabled=True)
    if scope == 'acl': body.update(resource_id=str(t.resource_id), action='read', effect='allow')
    assert command(c, body).status_code == 200
    assert checked(u, t).status_code == 200
    auth[2].advance(2)
    assert checked(u, t).status_code == 403


@pytest.mark.parametrize('role,action,allowed', [
    ('viewer','read', True), ('viewer','write', False), ('viewer','manage',False),
    ('editor','write',True), ('editor','manage',False), ('manager','manage',True),
    ('organizer','read',False), ('moderator','read',False), ('admin','read',False)])
def test_workspace_roles_are_scoped_and_never_platform_owner(policy, role, action, allowed):
    _, c, u, user, _, t = policy
    if action != 'read': grant_action(policy, action)
    assert command(c, dict(kind='membership', workspace_id=str(t.workspace_id), subject_id=str(user.id), role=role, enabled=True)).status_code == 200
    assert checked(u, t.model_copy(update={'action': action})).status_code == (200 if allowed else 403)
    assert u.get(CATALOG).status_code == 403
    assert u.get('/api/v1/me').json()['platform_owner'] is False


def test_tournament_admin_is_local_and_cannot_read_docs_or_change_policy(policy):
    _, c, u, user, _, t = policy
    r2 = uuid4()
    for data in [dict(kind='module',module='tournaments',enabled=True),
                 dict(kind='resource', module='tournaments',workspace_id=str(t.workspace_id),resource_id=str(r2)),
                 dict(kind='membership', workspace_id=str(t.workspace_id),subject_id=str(user.id),role='admin',enabled=True),
                 dict(kind='entitlement',module='tournaments',subject_id=str(user.id),action='manage',effect='allow'),
                 dict(kind='acl',resource_id=str(r2),subject_id=str(user.id),action='manage',effect='allow')]:
        assert command(c,data).status_code==200
    target=Target(module='tournaments',action='manage',workspace_id=t.workspace_id,resource_id=r2)
    assert checked(u,target).status_code==200
    assert checked(u,t).status_code==403
    assert command(u,dict(kind='module',module='docs',enabled=True),expected='"policy-1"').status_code==403


@pytest.mark.parametrize('field,value', [('actor_subject',str(uuid4())), ('owner',True), ('role','owner'), ('budget',True), ('scopes',['*']), ('channel','job')])
def test_public_check_rejects_forged_actor_privilege_or_budget(policy, field, value):
    _, _, u, _, _, t=policy
    r=mutate(u,CHECK,json={**t.model_dump(mode='json'),field:value})
    assert r.status_code==400 and r.json()=={'code':'invalid_request'}
    assert value not in [r.json().get('input')]


@pytest.mark.parametrize('who', ['member','owner'])
def test_exact_ai_allowlists_and_owner_never_bypass_missing_budget(policy, who):
    auth,c,u,user,store,t=policy
    actor=user.id if who=='member' else auth[1].id
    if who=='owner':
        assert checked(c,t).status_code==403
        assert command(c,dict(kind='membership',workspace_id=str(t.workspace_id),subject_id=str(actor),role='manager',enabled=True)).status_code==200
    for data in [dict(kind='entitlement',module='docs',subject_id=str(actor),action='ai',effect='allow'),
                 dict(kind='acl',resource_id=str(t.resource_id),subject_id=str(actor),action='ai',effect='allow'),
                 dict(kind='ai_grant',module='docs',subject_id=str(actor),provider='mock',model='model-1',effect='allow')]:
        assert command(c,data).status_code==200
    target=Target(**{**t.model_dump(),'action':'ai','provider':'mock','model':'model-1'})
    caller=u if who=='member' else c
    calls=[]
    with pytest.raises(AuthError) as err: store.execute_session(raw(caller),target,lambda *a:calls.append(1))
    assert err.value.code=='budget_gate_unavailable' and calls==[]
    assert checked(caller,target).json()=={'code':'budget_gate_unavailable'}
    assert checked(caller,target.model_copy(update={'model':'model-2'})).json()=={'code':'forbidden'}
    assert checked(caller,target.model_copy(update={'provider':'other'})).json()=={'code':'forbidden'}


@pytest.mark.parametrize('channel', ['job','tool','ws'])
def test_delegation_intersects_session_resource_channel_and_live_revision(policy,channel):
    _,c,u,user,store,t=policy
    token=store.issue_delegation(raw(u),t,channel,csrf=csrf_for(raw(u)))
    calls=[]
    execute=lambda token_,target,channel_:store.execute_delegated(token_,channel_,target,lambda db,d:calls.append(d))
    execute(token,t,channel)
    for forged, target, path in [(raw(u),t,channel),(issue('qbt_d_'),t,channel),
                                 (token,t.model_copy(update={'resource_id':uuid4()}),channel),
                                 (token,t,'job' if channel!='job' else 'tool')]:
        with pytest.raises(AuthError):execute(forged,target,path)
    assert len(calls)==1
    assert command(c,dict(kind='acl',resource_id=str(t.resource_id),subject_id=str(user.id),action='read',effect='deny')).status_code==200
    with pytest.raises(AuthError):execute(token,t,channel)
    assert len(calls)==1
    # Re-grant cannot resurrect a queued old capability.
    assert command(c,dict(kind='acl',resource_id=str(t.resource_id),subject_id=str(user.id),action='read',effect='allow')).status_code==200
    with pytest.raises(AuthError):execute(token,t,channel)
    fresh=store.issue_delegation(raw(u),t,channel,csrf=csrf_for(raw(u)))
    execute(fresh,t,channel)
    assert len(calls)==2


@pytest.mark.parametrize('change',['logout','blocked','auth_version','expiry','delegation_expiry'])
def test_job_tool_reevaluate_originating_session_and_ttl(policy,change):
    auth,_,u,user,store,t=policy
    token=store.issue_delegation(raw(u),t,'job',csrf=csrf_for(raw(u)),ttl=2)
    if change=='logout':assert mutate(u,'/api/v1/auth/logout').status_code==204
    elif change=='delegation_expiry':auth[2].advance(2)
    else:
        with psycopg.connect(auth[0].database_url) as db:
            if change=='blocked':db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(user.id,))
            if change=='auth_version':db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1 WHERE id=%s',(user.id,))
            if change=='expiry':db.execute('UPDATE qubite_core.sessions SET expires_at=%s WHERE subject_id=%s',(auth[2]()+timedelta(seconds=1),user.id))
        if change=='expiry':auth[2].advance(1)
    calls=[]
    with pytest.raises(AuthError):store.run_job(token,t,lambda *a:calls.append(1))
    assert calls==[]


def test_delegations_hash_only_bounded_and_do_not_extend_browser_session(policy):
    auth,_,u,_,store,t=policy
    token=store.issue_delegation(raw(u),t,'tool',csrf=csrf_for(raw(u)))
    with psycopg.connect(auth[0].database_url) as db:
        row=db.execute('SELECT token_hash,target FROM qubite_core.policy_delegations').fetchone()
        assert bytes(row[0])==digest(token) and token not in str(row)
        last=db.execute('SELECT last_seen_at FROM qubite_core.sessions WHERE token_hash=%s',(digest(raw(u)),)).fetchone()
    auth[2].advance(1)
    assert store.run_tool(token,t,lambda db,d:d)['allowed']
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT last_seen_at FROM qubite_core.sessions WHERE token_hash=%s',(digest(raw(u)),)).fetchone()==last
    for _ in range(31):store.issue_delegation(raw(u),t,'tool',csrf=csrf_for(raw(u)))
    with pytest.raises(AuthError) as err:store.issue_delegation(raw(u),t,'tool',csrf=csrf_for(raw(u)))
    assert err.value.status==429
    auth[2].advance(301)
    fresh=store.issue_delegation(raw(u),t,'tool',csrf=csrf_for(raw(u)))
    assert fresh!=token
    with psycopg.connect(auth[0].database_url) as db: assert db.execute('SELECT count(*) FROM qubite_core.policy_delegations').fetchone()[0]==1


@pytest.mark.parametrize('channel,ttl',[('rest',300),('tool',0),('job',301),('ws',True)])
def test_invalid_delegation_never_issued(policy,channel,ttl):
    _,_,u,_,store,t=policy
    with pytest.raises(AuthError):store.issue_delegation(raw(u),t,channel,csrf=csrf_for(raw(u)),ttl=ttl)


def test_management_versions_idempotency_audit_and_reauth(policy):
    auth,c,_,user,_,t=policy
    data=dict(kind='entitlement',module='docs',subject_id=str(user.id),action='write',effect='allow')
    expected=c.get(CATALOG).headers['etag'];key=uuid4()
    a=command(c,data,expected=expected,key=key)
    assert a.status_code==200
    assert command(c,data,expected=expected,key=key).json()==a.json()
    assert command(c,data,expected=expected).status_code==409
    assert command(c,{**data,'effect':'deny'},expected=expected,key=key).status_code==409
    with psycopg.connect(auth[0].database_url) as db:
        row=db.execute('SELECT actor_id,reason,change FROM qubite_core.policy_audit WHERE command_id=%s',(key,)).fetchone()
        assert row[0]==auth[1].id and row[1]=='manual' and row[2]['after']['action']=='write'
        assert PASSWORD not in json.dumps(row[2]) and raw(c) not in json.dumps(row[2])
        assert db.execute('SELECT count(*) FROM qubite_core.policy_audit WHERE command_id=%s',(key,)).fetchone()[0]==1
    auth[2].advance(301)
    assert command(c,data).json()=={'code':'reauth_required'}
    assert mutate(c,'/api/v1/auth/reauth',json={'password':PASSWORD}).status_code==204
    assert command(c,data).status_code==200


def test_oauth_unproven_owner_cannot_mutate_even_with_fresh_session(policy):
    auth,c,_,_,_,_=policy
    with psycopg.connect(auth[0].database_url) as db: db.execute('UPDATE qubite_core.sessions SET password_proven=false WHERE token_hash=%s',(digest(raw(c)),))
    assert c.get(CATALOG).status_code==200
    assert command(c,dict(kind='module',module='docs',enabled=False)).json()=={'code':'reauth_required'}


@pytest.mark.parametrize('headers_', [
    {}, {'If-Match':'*','Idempotency-Key':str(uuid4())}, {'If-Match':'"policy-0"','Idempotency-Key':str(uuid4())},
    {'If-Match':'"policy-1"','Idempotency-Key':'invalid'}])
def test_management_requires_exact_preconditions(policy,headers_):
    _,c,_,_,_,_=policy
    r=c.post(MANAGE,json={'kind':'module','module':'docs','enabled':False,'reason':'manual'},headers={'Origin':ORIGIN,'X-CSRF-Token':challenge(c),**headers_})
    assert r.status_code==(428 if not headers_ else 400)


@pytest.mark.parametrize('body',[
    dict(kind='entitlement',module='unknown',subject_id=str(uuid4()),action='read',effect='allow'),
    dict(kind='workspace',workspace_id=str(uuid4()),owner_id=str(uuid4())),
    dict(kind='resource',workspace_id=str(uuid4()),resource_id=str(uuid4()),module='docs'),
    dict(kind='acl',resource_id=str(uuid4()),subject_id=str(uuid4()),action='read',effect='allow'),
    dict(kind='module',module='docs',enabled=True,installed=True),
    dict(kind='module',module='docs',enabled=True,reason='private note contents')])
def test_invalid_commands_do_not_change_revision_or_audit(policy,body):
    _,c,_,_,_,_=policy
    before=c.get(CATALOG).json()['revision']
    r=command(c,body)
    assert r.status_code==400
    assert c.get(CATALOG).json()['revision']==before


def test_single_concurrent_admin_winner_and_rollback_has_no_partial_grant(policy):
    auth,c,_,user,store,_=policy
    expected=c.get(CATALOG).json()['revision'];cookie=raw(c);nonce=csrf_for(cookie)
    def grant(action):
        try:return store.command(cookie,nonce,COMMAND.validate_python(dict(kind='entitlement',module='docs',subject_id=user.id,action=action,effect='allow',reason='manual')),expected,uuid4())
        except AuthError as e:return e.code
    with ThreadPoolExecutor(max_workers=2) as pool:out=list(pool.map(grant,['write','manage']))
    assert sum(isinstance(v,dict) for v in out)==1 and 'policy_conflict' in out
    with psycopg.connect(auth[0].database_url) as db:
        db.execute('''CREATE FUNCTION qubite_core.fail_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'synthetic failure'; END $$''')
        db.execute('CREATE TRIGGER fail_audit BEFORE INSERT ON qubite_core.policy_audit FOR EACH ROW EXECUTE FUNCTION qubite_core.fail_policy_audit()')
        revision=db.execute('SELECT revision FROM qubite_core.policy_state').fetchone()[0]
    with pytest.raises(AuthError) as err:store.command(cookie,nonce,COMMAND.validate_python(dict(kind='module',module='docs',enabled=False,reason='revoke')),revision,uuid4())
    assert err.value.status==503
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute("SELECT enabled FROM qubite_core.policy_modules WHERE id='docs'").fetchone()[0]
        assert db.execute('SELECT revision FROM qubite_core.policy_state').fetchone()[0]==revision


def test_revoke_serializes_with_effect_and_next_operation_is_denied(policy):
    _,c,u,user,store,t=policy
    entered,release=Event(),Event();calls=[]
    def effect(db,d):
        entered.set();assert release.wait(10);calls.append(1);return d
    with ThreadPoolExecutor(max_workers=2) as pool:
        running=pool.submit(store.execute_session,raw(u),t,effect)
        assert entered.wait(10)
        revision=c.get(CATALOG).json()['revision']
        cmd=COMMAND.validate_python(dict(kind='acl',resource_id=t.resource_id,subject_id=user.id,action='read',effect='deny',reason='revoke'))
        revoke=pool.submit(store.command,raw(c),csrf_for(raw(c)),cmd,revision,uuid4())
        assert not revoke.done()
        release.set();assert running.result(timeout=10)['allowed'];assert revoke.result(timeout=10)['revision']==revision+1
    with pytest.raises(AuthError):store.execute_session(raw(u),t,lambda *a:calls.append(2))
    assert calls==[1]


@pytest.mark.parametrize('invalid',['anonymous','csrf','origin','legacy','bearer','query','body','duplicate'])
def test_http_guards_and_direct_api_cannot_bypass_ui(policy,invalid):
    _,_,u,_,_,t=policy
    body=t.model_dump(mode='json');headers={'Origin':ORIGIN,'X-CSRF-Token':challenge(u)};url=CHECK
    if invalid=='anonymous':u.cookies.clear()
    elif invalid=='csrf':headers['X-CSRF-Token']='invalid'
    elif invalid=='origin':headers['Origin']='https://other.example.test'
    elif invalid=='legacy':u.cookies.clear();headers['Cookie']='qb_session=owner'
    elif invalid=='bearer':headers['Authorization']='Bearer '+raw(u)
    elif invalid=='query':url+='?actor=owner'
    elif invalid=='body':body['extra']='x'*9000
    else:headers=[('Origin',ORIGIN),('Origin',ORIGIN),('X-CSRF-Token',challenge(u))]
    r=u.post(url,json=body,headers=headers)
    assert r.status_code in {400,401,403} and set(r.json())=={'code'}


def test_websocket_rechecks_revocation_and_keeps_no_domain_payload(policy):
    _,c,u,user,_,t=policy
    with u.websocket_connect(ORIGIN.replace('https://','wss://')+STREAM,headers={'Origin':ORIGIN}) as ws:
        ws.send_json({'csrf_token':challenge(u),'target':t.model_dump(mode='json')})
        assert ws.receive_json()['allowed']
        ws.send_json({'type':'check'});assert ws.receive_json()['allowed']
        assert command(c,dict(kind='acl',resource_id=str(t.resource_id),subject_id=str(user.id),action='read',effect='deny')).status_code==200
        # Idle heartbeat detects revoked revision without another client message.
        with pytest.raises(WebSocketDisconnect) as err:ws.receive_json()
        assert err.value.code==1008


@pytest.mark.parametrize('invalid',['anonymous','origin','query','csrf','write','actor','frame'])
def test_websocket_negative_handshake_and_first_frame(policy,invalid):
    _,_,u,_,_,t=policy
    if invalid=='anonymous':u.cookies.clear()
    headers={'Origin':ORIGIN if invalid!='origin' else 'https://other.example.test'}
    url=ORIGIN.replace('https://','wss://')+STREAM+('?token=forged' if invalid=='query' else '')
    with pytest.raises(WebSocketDisconnect) as err:
        with u.websocket_connect(url,headers=headers) as ws:
            body={'csrf_token':challenge(u),'target':t.model_dump(mode='json')}
            if invalid=='csrf':body['csrf_token']='invalid'
            if invalid=='write':body['target']['action']='write'
            if invalid=='actor':body['target']['actor_subject']=str(uuid4())
            if invalid=='frame':ws.send_text('x'*5000)
            else:ws.send_json(body)
            ws.receive_json()
    assert err.value.code==1008


def test_additive_policy_migration_preserves_identity_and_is_atomic(database_url):
    settings=Settings(database_url);migrations=load_migrations();apply(settings,migrations[:5])
    from types import SimpleNamespace
    owner=SimpleNamespace(id=uuid4())
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical,status) VALUES (%s,'migration@example.test','migration@example.test','active')",(owner.id,))
        db.execute('INSERT INTO qubite_core.platform_owner(subject_id) VALUES (%s)',(owner.id,))
    broken=Migration(migrations[5].version,migrations[5].sql+'\nSELECT no_policy_function();','a'*64)
    with pytest.raises(MigrationError):apply(settings,(*migrations[:5],broken))
    with psycopg.connect(database_url) as db:
        assert db.execute("SELECT to_regclass('qubite_core.policy_state')").fetchone()[0] is None
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==owner.id
        assert db.execute('SELECT count(*) FROM qubite_meta.schema_migrations').fetchone()[0]==5
    assert apply(settings)==('0006_policy','0007_registration','0008_catalog') and apply(settings)==() and check(settings)=='0008_catalog'
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.policy_entitlements').fetchone()[0]==0
        assert db.execute('SELECT bool_or(installed OR enabled) FROM qubite_core.policy_modules').fetchone()[0] is False
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==owner.id


@pytest.mark.parametrize('drift',['table','state','history'])
def test_policy_readiness_fails_closed_on_missing_schema(policy,drift):
    auth,_,u,_,_,t=policy
    nonce=challenge(u)
    with psycopg.connect(auth[0].database_url) as db:
        if drift=='table':db.execute('DROP TABLE qubite_core.policy_acl')
        elif drift=='state':db.execute('DELETE FROM qubite_core.policy_state')
        else:db.execute("UPDATE qubite_meta.schema_migrations SET checksum=%s WHERE version='0006_policy'",('0'*64,))
    assert u.get('/api/v1/health/ready').status_code==(200 if drift=='state' else 503)
    assert u.post(CHECK,json=t.model_dump(mode='json'),headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}).status_code==503


def test_policy_contract_and_exact_http_guard_coverage():
    from qubite.policy.models import Target, PolicyCommand
    from qubite.policy.routes import HTTP_PATHS, BODY_PATHS
    from qubite.identity.auth.http import POLICY_PATHS, POLICY_BODY_PATHS
    contract=json.loads((Path(__file__).resolve().parents[2]/'contracts/policy-v1.json').read_text())
    assert contract['target_schema']==Target.model_json_schema()
    assert contract['command_schema']==TypeAdapter(PolicyCommand).json_schema()
    assert contract['default']=='deny' and not contract['permission_inheritance']
    detail='/api/v1/me/modules/{module}'
    assert {r['path'] for r in contract['routes'] if r['path']!=detail}==HTTP_PATHS==POLICY_PATHS
    from qubite.identity.auth.http import sensitive
    assert sensitive(detail.replace('{module}', 'docs')) and sensitive('/api/v1/me/modules/unknown')
    assert {r['path'] for r in contract['routes'] if r['method']=='POST'}==BODY_PATHS==POLICY_BODY_PATHS
    actual=create_app(Settings()).openapi()['paths']
    assert all(r['method'].lower() in actual[r['path']] for r in contract['routes'])
    assert contract['websocket']['path']==STREAM and not contract['delegation']['public_mint']


@pytest.mark.parametrize('expires',['past','naive','too_far'])
def test_grant_expiration_input_is_bounded_and_transaction_unchanged(policy,expires):
    auth,c,_,user,_,_=policy
    value=auth[2]()+timedelta(days=1)
    if expires=='past':value=auth[2]()
    if expires=='naive':value=value.replace(tzinfo=None)
    if expires=='too_far':value=auth[2]()+timedelta(days=366)
    before=c.get(CATALOG).json()['revision']
    r=command(c,dict(kind='entitlement',module='docs',subject_id=str(user.id),action='read',effect='allow',expires_at=value.isoformat()))
    assert r.status_code==400 and c.get(CATALOG).json()['revision']==before


def test_management_can_revoke_but_keeps_workspace_resource_account_and_sessions(policy):
    auth,c,u,user,_,t=policy
    assert command(c,dict(kind='entitlement',module='docs',subject_id=str(user.id),action='read',effect='deny')).status_code==200
    assert checked(u,t).status_code==403 and u.get('/api/v1/me/access').json()['items']==[]
    assert u.get('/api/v1/me').status_code==200
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT id FROM qubite_core.subjects WHERE id=%s',(user.id,)).fetchone()[0]==user.id
        assert db.execute('SELECT id FROM qubite_core.policy_resources WHERE id=%s',(t.resource_id,)).fetchone()[0]==t.resource_id
        assert db.execute('SELECT id FROM qubite_core.policy_workspaces WHERE id=%s',(t.workspace_id,)).fetchone()[0]==t.workspace_id
        assert db.execute('SELECT count(*) FROM qubite_core.sessions WHERE subject_id=%s AND revoked_at IS NULL',(user.id,)).fetchone()[0]==1


def test_another_authenticated_member_never_sees_others_module_or_object(policy):
    auth,_,_,_,_,t=policy
    other=member(auth,'other@example.test')
    with client(auth) as o:
        assert login(o,other.email_original).status_code==200
        assert o.get('/api/v1/me/access').json()['items']==[]
        denied=checked(o,t)
        missing=checked(o,t.model_copy(update={'resource_id':uuid4()}))
        assert denied.status_code==missing.status_code==403 and denied.json()==missing.json()=={'code':'forbidden'}


def test_guarded_db_effect_failure_rolls_back_its_data(policy):
    auth,_,u,_,store,t=policy
    with psycopg.connect(auth[0].database_url) as db:db.execute('CREATE TABLE qubite_core.synthetic_policy_effect(value integer)')
    def effect(db,d):
        db.execute('INSERT INTO qubite_core.synthetic_policy_effect VALUES (1)')
        raise RuntimeError('synthetic module failure')
    with pytest.raises(RuntimeError):store.execute_session(raw(u),t,effect)
    with psycopg.connect(auth[0].database_url) as db:assert db.execute('SELECT count(*) FROM qubite_core.synthetic_policy_effect').fetchone()[0]==0
