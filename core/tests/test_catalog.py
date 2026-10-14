"""Catalog is presentation only: real sessions, PostgreSQL, races and forward migration."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from threading import Barrier
from uuid import uuid4
import psycopg
import pytest
from qubite.config import Settings
from qubite.migrations import apply,check,load_migrations,Migration,MigrationError
from test_auth import auth,client,login,member,mutate,PASSWORD,ORIGIN,challenge
from test_policy import command

OWN='/api/v1/me/modules'
OWNER='/api/v1/owner/modules'

@pytest.fixture
def catalog(auth):
    u=member(auth)
    a,b=client(auth),client(auth)
    assert login(a).status_code==200 and login(b,u.email_original).status_code==200
    yield auth,a,b,u
    a.close();b.close()

def visibility(a,mode='hidden',module='docs',**kwargs):
    return command(a,dict(kind='catalog_visibility',module=module,visibility=mode),**kwargs)

def entitlement(a,u,action='read',effect='allow',expiry=None):
    return command(a,dict(kind='entitlement',module='docs',subject_id=str(u.id),action=action,effect=effect,
                          expires_at=expiry.isoformat() if expiry else None))

def card(b,module='docs'):
    return b.get(OWN+'/'+module)

def test_default_locked_shared_catalog_without_grants_or_installs(catalog):
    auth,a,b,u=catalog
    for c in (a,b):
        r=c.get(OWN);assert r.status_code==200 and r.headers['etag']=='"policy-1"'
        rows=r.json()['items'];assert len(rows)==8 and all(x['status']=='locked' and x['visibility']=='locked' for x in rows)
        assert not any('installed' in x or 'enabled' in x for x in rows)
        assert not {'tournaments','knowledge','inbox'} & {x['module'] for x in rows}
        assert c.get('/api/v1/me/access').json()['items']==[]
    assert all(x['status']=='preparing' and not x['installed'] and not x['released'] for x in a.get(OWNER).json()['items'])
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.policy_entitlements').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM qubite_core.policy_ai_grants').fetchone()[0]==0

@pytest.mark.parametrize('mode',['hidden','locked'])
def test_shared_visibility_persists_and_never_grants(catalog,mode):
    auth,a,b,u=catalog
    assert visibility(a,mode).status_code==200
    with client(auth) as fresh:
        assert login(fresh,u.email_original).status_code==200
        rows=fresh.get(OWN).json()['items']
        assert any(x['module']=='docs' for x in rows)==(mode=='locked')
        r=card(fresh);assert r.status_code==(404 if mode=='hidden' else 200)
        if mode=='hidden':assert r.json()=={'code':'not_found'} and 'Документы' not in r.text
    assert b.get('/api/v1/me/access').json()['items']==[]
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute("SELECT visibility FROM qubite_core.module_catalog WHERE module='docs'").fetchone()[0]==mode
        before,after=db.execute("SELECT change->'before',change->'after' FROM qubite_core.policy_audit").fetchone()
        assert before==['locked'] and after['visibility']==mode

@pytest.mark.parametrize('action',['write','manage','ai'])
def test_other_actions_and_owner_do_not_imply_read(catalog,action):
    _,a,b,u=catalog
    assert visibility(a).status_code==200 and entitlement(a,u,action).status_code==200
    assert card(b).status_code==404 and card(a).status_code==404
    assert a.get(OWNER).status_code==200 and b.get(OWNER).status_code==403

@pytest.mark.parametrize('status',['preparing','unavailable','ready'])
def test_explicit_read_shows_status_without_install_or_domain_bypass(catalog,status):
    auth,a,b,u=catalog
    assert visibility(a).status_code==200 and entitlement(a,u).status_code==200
    if status!='preparing':
        with psycopg.connect(auth[0].database_url) as db:
            # Synthetic registrar flags, not a running domain adapter.
            db.execute("UPDATE qubite_core.policy_modules SET installed=true,enabled=%s WHERE id='docs'",(status=='ready',))
            db.execute("UPDATE qubite_core.module_catalog SET released=true WHERE module='docs'")
    r=card(b);assert r.status_code==200 and r.json()['items'][0]['status']==status
    target=dict(module='docs',action='read',workspace_id=str(uuid4()),resource_id=str(uuid4()))
    assert mutate(b,'/api/v1/policy/check',json=target).status_code==403
    assert entitlement(a,u,effect='deny').status_code==200
    assert card(b).status_code==404


def test_grant_expiry_and_revoked_sessions_drop_metadata(catalog):
    auth,a,b,u=catalog
    expiry=auth[2]()+timedelta(seconds=2)
    assert visibility(a).status_code==200 and entitlement(a,u,expiry=expiry).status_code==200
    assert datetime.fromisoformat(card(b).json()['items'][0]['access_expires_at'].replace('Z','+00:00'))==expiry
    auth[2].advance(3);assert card(b).status_code==404
    with psycopg.connect(auth[0].database_url) as db:db.execute('UPDATE qubite_core.sessions SET revoked_at=%s WHERE subject_id=%s',(auth[2](),u.id))
    assert b.get(OWN).status_code==401

@pytest.mark.parametrize('path',[OWN,OWN+'/docs',OWNER])
def test_metadata_routes_have_strict_cookie_origin_query_guards(auth,path):
    with client(auth) as c:
        assert c.get(path).status_code==401
        assert login(c).status_code==200
        for headers in [{'Origin':'https://evil.example.test'},{'Host':'evil.example.test'},{'Sec-Fetch-Site':'cross-site'}]:
            assert c.get(path,headers=headers).status_code==403
        assert c.get(path+'?role=owner').status_code==400
        r=c.get(path);assert r.status_code==200 and r.headers['cache-control']=='no-store' and r.headers['referrer-policy']=='no-referrer'

@pytest.mark.parametrize('id',['unknown','tournaments','knowledge','UpperCase','0'*80])
def test_unknown_and_hidden_ids_have_same_missing_response(catalog,id):
    _,a,b,_=catalog
    assert visibility(a).status_code==200
    assert card(b,id).json()==card(b).json()=={'code':'not_found'}
    assert card(b,id).status_code==404


def test_owner_gate_csrf_recent_password_and_strict_commands(catalog):
    auth,a,b,_=catalog
    data=dict(kind='catalog_visibility',module='docs',visibility='hidden')
    assert command(b,data,expected='"policy-1"').status_code==403
    assert a.post('/api/v1/owner/policy/commands',json={**data,'reason':'configure'},headers={'Origin':ORIGIN,'If-Match':'"policy-1"','Idempotency-Key':str(uuid4())}).status_code==403
    for extra in [{'visibility':'public'},{'subject_id':str(uuid4())},{'installed':True},{'module':'tournaments'}]:
        assert command(a,{**data,**extra}).status_code==400
    auth[2].advance(301)
    assert visibility(a).json()=={'code':'reauth_required'}
    assert mutate(a,'/api/v1/auth/reauth',json={'password':PASSWORD}).status_code==204
    assert visibility(a).status_code==200


def test_replay_race_conflict_and_atomic_audit(catalog):
    auth,a,_,_=catalog
    key=uuid4();expected=a.get(OWNER).headers['etag']
    first=visibility(a,key=key,expected=expected);assert first.status_code==200
    assert visibility(a,key=key,expected=expected).json()==first.json()
    assert visibility(a,'locked',key=key,expected=expected).status_code==409
    assert visibility(a,'locked',expected=expected).status_code==409
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.policy_audit').fetchone()[0]==1
    expected=a.get(OWNER).headers['etag'];barrier=Barrier(2)
    def race(i):
        with client(auth) as c:
            assert login(c).status_code==200;barrier.wait()
            return visibility(c,'locked',module=['docs','vpn'][i],expected=expected).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(race,range(2)))==[200,409]
    with psycopg.connect(auth[0].database_url) as db:
        db.execute("""CREATE FUNCTION qubite_core.break_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic private detail'; END $$""")
        db.execute('CREATE TRIGGER break_audit BEFORE INSERT ON qubite_core.policy_audit FOR EACH ROW EXECUTE FUNCTION qubite_core.break_audit()')
        before=db.execute('SELECT module,visibility FROM qubite_core.module_catalog ORDER BY module').fetchall()
    r=visibility(a,'locked');assert r.status_code==503 and 'private' not in r.text
    with psycopg.connect(auth[0].database_url) as db:assert db.execute('SELECT module,visibility FROM qubite_core.module_catalog ORDER BY module').fetchall()==before


def test_forward_migration_preserves_old_identity_and_grants_and_fails_atomically(database_url):
    settings=Settings(database_url);ms=load_migrations();apply(settings,ms[:7]);sid=uuid4()
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical) VALUES (%s,'keep@example.test','keep@example.test')",(sid,))
        db.execute("INSERT INTO qubite_core.policy_entitlements VALUES (%s,'docs','read','allow',NULL)",(sid,))
    broken=Migration(ms[7].version,ms[7].sql+'\nSELECT no_catalog_function();','a'*64)
    with pytest.raises(MigrationError):apply(settings,(*ms[:7],broken))
    with psycopg.connect(database_url) as db:
        assert db.execute("SELECT to_regclass('qubite_core.module_catalog')").fetchone()[0] is None
        assert db.execute("SELECT count(*) FROM qubite_core.policy_modules WHERE id='projects'").fetchone()[0]==0
    assert apply(settings)==('0008_catalog',) and apply(settings)==() and check(settings)=='0008_catalog'
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT subject_id FROM qubite_core.policy_entitlements').fetchone()[0]==sid
        assert db.execute('SELECT count(*) FROM qubite_core.module_catalog').fetchone()[0]==8


def test_catalog_schema_drift_denies_without_repair(catalog):
    auth,a,b,_=catalog
    with psycopg.connect(auth[0].database_url) as db:db.execute('DROP TABLE qubite_core.module_catalog')
    assert a.get('/api/v1/health/ready').status_code==503 and b.get(OWN).status_code==503
