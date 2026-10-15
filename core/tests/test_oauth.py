"""Real PostgreSQL/browser protocol with signed fixtures and no provider network."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
import base64
import hashlib
import json
from threading import Barrier
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
import httpx
import jwt
import psycopg
from psycopg import sql
import pytest

from qubite.app import create_app
from qubite.config import OAuthClient, Settings, ConfigurationError
from qubite.identity.auth.store import AuthError, AuthStore, setup_owner_password
from qubite.identity.auth.tokens import digest, csrf_for, issue
from qubite.identity.oauth.providers import PROVIDERS, Exchange, SLOTS
from qubite.identity.oauth.store import OAuthStore, set_enabled
from qubite.identity.oauth.__main__ import main as operator
from qubite.identity import bootstrap_owner
from qubite.migrations import apply, check, load_migrations, Migration, MigrationError
from test_auth import Clock, ORIGIN, EMAIL, PASSWORD, challenge, login, mutate, member


@pytest.fixture(scope='session')
def signing_keys():
    key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
    other = rsa.generate_private_key(public_exponent=65537,key_size=2048)
    return key, other


class Upstream:
    def __init__(self,settings,clock,keys):
        self.settings,self.clock,self.key,self.other=settings,clock,*keys
        self.flows={}; self.calls=[]; self.claim_changes={}; self.token_changes={}; self.info_changes={}
        self.jwks_changes=None; self.bad_signature=False; self.on_token=None; self.response=None
        self.transport=httpx.MockTransport(self.handle)

    def remember(self,url):
        q={k:v[0] for k,v in parse_qs(urlsplit(url).query).items()}
        self.flows[q['state']]=q
        return q['state']

    def handle(self,request):
        self.calls.append((request.method,str(request.url)))
        if self.response:
            return self.response(request)
        name=next(n for n,p in PROVIDERS.items() if str(request.url) in (p.token,p.info,p.jwks))
        p=PROVIDERS[name]; client=self.settings.oauth_client(name)
        form={k:v[0] for k,v in parse_qs(request.content.decode()).items()}
        if str(request.url)==p.token:
            q=self.flows[form['code']]
            assert form['client_id']==q['client_id']==client.client_id
            assert form['redirect_uri']==q['redirect_uri']==ORIGIN+f'/api/v1/auth/oauth/{name}/callback'
            assert len(form['code_verifier'])==43
            computed=base64.urlsafe_b64encode(hashlib.sha256(form['code_verifier'].encode()).digest()).rstrip(b'=').decode()
            assert computed==q['code_challenge']
            if name in {'telegram','yandex'}:
                assert request.headers['authorization']=='Basic '+base64.b64encode((client.client_id+':'+client.secret).encode()).decode()
            if name=='google': assert form['client_secret']==client.secret
            if name=='vk': assert form['state']==q['state'] and form['device_id']=='synthetic-device'
            payload={'access_token':'synthetic-upstream-token','token_type':'bearer','expires_in':3600,'state':q['state'],'user_id':777}
            if p.jwks:
                claims={'iss':p.issuer,'aud':client.client_id,'sub':'777','iat':int(self.clock().timestamp()),
                        'exp':int(self.clock().timestamp())+3600,'nonce':q['nonce'],
                        'email':EMAIL,'email_verified':False,'role':'owner','platform_owner':True}
                claims.update(self.claim_changes)
                payload['id_token']=jwt.encode(claims,self.other if self.bad_signature else self.key,algorithm='RS256',headers={'kid':'fixture'})
            payload.update(self.token_changes)
            if self.on_token: self.on_token()
        elif p.jwks:
            public=jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key(),as_dict=True)
            public.update(kid='fixture',use='sig',alg='RS256')
            payload=self.jwks_changes if self.jwks_changes is not None else {'keys':[public]}
        elif name=='yandex':
            assert request.headers['authorization']=='OAuth synthetic-upstream-token'
            assert not urlsplit(str(request.url)).query
            payload={'id':'777','client_id':client.client_id,'default_email':EMAIL,'email_verified':False}
            payload.update(self.info_changes)
        else:
            assert form=={'client_id':client.client_id,'access_token':'synthetic-upstream-token'}
            payload={'user':{'user_id':777,'email':EMAIL,'email_verified':False}}
            payload.update(self.info_changes)
        return httpx.Response(200,json=payload)


@pytest.fixture
def oauth(database_url,signing_keys):
    clients=tuple(OAuthClient(n,'123456' if n=='telegram' else 'fixture-'+n,None if n=='vk' else 'synthetic-secret-'+n) for n in PROVIDERS)
    settings=Settings(database_url,auth_origin=ORIGIN,oauth_clients=clients)
    apply(settings); owner=bootstrap_owner(settings,EMAIL); setup_owner_password(settings,PASSWORD)
    for n in PROVIDERS: set_enabled(settings,n,True)
    clock=Clock(); upstream=Upstream(settings,clock,signing_keys)
    app=create_app(settings,auth_clock=clock,oauth_transport=upstream.transport)
    return settings,owner,clock,app,upstream


def browser(oauth): return TestClient(oauth[3],base_url=ORIGIN)


def begin(c,oauth,name='google',intent='link',password=PASSWORD):
    proof=challenge(c)
    body={'intent':intent}
    if intent=='link': body['password']=password
    r=c.post(f'/api/v1/auth/oauth/{name}/start',json=body,headers={'Origin':ORIGIN,'X-CSRF-Token':proof})
    assert r.status_code==200,r.text
    state=oauth[4].remember(r.json()['authorization_url'])
    return state


def finish(c,name,state,**extra):
    query={'state':state,'code':state}
    if name=='vk':query['device_id']='synthetic-device'
    query.update(extra)
    return c.get(f'/api/v1/auth/oauth/{name}/callback',params=query)


@pytest.mark.parametrize('name',list(PROVIDERS))
def test_explicit_link_then_login_uses_stable_pair_and_secure_hash_only_cookie(oauth,name):
    with browser(oauth) as c:
        assert login(c).status_code==200
        original=c.cookies.get('__Host-qubite_session')
        state=begin(c,oauth,name); flow_cookie=c.cookies.get('__Host-qubite_oauth')
        assert oauth[4].calls==[]
        r=finish(c,name,state); assert r.status_code==204 and not r.content
        assert c.cookies.get('__Host-qubite_session')==original and c.cookies.get('__Host-qubite_oauth') is None
        linked=c.get('/api/v1/me/oauth').json()['items']; assert len(linked)==1 and linked[0]['provider']==name
        assert '777' not in json.dumps(linked) and 'synthetic-secret' not in json.dumps(linked)
        assert mutate(c,'/api/v1/auth/logout').status_code==204
        state=begin(c,oauth,name,'login'); r=finish(c,name,state)
        assert r.status_code==200 and r.json()['subject']['id']==str(oauth[1].id)
        raw=c.cookies.get('__Host-qubite_session'); assert raw!=original and raw not in r.text
        assert PASSWORD not in r.text and 'synthetic-upstream-token' not in r.text
        cookie=r.headers['set-cookie']; assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=lax' in cookie and 'Domain=' not in cookie
        assert r.headers['cache-control']=='no-store' and r.headers['referrer-policy']=='no-referrer'
        assert c.get('/api/v1/me').status_code==200
        assert mutate(c,'/api/v1/auth/logout-all').json()=={'code':'reauth_required'}
        assert mutate(c,'/api/v1/auth/reauth',json={'password':PASSWORD}).status_code==204
        assert mutate(c,'/api/v1/auth/logout-all').status_code==204
    with psycopg.connect(oauth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.subjects').fetchone()[0]==1
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==oauth[1].id
        rows=db.execute('SELECT state_hash,browser_hash FROM qubite_core.oauth_states').fetchall()
        assert all(len(bytes(v))==32 for row in rows for v in row)
        assert db.execute('SELECT count(*) FROM qubite_core.oauth_states WHERE used_at IS NULL').fetchone()[0]==0
        assert len(db.execute('SELECT * FROM qubite_core.oauth_audit').fetchall())==6 # Four enable events, link, login, no logout audit.
        dump=' '.join(str(r) for r in db.execute('SELECT * FROM qubite_core.oauth_states').fetchall())
        assert state not in dump and flow_cookie not in dump and PASSWORD not in dump


@pytest.mark.parametrize('verified',[False,True,None])
@pytest.mark.parametrize('name',list(PROVIDERS))
def test_matching_even_verified_email_never_links_or_creates_subject(oauth,name,verified):
    oauth[4].claim_changes={'email':EMAIL,'email_verified':verified}
    with browser(oauth) as c:
        state=begin(c,oauth,name,'login'); r=finish(c,name,state)
        assert r.status_code==409 and r.json()=={'code':'oauth_identity_unlinked'}
        assert c.cookies.get('__Host-qubite_session') is None
    with psycopg.connect(oauth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.subjects').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM qubite_core.oauth_identities').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==0


@pytest.mark.parametrize('name',list(PROVIDERS))
def test_callback_rechecks_disabled_before_exchange_and_reenabled_version_cannot_revive(oauth,name):
    with browser(oauth) as c:
        state=begin(c,oauth,name,'login'); set_enabled(oauth[0],name,False)
        assert finish(c,name,state).json()=={'code':'provider_disabled'} and oauth[4].calls==[]
        set_enabled(oauth[0],name,True)
        assert finish(c,name,state).json()=={'code':'oauth_context_changed'} and oauth[4].calls==[]


@pytest.mark.parametrize('name',list(PROVIDERS))
def test_disable_during_exchange_prevents_link_or_session(oauth,name):
    with browser(oauth) as c:
        assert login(c).status_code==200
        state=begin(c,oauth,name)
        oauth[4].on_token=lambda:set_enabled(oauth[0],name,False)
        r=finish(c,name,state); assert r.status_code==403
    with psycopg.connect(oauth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.oauth_identities').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM qubite_core.sessions').fetchone()[0]==1


@pytest.mark.parametrize('case',['expired','wrong_browser','wrong_state','wrong_provider','replay'])
def test_state_binding_expiry_replay_and_provider_mixup(oauth,case):
    with browser(oauth) as c:
        assert login(c).status_code==200
        state=begin(c,oauth)
        name='google'
        if case=='expired':oauth[2].advance(300)
        elif case=='wrong_browser':c.cookies.set('__Host-qubite_oauth','qbt_f_'+'a'*43,domain='qubite.example.test',path='/')
        elif case=='wrong_state':state='qbt_o_'+'a'*43
        elif case=='wrong_provider':name='yandex'
        else:assert finish(c,name,state).status_code==204
        before=len(oauth[4].calls)
        assert finish(c,name,state).status_code==403 and len(oauth[4].calls)==before


@pytest.mark.parametrize('changes',[{'iss':'https://evil.test'},{'aud':'another-app'},{'nonce':'wrong'},
 {'exp':0},{'iat':9999999999},{'exp':True},{'sub':''},{'aud':['fixture-google','other'],'azp':'other'},
 {'nbf':9999999999},{'exp':float('inf')}])
@pytest.mark.parametrize('name',['google','telegram'])
def test_oidc_signed_claim_validation(oauth,changes,name):
    oauth[4].claim_changes=changes
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth,name)
        r=finish(c,name,state); assert r.status_code==502 and r.json()=={'code':'provider_invalid_response'}
        assert EMAIL not in r.text and PASSWORD not in r.text
    with psycopg.connect(oauth[0].database_url) as db:assert db.execute('SELECT count(*) FROM qubite_core.oauth_identities').fetchone()[0]==0


@pytest.mark.parametrize('case',['bad_signature','missing_kid','too_many','private','bad_algorithm','none_algorithm'])
def test_jwks_signature_algorithm_and_key_boundaries(oauth,case):
    mock=oauth[4]
    if case=='bad_signature': mock.bad_signature=True
    elif case=='missing_kid': mock.jwks_changes={'keys':[{'kid':'other'}]}
    elif case=='too_many': mock.jwks_changes={'keys':[{}]*9}
    elif case=='none_algorithm': mock.token_changes={'id_token':jwt.encode({'sub':'777'},key='',algorithm='none')}
    else:
        k=jwt.algorithms.RSAAlgorithm.to_jwk(mock.key.public_key(),as_dict=True); k['kid']='fixture'
        k['d' if case=='private' else 'alg']='private' if case=='private' else 'HS256'; mock.jwks_changes={'keys':[k]}
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth)
        assert finish(c,'google',state).status_code==502


@pytest.mark.parametrize('name,changes',[('yandex',{'client_id':'other'}),('yandex',{'id':True}),('vk',{'user':{'user_id':888}}),('vk',{'user':None})])
def test_oauth_api_audience_and_stable_subject_binding(oauth,name,changes):
    oauth[4].info_changes=changes
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth,name)
        assert finish(c,name,state).status_code==502


@pytest.mark.parametrize('response',[lambda r:httpx.Response(302,headers={'location':'https://evil.test'}),
 lambda r:httpx.Response(200,json={'error':'synthetic-secret-error','error_description':PASSWORD}),
 lambda r:httpx.Response(200,text='{"id":1,"id":2}',headers={'content-type':'application/json'}),
 lambda r:httpx.Response(200,content=b'a'*65537,headers={'content-type':'application/json'}),
 lambda r:httpx.Response(200,text=PASSWORD),
 lambda r:(_ for _ in ()).throw(httpx.ReadTimeout('synthetic-private-details'))])
def test_upstream_errors_size_timeout_no_details_or_retry(oauth,response):
    oauth[4].response=response
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth)
        r=finish(c,'google',state); assert r.status_code==502 and PASSWORD not in r.text and 'synthetic' not in r.text
        assert len(oauth[4].calls)==1
        assert finish(c,'google',state).status_code==403 and len(oauth[4].calls)==1


def test_link_requires_real_own_password_and_origin_csrf(oauth):
    with browser(oauth) as c:
        assert login(c).status_code==200
        nonce=challenge(c)
        path='/api/v1/auth/oauth/google/start'; body={'intent':'link','password':'Wrong synthetic pass42!'}
        assert c.post(path,json=body,headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}).status_code==401
        assert c.get('/api/v1/me').status_code==200 and oauth[4].calls==[]
        body['password']=PASSWORD
        for headers in [{'Origin':ORIGIN},{'Origin':'https://evil.test','X-CSRF-Token':nonce}]:
            assert c.post(path,json=body,headers=headers).status_code==403
        r=c.post(path,json=dict(body,redirect_uri='https://evil.test'),headers={'Origin':ORIGIN,'X-CSRF-Token':nonce})
        assert r.status_code==400 and PASSWORD not in r.text


def test_pair_collision_and_unlink_preserve_owner_and_revoke_own_sessions(oauth):
    s=member(oauth)
    with browser(oauth) as a,browser(oauth) as b:
        assert login(a).status_code==200; assert finish(a,'google',begin(a,oauth)).status_code==204
        assert login(b,s.email_original).status_code==200
        assert finish(b,'google',begin(b,oauth)).json()=={'code':'oauth_identity_conflict'}
        assert b.get('/api/v1/me/oauth').json()=={'items':[]}
        nonce=challenge(a)
        r=a.request('DELETE','/api/v1/me/oauth/google',json={'password':PASSWORD},headers={'Origin':ORIGIN,'X-CSRF-Token':nonce})
        assert r.status_code==204 and a.cookies.get('__Host-qubite_session') is None
        assert b.get('/api/v1/me').status_code==200
    with psycopg.connect(oauth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.oauth_identities').fetchone()[0]==0
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==oauth[1].id
        assert db.execute('SELECT auth_version FROM qubite_core.subjects WHERE id=%s',(oauth[1].id,)).fetchone()[0]==2


@pytest.mark.parametrize('change',['logout_all','blocked','credential','expired_proof'])
def test_link_proof_rechecked_after_exchange(oauth,change):
    s=member(oauth)
    with browser(oauth) as c:
        assert login(c,s.email_original).status_code==200; state=begin(c,oauth)
        raw=c.cookies.get('__Host-qubite_session')
        def alter():
            if change=='logout_all':AuthStore(oauth[0],oauth[2]).authenticated(raw,csrf=csrf_for(raw),action='logout-all')
            elif change=='expired_proof':oauth[2].advance(301)
            else:
                with psycopg.connect(oauth[0].database_url) as db:
                    if change=='blocked':db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(s.id,))
                    else:db.execute('UPDATE qubite_core.password_credentials SET credential_version=credential_version+1 WHERE subject_id=%s',(s.id,))
        oauth[4].on_token=alter
        assert finish(c,'google',state).status_code in {401,403}
    with psycopg.connect(oauth[0].database_url) as db:assert db.execute('SELECT count(*) FROM qubite_core.oauth_identities').fetchone()[0]==0


def test_concurrent_callback_is_single_use(oauth):
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth)
        raw=c.cookies.get('__Host-qubite_session'); flow=c.cookies.get('__Host-qubite_oauth')
        store=OAuthStore(oauth[0],oauth[2],Exchange(transport=oauth[4].transport)); barrier=Barrier(2)
        def attempt(i):
            barrier.wait(timeout=10)
            try:return store.complete('google',state,flow,raw,'session',state,None,None,'192.0.2.1')
            except AuthError as e:return e
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,range(2)))
        assert results.count((None,None))==1
        assert [e.code for e in results if isinstance(e,AuthError)]==['oauth_state_failed']
    with psycopg.connect(oauth[0].database_url) as db:assert db.execute('SELECT count(*) FROM qubite_core.oauth_identities').fetchone()[0]==1


def test_provider_config_rotation_blocks_old_flow_and_no_network_default(oauth):
    with browser(oauth) as c:
        state=begin(c,oauth,'google','login'); flow=c.cookies.get('__Host-qubite_oauth')
        clients=tuple(replace(x,secret='synthetic-rotated-secret') if x.provider=='google' else x for x in oauth[0].oauth_clients)
        store=OAuthStore(replace(oauth[0],oauth_clients=clients),oauth[2],Exchange(transport=oauth[4].transport))
        with pytest.raises(AuthError) as e:store.complete('google',state,flow,None,None,state,None,None,'192.0.2.1')
        assert e.value.code=='oauth_context_changed' and oauth[4].calls==[]
    with TestClient(create_app(oauth[0]),base_url=ORIGIN) as c:
        assert not any(x['available'] for x in c.get('/api/v1/auth/oauth/providers').json()['items'])
        nonce=challenge(c)
        assert c.post('/api/v1/auth/oauth/google/start',json={'intent':'login'},headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}).status_code==503


@pytest.mark.parametrize('query',[{}, {'state':'qbt_o_'+'a'*43}, {'code':'synthetic','state':'qbt_o_'+'a'*43,'redirect_uri':'https://evil.test'},
 {'state':'qbt_o_'+'a'*43,'code':'synthetic','error':'denied'}, {'state':'qbt_o_'+'a'*43,'code':'x'*1025}])
def test_callback_queries_bounded_no_open_redirect(oauth,query):
    with browser(oauth) as c:
        r=c.get('/api/v1/auth/oauth/google/callback',params=query)
        assert r.status_code==400 and 'synthetic' not in r.text
    assert oauth[4].calls==[]


def test_provider_denial_duplicate_query_and_cross_site_navigation(oauth):
    with browser(oauth) as c:
        state=begin(c,oauth,'google','login')
        r=c.get('/api/v1/auth/oauth/google/callback',params={'state':state,'error':'access_denied','error_description':PASSWORD},
                headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'})
        assert r.json()=={'code':'provider_denied'} and PASSWORD not in r.text and oauth[4].calls==[]
        assert finish(c,'google',state).status_code==403
        assert c.get('/api/v1/auth/oauth/google/callback?state=a&state=b&code=c').status_code==400


def test_operator_switches_are_explicit_secret_free_and_cancelled(oauth,monkeypatch,capsys):
    monkeypatch.setenv('QUBITE_CORE_DATABASE_URL',oauth[0].database_url)
    monkeypatch.setattr('builtins.input',lambda p:'cancel')
    assert operator(['disable','google'])==1
    monkeypatch.setattr('builtins.input',lambda p:'SET OAUTH PROVIDER')
    assert operator(['disable','google'])==0
    assert operator(['enable','google'])==1 # No client secret passed into the environment.
    with pytest.raises(SystemExit):operator(['enable','google','--secret',PASSWORD])
    output=capsys.readouterr(); assert PASSWORD not in output.out+output.err and 'synthetic-secret' not in output.out+output.err


@pytest.mark.parametrize('value',['true-ish','1','TRUE'])
def test_network_mode_strict_and_legacy_bot_secret_not_oidc_configuration(value):
    with pytest.raises(ConfigurationError):Settings.from_env({'QUBITE_CORE_OAUTH_NETWORK_ENABLED':value})
    s=Settings.from_env({'TELEGRAM_BOT_TOKEN':'synthetic-token','VK_APP_ID':'legacy-app'})
    assert not s.oauth_network_enabled and not any(x.configured for x in s.oauth_clients)
    assert 'synthetic' not in repr(s)


def test_exchange_capacity_is_bounded_without_queue(oauth):
    for _ in range(4):assert SLOTS.acquire(blocking=False)
    try:
        with browser(oauth) as c:
            assert login(c).status_code==200; state=begin(c,oauth)
            assert finish(c,'google',state).status_code==429 and oauth[4].calls==[]
    finally:
        for _ in range(4):SLOTS.release()


@pytest.mark.parametrize('missing',['oauth_providers','oauth_states','oauth_identities','oauth_audit','password_proven'])
def test_schema_drift_is_not_ready_and_not_implicitly_repaired(oauth,missing):
    with psycopg.connect(oauth[0].database_url) as db:
        if missing=='password_proven':db.execute('ALTER TABLE qubite_core.sessions DROP COLUMN password_proven')
        else:db.execute('DROP TABLE qubite_core.'+missing+' CASCADE')
    with pytest.raises(MigrationError):check(oauth[0])
    with browser(oauth) as c:assert c.get('/api/v1/health/ready').status_code==503


def test_forward_migration_keeps_old_owner_password_and_password_session(database_url):
    settings=Settings(database_url,auth_origin=ORIGIN)
    old=load_migrations()[:3]; apply(settings,old)
    # Old accounts survive; no need to run old binary or copy existing runtime data.
    from qubite.identity.accounts import normalize_email
    from qubite.identity.auth.passwords import hash_password
    from uuid import uuid4
    uid=uuid4(); original,canonical=normalize_email(EMAIL); phc=hash_password(PASSWORD)
    raw=issue('qbt_s_'); clock=Clock(); now=clock()
    with psycopg.connect(database_url) as db:
        db.execute('INSERT INTO qubite_core.subjects(id,email_original,email_canonical,status) VALUES (%s,%s,%s,%s)',(uid,original,canonical,'active'))
        db.execute('INSERT INTO qubite_core.platform_owner(subject_id) VALUES (%s)',(uid,))
        db.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash) VALUES (%s,%s)',(uid,phc))
        db.execute("""INSERT INTO qubite_core.sessions(id,subject_id,token_hash,csrf_hash,auth_version,
            created_at,last_seen_at,expires_at,absolute_expires_at,reauthed_at)
            VALUES (%s,%s,%s,%s,1,%s,%s,%s,%s,%s)""",
            (uuid4(),uid,digest(raw),digest(csrf_for(raw)),now,now,now+timedelta(days=7),now+timedelta(days=30),now))
    assert apply(settings)==('0004_oauth','0005_challenges','0006_policy','0007_registration', "0008_catalog", "0009_budgets", "0010_dispatcher")
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==uid
        assert db.execute('SELECT password_hash FROM qubite_core.password_credentials').fetchone()[0]==phc
        assert db.execute('SELECT count(*) FROM qubite_core.oauth_providers WHERE enabled').fetchone()[0]==0

    with TestClient(create_app(settings,auth_clock=clock),base_url=ORIGIN) as c:
        c.cookies.set('__Host-qubite_session',raw,domain='qubite.example.test',path='/')
        assert c.get('/api/v1/me').json()['id']==str(uid)
        assert mutate(c,'/api/v1/auth/logout-all').status_code==204


@pytest.mark.parametrize('name',list(PROVIDERS))
def test_cross_site_callback_is_navigation_only_and_requires_browser_binding(oauth,name):
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth,name)
        params={'state':state,'code':state}
        if name=='vk':params['device_id']='synthetic-device'
        path=f'/api/v1/auth/oauth/{name}/callback'
        assert c.get(path,params=params,headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors'}).status_code==403
        assert oauth[4].calls==[]
        assert c.get(path,params=params,headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}).status_code==204


def test_replayed_invalid_states_spend_shared_budget_before_upstream(oauth):
    with browser(oauth) as c:
        state=begin(c,oauth,intent='login')
        bad=issue('qbt_o_')
        for _ in range(29): assert finish(c,'google',bad).status_code==403
        assert finish(c,'google',state).status_code==429 and oauth[4].calls==[]
        oauth[2].advance(301)
        assert finish(c,'google',state).status_code==403  # Budget resets, expired state stays unusable.


@pytest.mark.parametrize('status',['blocked','pending'])
def test_linked_subject_status_still_controls_oauth_session_issuance(oauth,status):
    user=member(oauth)
    with browser(oauth) as c:
        assert login(c,user.email_original).status_code==200
        assert finish(c,'google',begin(c,oauth)).status_code==204
        assert mutate(c,'/api/v1/auth/logout').status_code==204
        state=begin(c,oauth,intent='login')
        oauth[4].on_token=lambda: change_status(oauth,user.id,status)
        assert finish(c,'google',state).status_code==401
        assert c.cookies.get('__Host-qubite_session') is None
    with psycopg.connect(oauth[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.sessions WHERE revoked_at IS NULL').fetchone()[0]==0


def change_status(oauth,subject,status):
    with psycopg.connect(oauth[0].database_url) as db:
        db.execute('UPDATE qubite_core.subjects SET status=%s WHERE id=%s',(status,subject))


def test_oidc_google_alias_and_multi_audience_with_matching_azp_is_valid(oauth):
    oauth[4].claim_changes={'iss':'accounts.google.com','aud':['fixture-google','other-audience'],'azp':'fixture-google'}
    with browser(oauth) as c:
        assert login(c).status_code==200
        assert finish(c,'google',begin(c,oauth)).status_code==204
    with psycopg.connect(oauth[0].database_url) as db:
        assert db.execute('SELECT issuer FROM qubite_core.oauth_identities').fetchone()[0]=='https://accounts.google.com'


def test_missing_vk_device_consumes_one_use_state_without_upstream(oauth):
    with browser(oauth) as c:
        assert login(c).status_code==200; state=begin(c,oauth,'vk')
        assert c.get('/api/v1/auth/oauth/vk/callback',params={'code':state,'state':state}).status_code==400
        assert finish(c,'vk',state).status_code==403 and oauth[4].calls==[]


def test_runtime_database_role_can_use_oauth_but_cannot_enable_providers_or_grant_owner(oauth,postgres_cluster):
    from uuid import uuid4
    role='core_oauth_'+uuid4().hex; password=uuid4().hex
    with psycopg.connect(**postgres_cluster,autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
    try:
        grants=[
            'GRANT USAGE ON SCHEMA qubite_core,qubite_meta TO {}',
            'GRANT SELECT ON ALL TABLES IN SCHEMA qubite_core,qubite_meta TO {}',
            'GRANT UPDATE(auth_version,updated_at) ON qubite_core.subjects TO {}',
            'GRANT UPDATE(credential_version) ON qubite_core.password_credentials TO {}',
            'GRANT UPDATE(version) ON qubite_core.oauth_providers TO {}',
            'GRANT INSERT,UPDATE ON qubite_core.sessions,qubite_core.auth_preauth,qubite_core.auth_rate_limits,qubite_core.oauth_states TO {}',
            'GRANT DELETE ON qubite_core.auth_preauth,qubite_core.auth_rate_limits,qubite_core.oauth_states TO {}',
            'GRANT INSERT,DELETE ON qubite_core.oauth_identities TO {}',
            'GRANT UPDATE(linked_at) ON qubite_core.oauth_identities TO {}',
            'GRANT INSERT ON qubite_core.oauth_audit TO {}',
            'GRANT USAGE ON SEQUENCE qubite_core.oauth_audit_id_seq TO {}',
        ]
        with psycopg.connect(oauth[0].database_url) as db:
            for grant in grants:db.execute(sql.SQL(grant).format(sql.Identifier(role)))
        parts=psycopg.conninfo.conninfo_to_dict(oauth[0].database_url)
        settings=replace(oauth[0],database_url=f"postgresql://{role}:{password}@127.0.0.1:{parts['port']}/{parts['dbname']}?sslmode=disable")
        runtime=(settings,oauth[1],oauth[2],create_app(settings,auth_clock=oauth[2],oauth_transport=oauth[4].transport),oauth[4])
        with browser(runtime) as c:
            assert login(c).status_code==200
            assert finish(c,'google',begin(c,runtime)).status_code==204
            assert mutate(c,'/api/v1/auth/logout').status_code==204
            assert finish(c,'google',begin(c,runtime,intent='login')).status_code==200
            nonce=challenge(c)
            assert c.request('DELETE','/api/v1/me/oauth/google',json={'password':PASSWORD},headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}).status_code==204
        statements=["UPDATE qubite_core.oauth_providers SET enabled=true",'DELETE FROM qubite_core.platform_owner',
                    "UPDATE qubite_core.password_credentials SET password_hash='replacement'", "UPDATE qubite_core.subjects SET status='blocked'"]
        for statement in statements:
            with pytest.raises(psycopg.errors.InsufficientPrivilege),psycopg.connect(**settings.connection_options()) as db:db.execute(statement)
    finally:
        with psycopg.connect(oauth[0].database_url) as db:db.execute(sql.SQL('DROP OWNED BY {}').format(sql.Identifier(role)))
        with psycopg.connect(**postgres_cluster,autocommit=True) as admin:admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


@pytest.mark.parametrize('name', list(PROVIDERS))
def test_browser_callback_fixed_completion_preserves_cookie_and_json_contract(oauth, name):
    navigation = {'Sec-Fetch-Mode':'navigate', 'Accept':'text/html'}
    with browser(oauth) as c:
        assert login(c).status_code == 200
        original = c.cookies.get('__Host-qubite_session')
        state = begin(c, oauth, name)
        query = {'state':state, 'code':state}
        if name == 'vk': query['device_id'] = 'synthetic-device'
        r = c.get(f'/api/v1/auth/oauth/{name}/callback', params=query,
                  headers=navigation, follow_redirects=False)
        assert r.status_code == 303 and r.headers['location'] == '/#/auth/linked'
        assert c.cookies.get('__Host-qubite_session') == original
        assert 'qbt_' not in r.text and state not in r.headers['location']
        assert mutate(c, '/api/v1/auth/logout').status_code == 204
        state = begin(c, oauth, name, 'login')
        query.update(state=state, code=state)
        r = c.get(f'/api/v1/auth/oauth/{name}/callback', params=query,
                  headers=navigation, follow_redirects=False)
        assert r.status_code == 303 and r.headers['location'] == '/#/auth/complete'
        assert c.get('/api/v1/me').json()['id'] == str(oauth[1].id)
        assert c.cookies.get('__Host-qubite_oauth') is None
        assert r.headers['cache-control'] == 'no-store' and r.headers['referrer-policy'] == 'no-referrer'
        assert '__Host-qubite_session' in r.headers['set-cookie']
        assert 'httponly' in r.headers['set-cookie'].lower()


@pytest.mark.parametrize('failure', ['unlinked','denied','invalid','wrong_state','bad_signature'])
def test_browser_callback_errors_strip_proofs_and_refuse_return_targets(oauth, failure):
    with browser(oauth) as c:
        state = begin(c, oauth, 'google', 'login')
        query = {'state':state, 'code':state}
        if failure == 'denied': query = {'state':state, 'error':'access_denied','error_description':'untrusted private details'}
        if failure == 'invalid': query['return_to'] = 'https://evil.example.test/private'
        if failure == 'wrong_state': query['state'] = issue('qbt_o_')
        if failure == 'bad_signature': oauth[4].bad_signature = True
        r = c.get('/api/v1/auth/oauth/google/callback', params=query,
                  headers={'Sec-Fetch-Mode':'navigate','Accept':'text/html'}, follow_redirects=False)
        assert r.status_code == 303 and r.headers['location'].startswith('/#/auth/login?error=')
        assert all(x not in r.headers['location'] + r.text for x in [state, 'evil.example', 'untrusted', 'synthetic-secret'])
        assert c.cookies.get('__Host-qubite_oauth') is None
        assert c.get('/api/v1/me').status_code == 401
        if failure == 'invalid': assert oauth[4].calls == []


def test_callback_json_client_does_not_redirect_when_accept_html_without_navigation(oauth):
    with browser(oauth) as c:
        state = begin(c, oauth, 'google', 'login')
        r = c.get('/api/v1/auth/oauth/google/callback', params={'state':state,'code':state},
                  headers={'Accept':'text/html'}, follow_redirects=False)
        assert r.status_code == 409 and r.json() == {'code':'oauth_identity_unlinked'}
        assert 'location' not in r.headers
