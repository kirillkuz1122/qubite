"""Fresh enrollment against real disposable PostgreSQL/HTTP, no external mail."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
from pathlib import Path
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
import psycopg
import pytest

from qubite.app import create_app
from qubite.config import Settings
from qubite.identity.auth import passwords
from qubite.identity.auth.tokens import digest, issue
from qubite.identity.registration.store import RegistrationStore
from qubite.migrations import apply, check, load_migrations, Migration, MigrationError
from test_auth import EMAIL, PASSWORD, ORIGIN, challenge, login, mutate, member
from test_challenges import email, browser, confirm, request, NEW
from test_oauth import oauth, signing_keys, begin, finish

BASE = '/api/v1/owner/registration'
ADDRESS = 'new@example.test'


def owner(c):
    assert login(c).status_code == 200
    return c


def mode(c, value):
    revision = c.get(BASE).headers['etag']
    nonce = challenge(c)
    return c.put(BASE, json={'mode': value}, headers={
        'Origin': ORIGIN, 'X-CSRF-Token': nonce, 'If-Match': revision})


def invite(c, address=None, **extra):
    iid=extra.pop('command_id',str(uuid4()))
    return c.post(BASE+'/invites', json={'email': address, **extra},
                  headers={'Origin':ORIGIN,'X-CSRF-Token':challenge(c),'Idempotency-Key':iid})


def register(c, *, address=ADDRESS, token=None, **extra):
    return mutate(c, '/api/v1/auth/register', json={
        'email': address, 'password': PASSWORD, 'consent_version': 'qubite-account-v1',
        'consent_accepted': True, 'invite_token': token, **extra})


def counts(e):
    with psycopg.connect(e[0].database_url) as db:
        return tuple(db.execute('SELECT count(*) FROM qubite_core.' + t).fetchone()[0]
                     for t in ('subjects','password_credentials','registration_consents','sessions',
                               'policy_entitlements','policy_ai_grants','platform_owner'))


def test_registration_default_contract_strict_dto_and_guard():
    contract = json.loads((Path(__file__).resolve().parents[2] / 'contracts/registration-v1.json').read_text())
    app = create_app(Settings()); spec = app.openapi()
    dto = spec['components']['schemas']['Register']
    assert set(dto['properties']) == set(contract['allowed_fields'])
    assert set(dto['required']) == set(contract['required_fields'])
    assert dto['additionalProperties'] is False
    from qubite.identity.auth.http import sensitive, REGISTRATION_PATHS
    assert all(sensitive(p) for p in REGISTRATION_PATHS)
    assert sensitive(BASE + '/invites/' + str(uuid4()))
    assert spec == json.loads((Path(__file__).resolve().parents[2] / 'contracts/core-v1.json').read_text())
    assert contract['default_mode'] == 'invite' and contract['account_code_entry'] is False


@pytest.mark.parametrize('bound', [True, False])
def test_invited_registration_verify_login_reset_uuid_and_no_grants(email, bound):
    with browser(email) as a, browser(email) as u:
        i = invite(owner(a), ADDRESS if bound else None).json()
        result = register(u, token=i['token'], display_name='  Новый  ')
        assert result.status_code == 202 and result.json() == {'code': 'registration_accepted'}
        assert 'qbt_' not in result.text and '__Host-qubite_session' not in result.headers.get('set-cookie', '')
        assert result.headers['cache-control'] == 'no-store'
        assert login(u, ADDRESS).status_code == 401
        envelope = email[4].items[-1]
        assert envelope.recipient == ADDRESS
        assert confirm(u, envelope).status_code == 204
        assert u.get('/api/v1/me').status_code == 401
        assert login(u, ADDRESS).status_code == 200
        profile = u.get('/api/v1/me').json()
        assert not profile['platform_owner'] and profile['display_name'] == 'Новый'
        assert request(u, 'reset', ADDRESS).status_code == 202
        assert confirm(u, email[4].items[-1]).status_code == 204
        assert login(u, ADDRESS).status_code == 401
        assert login(u, ADDRESS, NEW).status_code == 200
        assert u.get('/api/v1/me').json()['id'] == profile['id']
    with psycopg.connect(email[0].database_url) as db:
        sid = db.execute('SELECT id FROM qubite_core.subjects WHERE email_canonical=%s', (ADDRESS,)).fetchone()[0]
        assert str(sid) == profile['id']
        assert db.execute('SELECT redeemed_by FROM qubite_core.registration_invites WHERE id=%s', (i['id'],)).fetchone()[0] == sid
        assert db.execute('SELECT consent_version,source FROM qubite_core.registration_consents WHERE subject_id=%s', (sid,)).fetchone() == ('qubite-account-v1','invite')
        assert db.execute('SELECT count(*) FROM qubite_core.policy_entitlements').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM qubite_core.policy_ai_grants').fetchone()[0] == 0
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0] == email[1].id


def test_public_mode_then_disabled_does_not_block_existing_verified_account(email):
    with browser(email) as a, browser(email) as u:
        owner(a); assert mode(a, 'public').status_code == 200
        assert register(u).status_code == 202
        assert confirm(u, email[4].items[-1]).status_code == 204
        assert mode(a, 'disabled').status_code == 200
        before = counts(email)
        assert register(u, address='other@example.test').json() == {'code':'registration_closed'}
        assert counts(email) == before
        assert login(u, ADDRESS).status_code == 200
        assert mode(a, 'invite').status_code == 200
        with browser(email) as v:
            assert register(v, address='other@example.test').json() == {'code':'invite_required'}


@pytest.mark.parametrize('extra', [
    {'login':'alias'}, {'fullName':'Имя'}, {'school':'1'}, {'class':'7'}, {'role':'owner'},
    {'platform_owner':True}, {'code':'old-code'}, {'accessCode':'tournament'}, {'invite':'old-name'},
    {'consent_accepted':False}, {'consent_accepted':'true'}, {'consent_accepted':1},
    {'password':'short'}, {'email':'broken'}, {'display_name':'\u0000'}, {'display_name':' '},
    {'display_name':7}, {'consent_version':'stale'}, {'invite_token':issue('qbt_ev_')},
])
def test_invalid_registration_rejects_without_account_credential_consent_write(email, extra):
    with browser(email) as a, browser(email) as u:
        i = invite(owner(a)).json(); before = counts(email)
        r = register(u, token=i['token'], **extra)
        assert r.status_code in {400,409} and PASSWORD not in r.text and i['token'] not in r.text
        assert counts(email) == before
        assert email[4].items == []


@pytest.mark.parametrize('failure', ['wrong_email','expired','revoked','used','unknown','disabled'])
def test_invite_is_one_use_bound_revocable_not_login_or_email_proof(email, failure):
    with browser(email) as a, browser(email) as u:
        owner(a); i = invite(a, ADDRESS).json(); token = i['token']; address = ADDRESS
        if failure == 'wrong_email': address = 'other@example.test'
        elif failure == 'expired': email[2].advance(604801); assert login(a).status_code == 200
        elif failure == 'revoked': assert mutate(a, BASE + '/invites/' + i['id'], method='delete').status_code == 204
        elif failure == 'used':
            assert register(u, token=token).status_code == 202
            address = 'other@example.test'
        elif failure == 'unknown': token = issue('qbt_ri_')
        else: assert mode(a, 'disabled').status_code == 200
        before = counts(email)
        assert register(u, token=token, address=address).status_code in {400,403}
        assert counts(email) == before
        assert login(u, ADDRESS, token).status_code == 401
    with psycopg.connect(email[0].database_url) as db:
        row = db.execute('SELECT token_hash FROM qubite_core.registration_invites WHERE id=%s', (i['id'],)).fetchone()
        assert bytes(row[0]) == digest(i['token'])
        dump = str(db.execute('SELECT * FROM qubite_core.registration_invites').fetchall())
        dump += str(db.execute('SELECT * FROM qubite_core.registration_audit').fetchall())
        assert i['token'] not in dump and PASSWORD not in dump


def test_canonical_collision_uniform_acceptance_no_overwrite_or_invite_consumption(email):
    with browser(email) as a, browser(email) as u:
        i = invite(owner(a)).json(); before = counts(email)
        assert register(u, address='OWNER@EXAMPLE.TEST', token=i['token']).status_code == 202
        assert counts(email) == before and email[4].items == []
        assert register(u, token=i['token']).status_code == 202
    with psycopg.connect(email[0].database_url) as db:
        assert passwords.verify_password(db.execute('SELECT password_hash FROM qubite_core.password_credentials WHERE subject_id=%s', (email[1].id,)).fetchone()[0], PASSWORD)


@pytest.mark.parametrize('kind',['anonymous','member','stale_reauth','revoked','oauth_only'])
def test_owner_management_requires_current_owner_session_own_recent_password(email,kind):
    with browser(email) as a:
        if kind == 'member':
            member(email); assert login(a,'member@example.test').status_code == 200
        elif kind != 'anonymous':
            owner(a)
            if kind == 'stale_reauth': email[2].advance(301)
            elif kind == 'revoked': assert mutate(a,'/api/v1/auth/logout').status_code == 204
            else:
                with psycopg.connect(email[0].database_url) as db:
                    db.execute('UPDATE qubite_core.sessions SET password_proven=false')
        r = invite(a)
        assert r.status_code in {401,403}
        with psycopg.connect(email[0].database_url) as db:
            assert db.execute('SELECT count(*) FROM qubite_core.registration_invites').fetchone()[0] == 0


def test_mode_precondition_invite_list_secret_free_and_unknown_revoke(email):
    with browser(email) as a:
        owner(a); i = invite(a).json()
        r = a.get(BASE + '/invites'); assert r.status_code == 200 and i['token'] not in r.text
        assert mutate(a,BASE,method='put',json={'mode':'public'}).status_code == 428
        nonce = challenge(a)
        r = a.put(BASE,json={'mode':'public'},headers={'Origin':ORIGIN,'X-CSRF-Token':nonce,'If-Match':'"registration-99"'})
        assert r.status_code == 412
        assert a.get(BASE).json()['mode'] == 'invite'
        assert mutate(a,BASE+'/invites/'+str(uuid4()),method='delete').status_code == 404


def test_invite_command_retry_never_duplicates_or_exposes_original_token(email):
    with browser(email) as a:
        owner(a);iid=str(uuid4());r=invite(a,command_id=iid)
        assert r.status_code==201 and r.json()['id']==iid
        again=invite(a,command_id=iid)
        assert again.status_code==409 and again.json()=={'code':'invite_already_issued'}
        assert r.json()['token'] not in again.text
        assert invite(a,ADDRESS,command_id=iid).json()=={'code':'idempotency_conflict'}
        assert len(a.get(BASE+'/invites').json()['items'])==1


@pytest.mark.parametrize('extra',[{'ttl_seconds':True},{'ttl_seconds':59},{'ttl_seconds':604801},
                                {'ttl_seconds':'60'},{'email':'bad'},{'command_id':'bad'}])
def test_owner_invite_validation_creates_no_row(email,extra):
    with browser(email) as a:
        r=invite(owner(a),**extra)
        assert r.status_code==400
        assert a.get(BASE+'/invites').json()['items']==[]


@pytest.mark.parametrize('bad', ['no_origin','bad_csrf','query','legacy_cookie','bearer','duplicate_cookie','oversize','form'])
def test_registration_http_guards(email,bad):
    with browser(email) as a, browser(email) as u:
        i = invite(owner(a)).json(); nonce = challenge(u)
        body = dict(email=ADDRESS,password=PASSWORD,consent_version='qubite-account-v1',consent_accepted=True,invite_token=i['token'])
        h = {'Origin':ORIGIN,'X-CSRF-Token':nonce}; path='/api/v1/auth/register'; kw={'json':body}
        if bad == 'no_origin': h.pop('Origin')
        elif bad == 'bad_csrf': h['X-CSRF-Token']=issue('qbt_c_')
        elif bad == 'query': path += '?token=' + i['token']
        elif bad == 'legacy_cookie': h['Cookie']='qb_session=old'
        elif bad == 'bearer': h['Authorization']='Bearer '+i['token']
        elif bad == 'duplicate_cookie': h['Cookie']='__Host-qubite_preauth=x; __Host-qubite_preauth=y'
        elif bad == 'oversize': kw={'content':'x'*8193};h['Content-Type']='application/json'
        else: kw={'data':body}
        before=counts(email);r=u.post(path,headers=h,**kw)
        assert r.status_code in {400,401,403} and counts(email)==before and email[4].items==[]


def test_email_off_and_failed_delivery_leave_no_active_user(email):
    off = replace(email[0], email_challenges_enabled=False)
    app = create_app(off,auth_clock=email[2],mail_transport=email[4])
    with browser(email) as a:
        i=invite(owner(a)).json()
    with TestClient(app,base_url=ORIGIN) as u:
        before=counts(email)
        assert register(u,token=i['token']).status_code==503 and counts(email)==before
    email[4].result=False
    with browser(email) as u:
        assert register(u,token=i['token']).status_code==202
        assert login(u,ADDRESS).status_code==401
        assert confirm(u,email[4].items[-1]).status_code==400
        email[4].result=True
        assert request(u,address=ADDRESS).status_code==202
        assert confirm(u,email[4].items[-1]).status_code==204
        assert login(u,ADDRESS).status_code==200


@pytest.mark.parametrize('counter',['register_identifier','register_invite','register_ip'])
def test_shared_registration_rates_commit_and_block_before_hash(email,monkeypatch,counter):
    with browser(email) as a, browser(email) as u:
        i=invite(owner(a)).json();store=RegistrationStore(email[0],email[2],email[4])
        limit={'register_identifier':3,'register_invite':5,'register_ip':20}[counter]
        value={'register_identifier':ADDRESS,'register_invite':i['token'],'register_ip':'testclient'}[counter]
        from qubite.identity.auth.store import database
        with database(email[0]) as db:
            for _ in range(limit):assert store._rate(db,counter,value,limit,email[2]())
        def deny(*args):raise AssertionError('Rate rejected must not hash')
        monkeypatch.setattr(passwords,'hash_password',deny)
        before=counts(email)
        assert register(u,token=i['token']).status_code==429 and counts(email)==before


def test_one_preauth_cannot_be_replayed(email):
    with browser(email) as a,browser(email) as u:
        i=invite(owner(a)).json();nonce=challenge(u);raw=u.cookies.get('__Host-qubite_preauth')
        body=dict(email=ADDRESS,password=PASSWORD,consent_version='qubite-account-v1',consent_accepted=True,invite_token=i['token'])
        headers={'Origin':ORIGIN,'X-CSRF-Token':nonce,'Cookie':'__Host-qubite_preauth='+raw}
        assert u.post('/api/v1/auth/register',json=body,headers=headers).status_code==202
        before=counts(email)
        assert u.post('/api/v1/auth/register',json=body,headers=headers).status_code==403
        assert counts(email)==before


@pytest.mark.parametrize('change',['disable','disable_reenable','revoke','consent'])
def test_live_config_invite_rechecked_after_password_work(email,monkeypatch,change):
    with browser(email) as a,browser(email) as u:
        i=invite(owner(a)).json();original=passwords.hash_password
        def during(password):
            phc=original(password)
            if change=='revoke': assert mutate(a,BASE+'/invites/'+i['id'],method='delete').status_code==204
            elif change=='consent':
                with psycopg.connect(email[0].database_url) as db:
                    db.execute("UPDATE qubite_core.registration_state SET consent_version='next'")
            else:
                assert mode(a,'disabled').status_code==200
                if change=='disable_reenable': assert mode(a,'invite').status_code==200
            return phc
        monkeypatch.setattr(passwords,'hash_password',during)
        before=counts(email);r=register(u,token=i['token'])
        assert r.status_code in {400,409} and counts(email)==before and email[4].items==[]


@pytest.mark.parametrize('same_email',[True,False])
def test_concurrent_single_invite_creates_exactly_one_complete_pending_account(email,monkeypatch,same_email):
    with browser(email) as a:
        i=invite(owner(a)).json()
    original=passwords.hash_password;barrier=Barrier(2)
    def hash_together(password):
        phc=original(password);barrier.wait(timeout=10);return phc
    monkeypatch.setattr(passwords,'hash_password',hash_together)
    def call(n):
        with browser(email) as u:
            return register(u,token=i['token'],address=ADDRESS if same_email else f'user{n}@example.test').status_code
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(call,range(2)))
    assert sorted(results)==[202,400]
    assert counts(email)==(2,2,1,1,0,0,1)
    assert len(email[4].items)==1


def test_concurrent_public_canonical_collision_returns_same_acceptance(email,monkeypatch):
    with browser(email) as a: assert mode(owner(a),'public').status_code==200
    original=passwords.hash_password;barrier=Barrier(2)
    def hash_together(password):
        phc=original(password);barrier.wait(timeout=10);return phc
    monkeypatch.setattr(passwords,'hash_password',hash_together)
    def call(n):
        with browser(email) as u:return register(u,address=ADDRESS if n else ADDRESS.upper()).status_code
    with ThreadPoolExecutor(max_workers=2) as pool: assert list(pool.map(call,range(2)))==[202,202]
    assert counts(email)==(2,2,1,1,0,0,1) and len(email[4].items)==1


@pytest.mark.parametrize('table',['password_credentials','registration_consents','registration_audit'])
def test_failure_is_atomic_and_sanitized_including_invite_redemption(email,table):
    with browser(email) as a,browser(email) as u:
        i=invite(owner(a)).json();before=counts(email)
        with psycopg.connect(email[0].database_url) as db:
            db.execute("""CREATE FUNCTION qubite_core.deny_registration() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'private synthetic SQL detail'; END $$""")
            from psycopg import sql
            db.execute(sql.SQL('CREATE TRIGGER deny BEFORE INSERT ON qubite_core.{} FOR EACH ROW EXECUTE FUNCTION qubite_core.deny_registration()').format(sql.Identifier(table)))
        r=register(u,token=i['token'])
        assert r.status_code==503 and 'private' not in r.text and counts(email)==before and email[4].items==[]
        with psycopg.connect(email[0].database_url) as db:
            assert db.execute('SELECT redeemed_at FROM qubite_core.registration_invites WHERE id=%s',(i['id'],)).fetchone()[0] is None


def test_additive_registration_migration_preserves_previous_schema_and_rows(database_url):
    settings=Settings(database_url);ms=load_migrations();apply(settings,ms[:6]);sid=uuid4()
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical) VALUES (%s,'old@example.test','old@example.test')",(sid,))
    broken=Migration(ms[6].version,ms[6].sql+'\nSELECT no_registration_function();','a'*64)
    with pytest.raises(MigrationError): apply(settings,(*ms[:6],broken))
    with psycopg.connect(database_url) as db:
        assert db.execute("SELECT to_regclass('qubite_core.registration_state')").fetchone()[0] is None
        assert db.execute('SELECT id FROM qubite_core.subjects').fetchone()[0]==sid
    assert apply(settings, ms[:7])==('0007_registration',)
    assert apply(settings)==('0008_catalog','0009_budgets','0010_dispatcher', '0011_owner_console') and apply(settings)==() and check(settings)=='0011_owner_console'


@pytest.mark.parametrize('drift',['table','state','checksum'])
def test_registration_storage_drift_fails_closed(email,drift):
    with browser(email) as a,browser(email) as u:
        i=invite(owner(a)).json();nonce=challenge(u)
        with psycopg.connect(email[0].database_url) as db:
            if drift=='table':db.execute('DROP TABLE qubite_core.registration_audit')
            elif drift=='state':db.execute('DELETE FROM qubite_core.registration_state')
            else:db.execute("UPDATE qubite_meta.schema_migrations SET checksum=%s WHERE version='0007_registration'",('0'*64,))
        body=dict(email=ADDRESS,password=PASSWORD,consent_version='qubite-account-v1',consent_accepted=True,invite_token=i['token'])
        assert u.post('/api/v1/auth/register',json=body,headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}).status_code==503


def test_new_registered_verified_uuid_can_explicitly_link_oauth_then_login(oauth):
    from test_challenges import Mail
    mail=Mail();settings=replace(oauth[0],email_challenges_enabled=True)
    app=create_app(settings,auth_clock=oauth[2],oauth_transport=oauth[4].transport,mail_transport=mail)
    with TestClient(app,base_url=ORIGIN) as a,TestClient(app,base_url=ORIGIN) as u:
        assert mode(owner(a),'public').status_code==200
        assert register(u).status_code==202
        assert confirm(u,mail.items[-1]).status_code==204
        assert login(u,ADDRESS).status_code==200
        sid=u.get('/api/v1/me').json()['id']
        state=begin(u,oauth);assert finish(u,'google',state).status_code==204
        assert mutate(u,'/api/v1/auth/logout').status_code==204
        state=begin(u,oauth,intent='login');r=finish(u,'google',state)
        assert r.status_code==200 and r.json()['subject']['id']==sid and not r.json()['subject']['platform_owner']
