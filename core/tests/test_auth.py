"""Real web Auth against disposable PostgreSQL. Passwords/tokens are synthetic."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from threading import Barrier, Event
from types import SimpleNamespace
import time
import warnings
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
import psycopg
from psycopg import sql
import pytest

from qubite.app import create_app
from qubite.config import ConfigurationError, Settings
from qubite.identity import bootstrap_owner, create_subject
from qubite.identity.__main__ import main
from qubite.identity.auth import passwords
from qubite.identity.auth.store import AuthError, AuthStore, database, setup_owner_password
from qubite.identity.auth.tokens import csrf_for, digest, issue
from qubite.migrations import Migration, MigrationError, apply, check, load_migrations

ORIGIN='https://qubite.example.test'
PASSWORD='Synthetic owner pass 42!'
EMAIL='Owner@example.test'


class Clock:
    def __init__(self): self.now=datetime(2030,1,1,tzinfo=timezone.utc)
    def __call__(self): return self.now
    def advance(self,seconds): self.now+=timedelta(seconds=seconds)


@pytest.fixture
def auth(database_url):
    settings=Settings(database_url,auth_origin=ORIGIN)
    apply(settings)
    owner=bootstrap_owner(settings,EMAIL)
    setup_owner_password(settings,PASSWORD)
    clock=Clock()
    return settings,owner,clock,create_app(settings,auth_clock=clock)


def client(auth):
    return TestClient(auth[3],base_url=ORIGIN)


def challenge(c):
    r=c.get('/api/v1/auth/csrf')
    assert r.status_code==200
    return r.json()['csrf_token']


def login(c,email=EMAIL,password=PASSWORD):
    c.cookies.clear()
    nonce=challenge(c)
    return c.post('/api/v1/auth/session',json={'email':email,'password':password},
                  headers={'Origin':ORIGIN,'X-CSRF-Token':nonce})


def mutate(c,path,method='post',**kwargs):
    nonce=challenge(c)
    return getattr(c,method)(path,headers={'Origin':ORIGIN,'X-CSRF-Token':nonce},**kwargs)


def member(auth,email='member@example.test'):
    settings=auth[0]
    s=create_subject(settings,email)
    with psycopg.connect(settings.database_url) as db:
        db.execute("UPDATE qubite_core.subjects SET status='active' WHERE id=%s",(s.id,))
        db.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash) VALUES (%s,%s)',(s.id,passwords.hash_password(PASSWORD)))
    return s


@pytest.mark.parametrize('password',['too short', '', None, True, 'x'*257, '\ud800'*12])
def test_invalid_password_has_no_db_write_or_hash(password,monkeypatch):
    def deny(*a,**k): raise AssertionError('Invalid password must not hash/connect')
    monkeypatch.setattr(passwords,'HASHER',SimpleNamespace(hash=deny))
    monkeypatch.setattr(psycopg,'connect',deny)
    with pytest.raises(AuthError): setup_owner_password(Settings(),password)


def test_argon2id_exact_unicode_salt_and_bounded_parameters():
    text='  ПарольéExact42!  '
    h1=passwords.hash_password(text); h2=passwords.hash_password(text)
    assert h1!=h2 and h1.startswith('$argon2id$v=19$m=19456,t=2,p=1$')
    assert passwords.verify_password(h1,text)
    for changed in [text.strip(),text.lower(),text.replace('é','e\u0301')]:
        assert not passwords.verify_password(h1,changed)
    assert passwords.valid_password('😀'*256) and not passwords.valid_password('😀'*257)


@pytest.mark.parametrize('phc',[None,'plaintext',passwords.DUMMY.replace('m=19456','m=999999999')])
def test_untrusted_phc_never_controls_argon_cost(phc,monkeypatch):
    observed=[]
    def verify(hash,password): observed.append(hash); return True
    monkeypatch.setattr(passwords,'HASHER',SimpleNamespace(verify=verify))
    assert not passwords.verify_password(phc,PASSWORD)
    assert observed==[passwords.DUMMY]


def test_login_profile_cookie_metadata_and_hash_only_storage(auth):
    with client(auth) as c:
        response=login(c)
        assert response.status_code==200
        data=response.json(); raw=c.cookies.get('__Host-qubite_session')
        assert data['subject']=={'id':str(auth[1].id),'email':EMAIL,'display_name':None,'platform_owner':True}
        assert data['session']['current'] and raw.startswith('qbt_s_')
        headers=response.headers.get_list('set-cookie')
        session=next(h for h in headers if h.startswith('__Host-qubite_session='))
        assert all(x in session for x in ['Secure','HttpOnly','SameSite=lax','Path=/','Max-Age=2592000']) and 'Domain=' not in session
        assert c.cookies.get('__Host-qubite_preauth') is None
        assert response.headers['cache-control']=='no-store'
        assert c.get('/api/v1/me').json()==data['subject']
        assert c.get('/api/v1/auth/sessions').json()['items'][0]['id']==data['session']['id']
        assert not any(x in response.text for x in [PASSWORD,raw,'password_hash','token_hash','auth_version','grants'])
    with psycopg.connect(auth[0].database_url) as db:
        stored=db.execute('SELECT token_hash,csrf_hash,auth_version FROM qubite_core.sessions').fetchone()
        assert bytes(stored[0])==digest(raw) and bytes(stored[1])==digest(csrf_for(raw)) and stored[2]==1
        phc=db.execute('SELECT password_hash FROM qubite_core.password_credentials').fetchone()[0]
        assert PASSWORD not in phc and passwords.verify_password(phc,PASSWORD)
        assert db.execute('SELECT count(*) FROM qubite_core.auth_preauth WHERE used_at IS NOT NULL').fetchone()[0]==1


def test_non_owner_profile_never_inherits_management_or_modules(auth):
    s=member(auth)
    with client(auth) as c:
        assert login(c,s.email_original).json()['subject']['platform_owner'] is False
        for path in ['/api/v1/owner/users','/api/v1/search','/api/v1/writing','/api/v1/ai']:
            assert c.get(path).status_code==404
        assert c.get('/api/v1/me').json()['id']==str(s.id)


@pytest.mark.parametrize('state',['unknown','wrong_password','pending','blocked','no_password'])
def test_invalid_login_is_generic_and_failed_attempt_is_consumed(auth,state):
    email=EMAIL; password=PASSWORD
    if state=='unknown': email='unknown@example.test'
    elif state=='wrong_password': password='Synthetic incorrect 42!'
    else:
        s=member(auth); email=s.email_original
        with psycopg.connect(auth[0].database_url) as db:
            if state=='no_password': db.execute('DELETE FROM qubite_core.password_credentials WHERE subject_id=%s',(s.id,))
            else: db.execute('UPDATE qubite_core.subjects SET status=%s WHERE id=%s',(state,s.id))
    with client(auth) as c:
        r=login(c,email,password)
        assert r.status_code==401 and r.json()=={'code':'invalid_credentials'}
        assert PASSWORD not in r.text and email not in r.text
        assert c.cookies.get('__Host-qubite_session') is None
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM qubite_core.auth_preauth WHERE used_at IS NOT NULL').fetchone()[0]==1


@pytest.mark.parametrize('origin',[None,'null','https://evil.example.test',ORIGIN+'/','http://qubite.example.test'])
def test_login_origin_is_exact_and_no_forwarded_host_trust(auth,origin):
    with client(auth) as c:
        nonce=challenge(c); hs={'X-CSRF-Token':nonce,'X-Forwarded-Host':'qubite.example.test'}
        if origin is not None: hs['Origin']=origin
        r=c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},headers=hs)
        assert r.status_code==403 and r.json()['code']=='csrf_failed'
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==0


@pytest.mark.parametrize('case',['missing','wrong','expired','used','other_challenge','no_cookie'])
def test_login_csrf_preauth_binding_ttl_replay(auth,case):
    with client(auth) as c:
        nonce=challenge(c)
        if case=='missing': nonce=None
        elif case=='wrong': nonce=issue('qbt_c_')
        elif case=='expired': auth[2].advance(300)
        elif case=='used':
            assert c.post('/api/v1/auth/session',json={'email':EMAIL,'password':'Synthetic incorrect 42!'},headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}).status_code==401
        elif case=='other_challenge':
            with client(auth) as other: nonce=challenge(other)
        elif case=='no_cookie': c.cookies.clear()
        hs={'Origin':ORIGIN}
        if nonce: hs['X-CSRF-Token']=nonce
        r=c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},headers=hs)
        assert r.status_code==403


def test_preauth_cannot_authenticate_and_failed_cookie_cannot_be_reused_as_session(auth):
    with client(auth) as c:
        challenge(c)
        assert c.get('/api/v1/me').status_code==401
        raw=c.cookies.get('__Host-qubite_preauth')
        c.cookies.clear()
        assert c.get('/api/v1/me',headers={'Cookie':'__Host-qubite_session='+raw}).status_code==401
        c.cookies.set('__Host-qubite_session',issue('qbt_s_'))
        assert c.get('/api/v1/auth/csrf').status_code==401


@pytest.mark.parametrize('cookie',['%E0%A4%A','qbt_s_'+'A'*42,'qbt_s_'+'A'*44,'qbt_r_'+'A'*43,'qbt_k_'+'A'*43,'"qbt_s_'+'A'*43+'"','qbt_s_'+'Ж'*43])
def test_malformed_wrong_kind_cookie_controlled_denial_not_500(auth,cookie):
    # ASGI raw headers permit non-ASCII browser input; no percent decoder is used.
    with client(auth) as c:
        if 'Ж' in cookie:
            cookie=cookie.replace('Ж','é')  # HTTP header Latin-1, still non-ASCII token.
        r=c.get('/api/v1/me',headers=[(b'Cookie',('__Host-qubite_session='+cookie).encode('latin-1'))])
        assert r.status_code==401 and c.get('/api/v1/health/live').status_code==200


@pytest.mark.parametrize('case',['duplicate_cookie','cookie_bearer','legacy','oversized','duplicate_origin','duplicate_authorization','foreign_local_cookie','empty_bearer'])
def test_ambiguous_legacy_oversized_credentials_refused(auth,case):
    with client(auth) as c:
        assert login(c).status_code==200
        raw=c.cookies.get('__Host-qubite_session')
        hs=[]; expected=400
        if case=='duplicate_cookie': hs=[('Cookie',f'__Host-qubite_session={raw}; __Host-qubite_session={raw}')]
        elif case=='cookie_bearer': hs=[('Authorization','Bearer '+issue('qbt_k_'))]
        elif case=='legacy': c.cookies.clear(); hs=[('Cookie','qb_session=old-secret')]; expected=401
        elif case=='oversized': hs=[('Cookie','__Host-qubite_session='+'x'*5000)]
        elif case=='duplicate_origin': hs=[('Origin',ORIGIN),('Origin',ORIGIN)]
        elif case=='duplicate_authorization': c.cookies.clear(); hs=[('Authorization','Bearer x'),('Authorization','Bearer y')]
        elif case=='foreign_local_cookie': c.cookies.clear(); hs=[('Cookie','qubite_local_session='+raw)]; expected=401
        elif case=='empty_bearer': hs=[('Authorization','')]
        r=c.get('/api/v1/me',headers=hs)
        assert r.status_code==expected and r.headers['cache-control']=='no-store'


@pytest.mark.parametrize('prefix',['qbt_s_','qbt_a_','qbt_r_','qbt_k_','qbs_'])
def test_unsupported_bearer_cannot_enter_web_auth(auth,prefix):
    with client(auth) as c:
        assert c.get('/api/v1/me',headers={'Authorization':'Bearer '+issue(prefix)}).status_code==401


@pytest.mark.parametrize('payload',[{'email':EMAIL,'password':PASSWORD,'role':'owner'}, {'email':EMAIL,'password':123}, {'email':EMAIL}, {'email':True,'password':PASSWORD}])
def test_validation_never_echoes_password_or_input(auth,payload):
    with client(auth) as c:
        nonce=challenge(c)
        r=c.post('/api/v1/auth/session',json=payload,headers={'Origin':ORIGIN,'X-CSRF-Token':nonce})
        assert r.status_code==400 and r.json()=={'code':'invalid_request'}
        assert PASSWORD not in r.text and EMAIL not in r.text


@pytest.mark.parametrize('case',['large','invalid_json','content_type','query','host','cross_site'])
def test_http_limits_no_json_error_or_cross_origin_leaks(auth,case):
    with client(auth) as c:
        nonce=challenge(c); hs={'Origin':ORIGIN,'X-CSRF-Token':nonce,'Content-Type':'application/json'}
        path='/api/v1/auth/session'; content=json.dumps({'email':EMAIL,'password':PASSWORD})
        expected=400
        if case=='large': content='x'*8193
        elif case=='invalid_json': content='{private password'
        elif case=='content_type': hs['Content-Type']='text/plain'
        elif case=='query': path+='?password=synthetic-private-query'
        elif case=='host': hs['Host']='evil.example.test'; expected=403
        elif case=='cross_site': hs['Sec-Fetch-Site']='cross-site'; expected=403
        r=c.post(path,content=content,headers=hs)
        assert r.status_code==expected and 'private' not in r.text and PASSWORD not in r.text


@pytest.mark.parametrize('path',['/api/v1/auth/logout','/api/v1/auth/logout-all','/api/v1/auth/sessions/00000000-0000-4000-8000-000000000001','/api/v1/auth/reauth'])
def test_authenticated_mutations_require_csrf_even_with_secure_cookie(auth,path):
    with client(auth) as c:
        assert login(c).status_code==200
        method='delete' if '/sessions/' in path else 'post'
        kwargs={'json':{'password':PASSWORD}} if path.endswith('reauth') else {}
        r=getattr(c,method)(path,headers={'Origin':ORIGIN},**kwargs)
        assert r.status_code==403
        assert c.get('/api/v1/me').status_code==200


def test_logout_and_self_revoke_clear_cookie_immediately(auth):
    with client(auth) as c:
        r=login(c); raw=c.cookies.get('__Host-qubite_session')
        assert mutate(c,'/api/v1/auth/logout').status_code==204 and c.cookies.get('__Host-qubite_session') is None
        assert c.get('/api/v1/me',headers={'Cookie':'__Host-qubite_session='+raw}).status_code==401
        r=login(c)
        assert mutate(c,'/api/v1/auth/sessions/'+r.json()['session']['id'],'delete').status_code==204
        assert c.get('/api/v1/me').status_code==401


def test_session_isolation_cross_account_revoke_and_logout_all(auth):
    s=member(auth)
    with client(auth) as a,client(auth) as b,client(auth) as m:
        ar=login(a); br=login(b); mr=login(m,s.email_original)
        assert mutate(a,'/api/v1/auth/sessions/'+mr.json()['session']['id'],'delete').status_code==404
        assert len(a.get('/api/v1/auth/sessions').json()['items'])==2
        assert mutate(a,'/api/v1/auth/sessions/'+br.json()['session']['id'],'delete').status_code==204
        assert b.get('/api/v1/me').status_code==401 and m.get('/api/v1/me').status_code==200
        assert mutate(a,'/api/v1/auth/logout-all').status_code==204
        assert a.get('/api/v1/me').status_code==401 and m.get('/api/v1/me').status_code==200
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT auth_version FROM qubite_core.subjects WHERE id=%s',(auth[1].id,)).fetchone()[0]==2


def test_recent_reauth_required_and_own_password_checked(auth):
    with client(auth) as a,client(auth) as b:
        assert login(a).status_code==200 and login(b).status_code==200
        auth[2].advance(301)
        assert mutate(a,'/api/v1/auth/logout-all').json()=={'code':'reauth_required'}
        assert mutate(a,'/api/v1/auth/reauth',json={'password':'Synthetic incorrect 42!'}).status_code==401
        assert a.cookies.get('__Host-qubite_session')
        assert a.get('/api/v1/me').status_code==200
        assert mutate(a,'/api/v1/auth/reauth',json={'password':PASSWORD}).status_code==204
        assert mutate(a,'/api/v1/auth/logout-all').status_code==204
        assert b.get('/api/v1/me').status_code==401


@pytest.mark.parametrize('case',['idle','absolute','auth_version','blocked','pending'])
def test_expiry_current_version_and_status_enforced_every_request(auth,case):
    s=member(auth)
    with client(auth) as c:
        assert login(c,s.email_original).status_code==200
        if case=='idle': auth[2].advance(604800)
        elif case=='absolute':
            for _ in range(5):
                auth[2].advance(5*86400); assert c.get('/api/v1/me').status_code==200
            auth[2].advance(5*86400)
        else:
            with psycopg.connect(auth[0].database_url) as db:
                if case=='auth_version': db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1 WHERE id=%s',(s.id,))
                else: db.execute('UPDATE qubite_core.subjects SET status=%s WHERE id=%s',(case,s.id))
        assert c.get('/api/v1/me').status_code==401
        assert c.get('/api/v1/auth/sessions').status_code==401


@pytest.mark.parametrize('local',[False,True])
@pytest.mark.parametrize('cause',['idle','revoked','auth_version'])
def test_unauthenticated_cookie_clears_and_allows_new_login_without_manual_browser_cleanup(auth,local,cause):
    settings = (Settings(auth[0].database_url,auth_origin='http://127.0.0.1:9210',auth_local_http=True)
                if local else auth[0])
    with TestClient(create_app(settings,auth_clock=auth[2]),base_url=settings.auth_origin) as c:
        proof=challenge(c)
        r=c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},
                 headers={'Origin':settings.auth_origin,'X-CSRF-Token':proof})
        assert r.status_code==200
        raw=c.cookies.get(settings.session_cookie)
        if cause=='idle':
            auth[2].advance(604800)
        else:
            with psycopg.connect(settings.database_url) as db:
                if cause=='revoked':
                    db.execute('UPDATE qubite_core.sessions SET revoked_at=%s WHERE id=%s',
                               (auth[2](),r.json()['session']['id']))
                else:
                    db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1 WHERE id=%s',(auth[1].id,))
        r=c.get('/api/v1/auth/csrf')
        assert r.status_code==401 and r.json()=={'code':'unauthenticated'}
        assert c.cookies.get(settings.session_cookie) is None
        header=r.headers['set-cookie']
        assert 'Max-Age=0' in header and 'HttpOnly' in header and 'SameSite=lax' in header and 'Domain=' not in header
        assert ('Secure' in header) is (not local)
        assert raw not in r.text and PASSWORD not in r.text
        proof=challenge(c)
        r=c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},
                 headers={'Origin':settings.auth_origin,'X-CSRF-Token':proof})
        assert r.status_code==200 and c.get('/api/v1/me').status_code==200
        assert c.cookies.get(settings.session_cookie)!=raw


def test_sliding_idle_never_extends_absolute_deadline(auth):
    with client(auth) as c:
        initial=login(c).json()['session']
        auth[2].advance(2*86400)
        row=c.get('/api/v1/auth/sessions').json()['items'][0]
        assert row['expires_at']>initial['expires_at'] and row['absolute_expires_at']==initial['absolute_expires_at']


def test_csrf_proof_is_bound_to_one_session(auth):
    with client(auth) as a,client(auth) as b:
        assert login(a).status_code==200 and login(b).status_code==200
        wrong=challenge(b)
        assert a.post('/api/v1/auth/logout',headers={'Origin':ORIGIN,'X-CSRF-Token':wrong}).status_code==403
        assert a.get('/api/v1/me').status_code==200


def test_shared_identifier_rate_caps_include_failures_and_expire(auth):
    # Different AuthStore objects / IPs still share canonical identifier counter in PG.
    stores=[AuthStore(auth[0],auth[2]),AuthStore(auth[0],auth[2])]
    for i in range(9):
        store=stores[i%2]; raw,nonce=store.new_preauth('192.0.2.'+str(i))
        with pytest.raises(AuthError) as error:
            store.login('OWNER@EXAMPLE.test','Synthetic incorrect 42!',raw,nonce,'192.0.2.'+str(i))
        assert error.value.status==(401 if i<8 else 429)
    auth[2].advance(300)
    raw,nonce=stores[0].new_preauth('192.0.2.1')
    assert stores[0].login(EMAIL,PASSWORD,raw,nonce,'192.0.2.1')[0].startswith('qbt_s_')
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute("SELECT bool_and(length(bucket_hash)=32) FROM qubite_core.auth_rate_limits").fetchone()[0]


@pytest.mark.parametrize('scope,limit',[('bootstrap_ip',60),('login_ip',30)])
def test_ip_rate_cap_precedes_expensive_password_work(auth,scope,limit,monkeypatch):
    store=AuthStore(auth[0],auth[2]); ip='192.0.2.20'
    with database(auth[0]) as db:
        for _ in range(limit): assert store._rate(db,scope,ip,limit,auth[2]())
    def deny(*a,**k): raise AssertionError('Rate-limited request cannot reach Argon2')
    monkeypatch.setattr(passwords,'HASHER',SimpleNamespace(verify=deny))
    if scope=='bootstrap_ip':
        with pytest.raises(AuthError) as error: store.new_preauth(ip)
    else:
        raw,csrf=store.new_preauth(ip)
        with pytest.raises(AuthError) as error: store.login(EMAIL,PASSWORD,raw,csrf,ip)
    assert error.value.status==429


def test_argon_concurrency_capacity_never_queues_unbounded_work(auth):
    assert passwords.SLOTS.acquire(blocking=False) and passwords.SLOTS.acquire(blocking=False)
    try:
        with client(auth) as c:
            r=login(c)
            assert r.status_code==429 and r.headers['Retry-After']=='300'
    finally:
        passwords.SLOTS.release(); passwords.SLOTS.release()


def test_active_session_cap_and_no_account_overwrite(auth):
    with client(auth) as c:
        for _ in range(20):
            assert login(c).status_code==200
            auth[2].advance(301)
        assert login(c).status_code==429
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==20
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==auth[1].id


def test_concurrent_login_single_use_csrf_creates_one_session(auth):
    store=AuthStore(auth[0],auth[2]); raw,nonce=store.new_preauth('192.0.2.1'); barrier=Barrier(2)
    def attempt(i):
        barrier.wait(timeout=10)
        try: return store.login(EMAIL,PASSWORD,raw,nonce,'192.0.2.'+str(i+1))
        except AuthError as error: return error
    with ThreadPoolExecutor(max_workers=2) as workers: results=list(workers.map(attempt,range(2)))
    assert sum(isinstance(r,tuple) for r in results)==1
    assert [r.status for r in results if isinstance(r,AuthError)]==[403]
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==1


@pytest.mark.parametrize('change',['logout_all','block','credential_version'])
def test_password_proof_cannot_issue_stale_session_after_concurrent_change(auth,change,monkeypatch):
    store=AuthStore(auth[0],auth[2]); s=member(auth)
    raw,nonce=store.new_preauth('192.0.2.1')
    existing,_=store.login(s.email_original,PASSWORD,raw,nonce,'192.0.2.1')
    raw,nonce=store.new_preauth('192.0.2.2')
    ready=Event(); resume=Event(); original=passwords.verify_password
    def delayed(phc,password):
        result=original(phc,password); ready.set(); assert resume.wait(timeout=10); return result
    monkeypatch.setattr(passwords,'verify_password',delayed)
    def attempt():
        try: return store.login(s.email_original,PASSWORD,raw,nonce,'192.0.2.2')
        except AuthError as error: return error
    with ThreadPoolExecutor(max_workers=1) as workers:
        future=workers.submit(attempt)
        try:
            assert ready.wait(timeout=10)
            if change=='logout_all': store.authenticated(existing,csrf=csrf_for(existing),action='logout-all')
            else:
                with psycopg.connect(auth[0].database_url) as db:
                    if change=='block': db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(s.id,))
                    else: db.execute('UPDATE qubite_core.password_credentials SET credential_version=credential_version+1 WHERE subject_id=%s',(s.id,))
        finally: resume.set()
        result=future.result(timeout=10)
    assert isinstance(result,AuthError) and result.status==401
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==1


def test_owner_initial_password_repeat_and_competing_setup_preserve_uuid(database_url):
    settings=Settings(database_url); apply(settings); owner=bootstrap_owner(settings,EMAIL)
    barrier=Barrier(2)
    def setup(i):
        barrier.wait(timeout=10)
        try: return setup_owner_password(settings,PASSWORD+str(i))
        except AuthError as error: return error
    with ThreadPoolExecutor(max_workers=2) as workers: results=list(workers.map(setup,range(2)))
    assert sum(r==owner.id for r in results)==1
    assert [r.code for r in results if isinstance(r,AuthError)]==['owner_password_already_configured']
    with pytest.raises(AuthError): setup_owner_password(settings,PASSWORD)
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.password_credentials').fetchone()[0]==1
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==owner.id
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==0


def test_owner_password_cli_uses_hidden_prompt_no_plaintext_output(database_url,monkeypatch,capsys):
    settings=Settings(database_url); apply(settings); owner=bootstrap_owner(settings,EMAIL)
    monkeypatch.setenv('QUBITE_CORE_DATABASE_URL',database_url)
    monkeypatch.setattr(sys.stdin,'isatty',lambda:True); monkeypatch.setattr(sys.stderr,'isatty',lambda:True)
    calls=[]
    def hidden(prompt): calls.append(prompt); return PASSWORD
    monkeypatch.setattr(getpass,'getpass',hidden)
    monkeypatch.setattr('builtins.input',lambda prompt:'SET OWNER PASSWORD')
    assert main(['set-owner-password'])==0 and len(calls)==2
    out=capsys.readouterr(); assert PASSWORD not in out.out+out.err and str(owner.id) in out.out
    assert main(['set-owner-password'])==1


def test_password_cli_refuses_getpass_echo_fallback(monkeypatch,capsys):
    monkeypatch.setenv('QUBITE_CORE_DATABASE_URL','postgresql://fixture@127.0.0.1:1/qubite_core')
    monkeypatch.setattr(sys.stdin,'isatty',lambda:True); monkeypatch.setattr(sys.stderr,'isatty',lambda:True)
    def fallback(prompt):
        warnings.warn('Synthetic disabled echo failure',getpass.GetPassWarning)
        raise AssertionError('Fallback must stop before reading a password')
    def deny(*a,**k): raise AssertionError('Fallback cannot connect or request confirmation')
    monkeypatch.setattr(getpass,'getpass',fallback); monkeypatch.setattr(psycopg,'connect',deny)
    monkeypatch.setattr('builtins.input',deny)
    assert main(['set-owner-password'])==1
    out=capsys.readouterr(); assert 'Скрытый ввод недоступен' in out.out and PASSWORD not in out.out+out.err


def test_password_cli_refuses_non_tty_and_argv_secrets(monkeypatch,capsys):
    monkeypatch.setenv('QUBITE_CORE_DATABASE_URL','postgresql://fixture@127.0.0.1:1/qubite_core')
    monkeypatch.setattr(sys.stdin,'isatty',lambda:False)
    def deny(*a,**k): raise AssertionError('Non-tty cannot read password/connect')
    monkeypatch.setattr(getpass,'getpass',deny); monkeypatch.setattr(psycopg,'connect',deny)
    assert main(['set-owner-password'])==1
    with pytest.raises(SystemExit): main(['set-owner-password','--password',PASSWORD])
    out=capsys.readouterr(); assert PASSWORD not in out.out+out.err


@pytest.mark.parametrize('origin,local',[('http://example.test',False),('http://example.test',True),('https://example.test',True),('https://u:secret@example.test',False),('https://example.test/path',False),('https://example.test/',False),('https://EXAMPLE.test',False),('null',False),(None,True)])
def test_unsafe_auth_origin_or_local_mode_rejected(origin,local):
    with pytest.raises(ConfigurationError): Settings(auth_origin=origin,auth_local_http=local)


def test_local_http_cookies_are_separate_and_production_secure_is_never_downgraded(auth):
    settings=Settings(auth[0].database_url,auth_origin='http://127.0.0.1:9210',auth_local_http=True)
    with TestClient(create_app(settings,auth_clock=auth[2]),base_url=settings.auth_origin) as c:
        nonce=challenge(c)
        r=c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},headers={'Origin':settings.auth_origin,'X-CSRF-Token':nonce})
        assert r.status_code==200 and c.cookies.get('qubite_local_session')
        assert c.cookies.get('__Host-qubite_session') is None
        assert 'Secure' not in r.headers.get_list('set-cookie')[0]
        assert c.get('/api/v1/me').status_code==200
    with TestClient(auth[3],base_url='http://qubite.example.test') as c:
        # Even when TLS is terminated upstream, production cookie is always Secure.
        r=c.get('/api/v1/auth/csrf'); assert 'Secure' in r.headers['set-cookie']
        assert c.cookies.get('__Host-qubite_preauth')
        assert c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},headers={'Origin':ORIGIN,'X-CSRF-Token':r.json()['csrf_token']}).status_code==403


@pytest.mark.parametrize('table',['password_credentials','sessions','auth_preauth','auth_rate_limits'])
def test_missing_auth_table_is_not_ready_and_never_repaired(auth,table):
    with psycopg.connect(auth[0].database_url) as db: db.execute(sql.SQL('DROP TABLE qubite_core.{} CASCADE').format(sql.Identifier(table)))
    with client(auth) as c:
        assert c.get('/api/v1/health/ready').status_code==503
        assert c.get('/api/v1/auth/csrf').json()=={'code':'identity_unavailable'}
    with pytest.raises(MigrationError): apply(auth[0])


def test_auth_migration_failure_preserves_identity_and_recovery_is_explicit(database_url):
    settings=Settings(database_url); migrations=load_migrations()
    apply(settings,migrations[:2])
    # Old account data inserted explicitly before Auth schema is available.
    sid=uuid4()
    with psycopg.connect(database_url) as db:
        db.execute('INSERT INTO qubite_core.subjects(id,email_original,email_canonical) VALUES (%s,%s,%s)',(sid,EMAIL,EMAIL.lower()))
    broken_sql=migrations[2].sql+'\nSELECT no_such_auth_function();'
    broken=Migration('0003_auth',broken_sql,hashlib.sha256(broken_sql.encode()).hexdigest())
    with pytest.raises(MigrationError): apply(settings,(*migrations[:2],broken))
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT id FROM qubite_core.subjects').fetchone()[0]==sid
        assert db.execute('SELECT count(*) FROM qubite_meta.schema_migrations').fetchone()[0]==2
        assert db.execute("SELECT to_regclass('qubite_core.sessions')").fetchone()[0] is None
    assert apply(settings)==('0003_auth','0004_oauth','0005_challenges','0006_policy','0007_registration') and check(settings)=='0007_registration'


def test_password_insert_failure_is_atomic_and_driver_detail_not_returned(auth):
    s=member(auth)
    with psycopg.connect(auth[0].database_url) as db:
        db.execute('DELETE FROM qubite_core.password_credentials WHERE subject_id=%s',(auth[1].id,))
        db.execute("""CREATE FUNCTION qubite_core.reject_password() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic-private-provider-detail'; END $$;
          CREATE TRIGGER reject_password BEFORE INSERT ON qubite_core.password_credentials
          FOR EACH ROW EXECUTE FUNCTION qubite_core.reject_password();""")
    with pytest.raises(AuthError) as error: setup_owner_password(auth[0],PASSWORD)
    assert str(error.value)=='identity_unavailable'
    with psycopg.connect(auth[0].database_url) as db:
        assert db.execute('SELECT subject_id FROM qubite_core.password_credentials').fetchone()[0]==s.id
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==auth[1].id


def test_actual_uvicorn_local_http_login_and_logout(auth,tmp_path):
    with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    env={k:v for k,v in os.environ.items() if k in {'PATH','LANG','LC_ALL','PYTHONPATH'}}
    env.update(HOME=str(tmp_path),PYTHONDONTWRITEBYTECODE='1',QUBITE_CORE_DATABASE_URL=auth[0].database_url,
        QUBITE_CORE_AUTH_ORIGIN=origin,QUBITE_CORE_AUTH_LOCAL_HTTP='true')
    source=Path(__file__).resolve().parents[1]
    env['PYTHONPATH']=os.pathsep.join([str(source),env.get('PYTHONPATH','')])
    with (tmp_path/'uvicorn.log').open('w') as log:
        process=subprocess.Popen([sys.executable,'-m','uvicorn','qubite.app:create_app','--factory','--host','127.0.0.1','--port',str(port),'--no-access-log','--no-proxy-headers'],env=env,cwd=tmp_path,stdout=log,stderr=log)
        try:
            with httpx.Client(base_url=origin,trust_env=False,timeout=2) as c:
                deadline=time.monotonic()+10
                while True:
                    try:
                        if c.get('/api/v1/health/live').status_code==200: break
                    except httpx.TransportError: pass
                    assert time.monotonic()<deadline and process.poll() is None
                    time.sleep(.05)
                r=c.get('/api/v1/auth/csrf')
                nonce=r.json()['csrf_token']
                response=c.post('/api/v1/auth/session',json={'email':EMAIL,'password':PASSWORD},headers={'Origin':origin,'X-CSRF-Token':nonce})
                assert response.status_code==200 and c.get('/api/v1/me').status_code==200
                csrf=c.get('/api/v1/auth/csrf').json()['csrf_token']
                assert c.post('/api/v1/auth/logout',headers={'Origin':origin,'X-CSRF-Token':csrf}).status_code==204
                assert c.get('/api/v1/me').status_code==401
        finally:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
    assert PASSWORD not in (tmp_path/'uvicorn.log').read_text()


def test_login_and_reauth_share_one_identifier_rate_budget(auth):
    with client(auth) as c:
        assert login(c).status_code==200
        for _ in range(7):
            assert mutate(c,'/api/v1/auth/reauth',json={'password':'Synthetic incorrect 42!'}).status_code==401
        assert mutate(c,'/api/v1/auth/reauth',json={'password':PASSWORD}).status_code==429


@pytest.mark.parametrize('action',['logout','logout-all','revoke','snapshot'])
def test_domain_mutation_cannot_accidentally_omit_csrf(auth,action):
    with client(auth) as c:
        assert login(c).status_code==200
        raw=c.cookies.get('__Host-qubite_session')
    with pytest.raises(AuthError) as error: AuthStore(auth[0],auth[2]).authenticated(raw,action=action)
    assert error.value.status==403


def test_wildcard_and_invalid_dns_auth_origin_refused():
    for origin in ['https://*','https://bad_domain.test','https://.example.test']:
        with pytest.raises(ConfigurationError): Settings(auth_origin=origin)


def test_runtime_role_can_login_revoke_but_cannot_assign_owner_or_replace_password(auth,postgres_cluster):
    role='core_auth_'+uuid4().hex; fake_password=uuid4().hex
    with psycopg.connect(**postgres_cluster,autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(fake_password)))
    try:
        with psycopg.connect(auth[0].database_url) as db:
            db.execute(sql.SQL('GRANT USAGE ON SCHEMA qubite_core,qubite_meta TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA qubite_core,qubite_meta TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT UPDATE(auth_version,updated_at) ON qubite_core.subjects TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT UPDATE(credential_version) ON qubite_core.password_credentials TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT INSERT,UPDATE ON qubite_core.sessions,qubite_core.auth_preauth,qubite_core.auth_rate_limits TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT DELETE ON qubite_core.auth_preauth,qubite_core.auth_rate_limits TO {}').format(sql.Identifier(role)))
        parts=psycopg.conninfo.conninfo_to_dict(auth[0].database_url)
        settings=Settings(f"postgresql://{role}:{fake_password}@127.0.0.1:{parts['port']}/{parts['dbname']}?sslmode=disable",auth_origin=ORIGIN)
        with TestClient(create_app(settings,auth_clock=auth[2]),base_url=ORIGIN) as c:
            assert login(c).status_code==200 and c.get('/api/v1/me').status_code==200
            assert mutate(c,'/api/v1/auth/logout-all').status_code==204
        for statement in ["DELETE FROM qubite_core.platform_owner", "UPDATE qubite_core.password_credentials SET password_hash='replacement'", "UPDATE qubite_core.subjects SET status='blocked'"]:
            with pytest.raises(psycopg.errors.InsufficientPrivilege),psycopg.connect(**settings.connection_options()) as db:
                db.execute(statement)
    finally:
        with psycopg.connect(auth[0].database_url) as db:
            db.execute(sql.SQL('DROP OWNED BY {}').format(sql.Identifier(role)))
        with psycopg.connect(**postgres_cluster,autocommit=True) as admin:
            admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


@pytest.mark.parametrize('length',[b'9'*5000,b'\xb2',b'-1'])
def test_content_length_is_bounded_ascii_without_integer_parse_exception(auth,length):
    with client(auth) as c:
        nonce=challenge(c)
        headers=[(b'Origin',ORIGIN.encode()),(b'X-CSRF-Token',nonce.encode()),(b'Content-Length',length),(b'Content-Type',b'application/json')]
        assert c.post('/api/v1/auth/session',content=b'{}',headers=headers).status_code==400
        assert c.get('/api/v1/health/live').status_code==200


def test_runtime_routes_and_openapi_match_partial_identity_contract(auth):
    contract=json.loads((Path(__file__).resolve().parents[2]/'contracts/identity-v2.json').read_text())
    schema=auth[3].openapi()
    for r in contract['routes']:
        operation=schema['paths'].get(r['path'],{}).get(r['method'].lower())
        if r['status']=='implemented':
            assert operation is not None and '422' not in operation['responses'] and '400' in operation['responses']
        else:
            assert operation is None
