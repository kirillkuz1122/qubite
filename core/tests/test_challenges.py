"""Email possession proofs: real disposable PG and HTTP, memory-only delivery."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from threading import Barrier
from uuid import uuid4
import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
import psycopg
import pytest

from qubite.app import create_app
from qubite.config import ConfigurationError, Settings
from qubite.identity import bootstrap_owner, create_subject
from qubite.identity.auth import passwords
from qubite.identity.auth.store import AuthError, AuthStore, setup_owner_password
from qubite.identity.auth.tokens import digest, issue
from qubite.identity.challenges.store import ChallengeStore, Delivery, TTL
from qubite.migrations import apply, check, load_migrations, Migration, MigrationError
from test_auth import Clock, EMAIL, PASSWORD, ORIGIN, challenge, login, mutate

NEW='Synthetic replacement password 42!'
BASE='/api/v1/auth/email/'


class Mail:
    def __init__(self): self.items=[]; self.hook=None; self.result=True
    def __call__(self,envelope):
        self.items.append(envelope)
        if self.hook: self.hook(envelope)
        return self.result


@pytest.fixture
def email(database_url):
    settings=Settings(database_url,auth_origin=ORIGIN,email_challenges_enabled=True)
    apply(settings); owner=bootstrap_owner(settings,EMAIL); setup_owner_password(settings,PASSWORD)
    clock=Clock(); mail=Mail(); app=create_app(settings,auth_clock=clock,mail_transport=mail)
    return settings,owner,clock,app,mail


def browser(email): return TestClient(email[3],base_url=ORIGIN)


def request(c,purpose='verify',address=EMAIL):
    return mutate(c,BASE+purpose+'/request',json={'email':address})


def confirm(c,envelope,*,purpose=None,token=None,**changes):
    body={'challenge_id':str(envelope.challenge_id),'token':token or envelope.token}
    if (purpose or envelope.purpose)=='reset': body['password']=NEW
    body.update(changes)
    return mutate(c,BASE+(purpose or envelope.purpose)+'/confirm',json=body)


def verified(email):
    with browser(email) as c:
        assert request(c).status_code==202
        assert confirm(c,email[4].items[-1]).status_code==204


def proof_row(email,envelope):
    with psycopg.connect(email[0].database_url) as db:
        return db.execute('SELECT token_hash,attempts,finished_at,delivered_at FROM qubite_core.email_challenges WHERE id=%s', (envelope.challenge_id,)).fetchone()


def test_verify_owner_uuid_preserved_revokes_sessions_and_does_not_login(email):
    with browser(email) as a,browser(email) as b:
        assert login(a).status_code==200
        before=a.get('/api/v1/me').json()
        assert request(b).json()=={'code':'request_accepted'}
        envelope=email[4].items[-1]; row=proof_row(email,envelope)
        assert bytes(row[0])==digest(envelope.token) and row[3]
        assert envelope.token not in repr(envelope) and EMAIL not in repr(envelope)
        result=confirm(b,envelope)
        assert result.status_code==204 and result.content==b''
        assert not b.cookies.get(email[0].session_cookie)
        assert a.get('/api/v1/me').status_code==401
        assert login(a).status_code==200 and a.get('/api/v1/me').json()==before
        with psycopg.connect(email[0].database_url) as db:
            assert db.execute('SELECT id,status,email_verified_at,auth_version FROM qubite_core.subjects').fetchone()[:2]==(email[1].id,'active')
            assert db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]==email[1].id


def test_pending_verification_activates_only_existing_account_no_owner_or_credentials(email):
    s=create_subject(email[0],'pending@example.test')
    with browser(email) as c:
        assert request(c,address=s.email_original).status_code==202
        assert confirm(c,email[4].items[-1]).status_code==204
        assert login(c,email=s.email_original).status_code==401
    with psycopg.connect(email[0].database_url) as db:
        row=db.execute('SELECT id,status,email_verified_at FROM qubite_core.subjects WHERE id=%s', (s.id,)).fetchone()
        assert row[0]==s.id and row[1]=='active' and row[2]
        assert db.execute('SELECT count(*) FROM qubite_core.platform_owner WHERE subject_id=%s', (s.id,)).fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM qubite_core.password_credentials WHERE subject_id=%s', (s.id,)).fetchone()[0]==0


@pytest.mark.parametrize('purpose,address',[('verify','unknown@example.test'),('reset',EMAIL),('reset','unknown@example.test'),('verify','invalid')])
def test_uniform_request_response_no_implicit_signup_or_reset_unverified(email,purpose,address):
    with browser(email) as c:
        r=request(c,purpose,address)
        assert r.status_code==202 and r.json()=={'code':'request_accepted'}
        assert r.headers['cache-control']=='no-store'
        assert r.headers['referrer-policy']=='no-referrer'
    assert not email[4].items
    with psycopg.connect(email[0].database_url) as db:
        assert db.execute('SELECT count(*) FROM qubite_core.subjects').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM qubite_core.email_challenges').fetchone()[0]==0


def test_reset_same_owner_new_password_revokes_all_own_sessions_only(email):
    verified(email)
    other=create_subject(email[0],'other@example.test')
    with psycopg.connect(email[0].database_url) as db:
        db.execute("UPDATE qubite_core.subjects SET status='active' WHERE id=%s",(other.id,))
        db.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash) VALUES (%s,%s)', (other.id,passwords.hash_password(PASSWORD)))
    with browser(email) as a,browser(email) as b,browser(email) as c,browser(email) as d:
        assert login(a).status_code==login(b).status_code==200
        assert login(d,email=other.email_original).status_code==200
        assert request(c,'reset').status_code==202
        envelope=email[4].items[-1]; assert confirm(c,envelope).status_code==204
        assert c.get('/api/v1/me').status_code==401
        assert a.get('/api/v1/me').status_code==b.get('/api/v1/me').status_code==401
        assert d.get('/api/v1/me').status_code==200
        assert login(c).status_code==401
        assert login(c,password=NEW).status_code==200
        assert c.get('/api/v1/me').json()['id']==str(email[1].id)
        assert c.get('/api/v1/me').json()['platform_owner'] is True
    with psycopg.connect(email[0].database_url) as db:
        phc,version=db.execute('SELECT password_hash,credential_version FROM qubite_core.password_credentials WHERE subject_id=%s', (email[1].id,)).fetchone()
        assert version==2 and passwords.verify_password(phc,NEW)
        assert db.execute('SELECT auth_version FROM qubite_core.subjects WHERE id=%s',(email[1].id,)).fetchone()[0]==3


@pytest.mark.parametrize('purpose',['verify','reset'])
def test_expiry_boundary_and_replay(email,purpose):
    if purpose=='reset': verified(email)
    with browser(email) as c:
        assert request(c,purpose).status_code==202
        envelope=email[4].items[-1]
        email[2].advance(int(TTL[purpose].total_seconds()))
        assert confirm(c,envelope).json()=={'code':'invalid_challenge'}
        assert request(c,purpose).status_code==202
        envelope=email[4].items[-1]
        assert confirm(c,envelope).status_code==204
        assert confirm(c,envelope).json()=={'code':'invalid_challenge'}


@pytest.mark.parametrize('purpose',['verify','reset'])
def test_failed_attempts_commit_exhaust_and_never_lock_account(email,purpose):
    if purpose=='reset': verified(email)
    with browser(email) as c:
        assert request(c,purpose).status_code==202
        e=email[4].items[-1]
        for i in range(5):
            assert confirm(c,e,token='wrong').json()=={'code':'invalid_challenge'}
            assert proof_row(email,e)[1]==i+1
        assert proof_row(email,e)[2]
        assert confirm(c,e).json()=={'code':'invalid_challenge'}
        assert login(c).status_code==200


@pytest.mark.parametrize('purpose',['verify','reset'])
def test_resend_supersedes_previous_and_wrong_purpose_cannot_consume(email,purpose):
    if purpose=='reset': verified(email)
    with browser(email) as c:
        assert request(c,purpose).status_code==202; old=email[4].items[-1]
        assert request(c,purpose).status_code==202; new=email[4].items[-1]
        assert old.challenge_id!=new.challenge_id and old.token!=new.token
        assert confirm(c,old).json()=={'code':'invalid_challenge'}
        assert confirm(c,new,purpose='reset' if purpose=='verify' else 'verify').status_code==400
        assert proof_row(email,new)[1]==0
        assert confirm(c,new).status_code==204


@pytest.mark.parametrize('change',['auth_version','email','credential_version','blocked'])
@pytest.mark.parametrize('purpose',['verify','reset'])
def test_live_subject_mutation_invalidates_proof(email,purpose,change):
    if purpose=='reset': verified(email)
    with browser(email) as c:
        assert request(c,purpose).status_code==202; e=email[4].items[-1]
        with psycopg.connect(email[0].database_url) as db:
            if change=='auth_version':db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1 WHERE id=%s',(email[1].id,))
            elif change=='email':db.execute("UPDATE qubite_core.subjects SET email_canonical='changed@example.test',email_original='changed@example.test' WHERE id=%s",(email[1].id,))
            elif change=='credential_version':db.execute('UPDATE qubite_core.password_credentials SET credential_version=credential_version+1 WHERE subject_id=%s',(email[1].id,))
            else:
                # Owner active invariant is enforced separately; this fixture drops assignment first.
                db.execute('DELETE FROM qubite_core.platform_owner')
                db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(email[1].id,))
        assert confirm(c,e).json()=={'code':'invalid_challenge'}


@pytest.mark.parametrize('result',[False,None,'true','exception'])
def test_failed_mail_returns_generic_response_but_token_unusable(email,result):
    email[4].result=result
    if result=='exception':
        def fail(e): raise RuntimeError(e.token+' '+e.recipient)
        email[4].hook=fail
    with browser(email) as c:
        r=request(c); e=email[4].items[-1]
        assert r.status_code==202 and r.json()=={'code':'request_accepted'}
        assert proof_row(email,e)[2] and not proof_row(email,e)[3]
        assert confirm(c,e).json()=={'code':'invalid_challenge'}


def test_transport_runs_outside_locks_and_delivery_race_rechecks_versions(email):
    def change(e):
        with psycopg.connect(email[0].database_url) as db:
            db.execute('SET lock_timeout=500')
            db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1 WHERE id=%s',(email[1].id,))
    email[4].hook=change
    with browser(email) as c:
        assert request(c).status_code==202
        e=email[4].items[-1]
        assert proof_row(email,e)[2]
        assert confirm(c,e).status_code==400


@pytest.mark.parametrize('purpose',['verify','reset'])
def test_request_identifier_cap_shared_across_processes_and_no_fourth_mail(email,purpose):
    if purpose=='reset': verified(email)
    for _ in range(3):
        with browser(email) as c:assert request(c,purpose).status_code==202
    with browser(email) as c:
        assert request(c,purpose).status_code==429
    assert len([e for e in email[4].items if e.purpose==purpose])==3
    email[2].advance(300)
    with browser(email) as c:assert request(c,purpose).status_code==202


@pytest.mark.parametrize('purpose',['verify','reset'])
def test_concurrent_confirmation_has_one_winner(email,purpose):
    if purpose=='reset':verified(email)
    with browser(email) as c:
        assert request(c,purpose).status_code==202; e=email[4].items[-1]
    barrier=Barrier(2)
    def run():
        with browser(email) as c:
            barrier.wait()
            return confirm(c,e).status_code
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:run(),range(2)))
    assert sorted(results)==[204,400]


def test_reset_rechecks_versions_and_expiry_after_hash_without_locks(email,monkeypatch):
    verified(email)
    with browser(email) as c:
        assert request(c,'reset').status_code==202; e=email[4].items[-1]
        original=passwords.hash_password
        def change(password):
            with psycopg.connect(email[0].database_url) as db:
                db.execute('SET lock_timeout=500')
                db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1 WHERE id=%s',(email[1].id,))
            return original(password)
        monkeypatch.setattr(passwords,'hash_password',change)
        assert confirm(c,e).json()=={'code':'invalid_challenge'}
    with psycopg.connect(email[0].database_url) as db:
        assert db.execute('SELECT credential_version FROM qubite_core.password_credentials').fetchone()[0]==1


@pytest.mark.parametrize('setting,transport',[(False,True),(True,False)])
def test_disabled_or_missing_transport_fail_closed_without_db(setting,transport,monkeypatch):
    def deny(*a,**k):raise AssertionError('no database/network while disabled')
    monkeypatch.setattr(psycopg,'connect',deny)
    app=create_app(Settings(auth_origin=ORIGIN,email_challenges_enabled=setting),mail_transport=(lambda _:True) if transport else None)
    with TestClient(app,base_url=ORIGIN) as c:
        r=c.post(BASE+'verify/request',json={'email':EMAIL},headers={'Origin':ORIGIN,'X-CSRF-Token':issue('qbt_c_')})
        assert r.status_code==503 and r.json()=={'code':'email_unavailable'}


@pytest.mark.parametrize('value',['TRUE','1','yes',''])
def test_email_gate_strict_config(value):
    with pytest.raises(ConfigurationError):Settings.from_env({'QUBITE_CORE_EMAIL_CHALLENGES_ENABLED':value})


@pytest.mark.parametrize('mode',['origin','query','legacy','bearer','csrf','extra','oversized','no-cookie','session-mismatch','non-json'])
def test_email_http_guards_and_redacted_validation(email,mode):
    with browser(email) as c:
        nonce=challenge(c); headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}; body={'email':EMAIL}; url=BASE+'verify/request'
        if mode=='origin':headers['Origin']='https://evil.example.test'
        elif mode=='query':url+='?token=private-proof'
        elif mode=='legacy':c.cookies.clear();c.cookies.set('qb_session','old')
        elif mode=='bearer':headers['Authorization']='Bearer '+issue('qbt_s_')
        elif mode=='csrf':headers['X-CSRF-Token']=issue('qbt_c_')
        elif mode=='extra':body['role']='owner'
        elif mode=='oversized':body['email']='secret'*2000
        elif mode=='no-cookie':c.cookies.clear()
        elif mode=='session-mismatch':
            assert login(c).status_code==200;headers['X-CSRF-Token']=nonce
        if mode=='non-json':r=c.post(url,content='private plaintext',headers={**headers,'Content-Type':'text/plain'})
        else:r=c.post(url,json=body,headers=headers)
        assert r.status_code in {400,401,403} and r.json()['code'] in {'invalid_request','unauthenticated','csrf_failed'}
        assert EMAIL not in r.text and 'private' not in r.text and 'secret' not in r.text
        assert not email[4].items


def test_anonymous_csrf_one_use_confirm_can_open_in_other_browser_and_session_request(email):
    with browser(email) as a,browser(email) as b:
        nonce=challenge(a);headers={'Origin':ORIGIN,'X-CSRF-Token':nonce}
        assert a.post(BASE+'verify/request',json={'email':EMAIL},headers=headers).status_code==202
        e=email[4].items[-1]
        assert a.post(BASE+'verify/request',json={'email':EMAIL},headers=headers).status_code==403
        assert confirm(b,e).status_code==204
        assert login(a).status_code==200
        assert request(a,'reset').status_code==202
        assert confirm(b,email[4].items[-1]).status_code==204


def test_unknown_confirm_exhausts_shared_confirm_rate(email):
    e=Delivery(EMAIL,'verify',uuid4(),issue('qbt_ev_'),email[2]())
    for _ in range(8):
        with browser(email) as c:assert confirm(c,e).status_code==400
    with browser(email) as c:assert confirm(c,e).status_code==429


def test_forward_migration_preserves_existing_subject_password_and_sessions(database_url):
    settings=Settings(database_url,auth_origin=ORIGIN); migrations=load_migrations()
    apply(settings,migrations[:4])
    uid=uuid4();phc=passwords.hash_password(PASSWORD)
    with psycopg.connect(database_url) as db:
        db.execute("INSERT INTO qubite_core.subjects(id,email_original,email_canonical,status) VALUES (%s,%s,%s,'active')",(uid,EMAIL,EMAIL.lower()))
        db.execute('INSERT INTO qubite_core.platform_owner(subject_id) VALUES (%s)',(uid,))
        db.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash) VALUES (%s,%s)',(uid,phc))
    # No implicit schema repair on startup or request.
    with TestClient(create_app(settings),base_url=ORIGIN) as c:assert c.get('/api/v1/health/ready').status_code==503
    assert apply(settings)==('0005_challenges','0006_policy','0007_registration', "0008_catalog") and apply(settings)==()
    with psycopg.connect(database_url) as db:
        assert db.execute('SELECT id FROM qubite_core.subjects').fetchone()[0]==uid
        assert db.execute('SELECT password_hash FROM qubite_core.password_credentials').fetchone()[0]==phc


def test_failed_challenge_migration_rolls_back_rate_constraint_and_account_data(database_url):
    settings=Settings(database_url); ms=load_migrations();apply(settings,ms[:4])
    bad=ms[4].sql+'\nSELECT no_such_challenge_function();'
    with pytest.raises(MigrationError):apply(settings,(*ms[:4],Migration(ms[4].version,bad,hashlib.sha256(bad.encode()).hexdigest())))
    with psycopg.connect(database_url) as db:
        assert db.execute("SELECT to_regclass('qubite_core.email_challenges')").fetchone()[0] is None
        assert db.execute('SELECT count(*) FROM qubite_meta.schema_migrations').fetchone()[0]==4
        definition=db.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='auth_rate_limits_scope_check'").fetchone()[0]
        assert 'email_' not in definition
    assert apply(settings)==('0005_challenges','0006_policy','0007_registration', "0008_catalog")


def test_schema_missing_not_ready_or_repaired(email):
    with browser(email) as c:
        nonce=challenge(c)
        with psycopg.connect(email[0].database_url) as db:db.execute('DROP TABLE qubite_core.email_challenges')
        with pytest.raises(MigrationError):check(email[0])
        assert c.get('/api/v1/health/ready').status_code==503
        r=c.post(BASE+'verify/request',json={'email':EMAIL},headers={'Origin':ORIGIN,'X-CSRF-Token':nonce})
        assert r.status_code==503 and r.json()=={'code':'identity_unavailable'}


def test_expiry_during_password_hash_does_not_write_new_password(email,monkeypatch):
    verified(email)
    with browser(email) as c:
        assert request(c,'reset').status_code==202; e=email[4].items[-1]
        original=passwords.hash_password
        def expire(password):
            email[2].advance(900)
            return original(password)
        monkeypatch.setattr(passwords,'hash_password',expire)
        assert confirm(c,e).json()=={'code':'invalid_challenge'}
    with psycopg.connect(email[0].database_url) as db:
        assert db.execute('SELECT credential_version FROM qubite_core.password_credentials').fetchone()[0]==1


@pytest.mark.parametrize('value',['short','', 'x'*257])
def test_invalid_password_preserves_old_hash_and_no_plaintext_in_response(email,value):
    verified(email)
    with browser(email) as c:
        assert request(c,'reset').status_code==202; e=email[4].items[-1]
        r=confirm(c,e,password=value)
        assert r.status_code==400 and r.json()['code'] in {'invalid_password','invalid_request'}
        assert e.token not in r.text
        assert login(c).status_code==200


@pytest.mark.parametrize('prefix',['qbt_s_','qbt_p_','qbt_er_','qbt_a_'])
def test_wrong_token_type_never_verifies_email(email,prefix):
    with browser(email) as c:
        assert request(c).status_code==202
        e=email[4].items[-1]
        assert confirm(c,e,token=issue(prefix)).json()=={'code':'invalid_challenge'}
        assert confirm(c,e).status_code==204


def test_verified_and_blocked_targets_produce_same_response_without_mail(email):
    verified(email)
    s=create_subject(email[0],'blocked@example.test')
    with psycopg.connect(email[0].database_url) as db:db.execute("UPDATE qubite_core.subjects SET status='blocked' WHERE id=%s",(s.id,))
    size=len(email[4].items)
    with browser(email) as c:
        for purpose,address in [('verify',EMAIL),('verify',s.email_original),('reset',s.email_original)]:
            assert request(c,purpose,address).json()=={'code':'request_accepted'}
    assert len(email[4].items)==size


def test_request_ip_limit_applies_to_unknown_addresses_and_commits(email):
    with browser(email) as c:
        for i in range(30):assert request(c,address=f'unknown{i}@example.test').status_code==202
        assert request(c,address='unknown30@example.test').status_code==429
        email[2].advance(300)
        assert request(c,address='unknown30@example.test').status_code==202
    assert not email[4].items


def test_reset_write_failure_atomic_preserves_proof_password_and_sessions(email):
    verified(email)
    with browser(email) as a,browser(email) as c:
        assert login(a).status_code==200
        assert request(c,'reset').status_code==202; e=email[4].items[-1]
        with psycopg.connect(email[0].database_url) as db:
            db.execute("""CREATE FUNCTION qubite_core.fail_reset() RETURNS trigger LANGUAGE plpgsql AS
                $$ BEGIN RAISE EXCEPTION 'private database detail'; END $$""")
            db.execute('CREATE TRIGGER fail_reset BEFORE UPDATE ON qubite_core.password_credentials FOR EACH ROW EXECUTE FUNCTION qubite_core.fail_reset()')
        r=confirm(c,e)
        assert r.status_code==503 and r.json()=={'code':'identity_unavailable'}
        assert proof_row(email,e)[2] is None
        assert a.get('/api/v1/me').status_code==200
        with psycopg.connect(email[0].database_url) as db:
            assert db.execute('SELECT credential_version FROM qubite_core.password_credentials').fetchone()[0]==1
            db.execute('DROP TRIGGER fail_reset ON qubite_core.password_credentials')
        assert confirm(c,e).status_code==204


def test_expired_metadata_cleanup_skips_other_locked_subject_proof(email):
    other=create_subject(email[0],'other@example.test');cid=uuid4()
    old=email[2]()-timedelta(days=3)
    with psycopg.connect(email[0].database_url) as db:
        db.execute('''INSERT INTO qubite_core.email_challenges(id,subject_id,purpose,token_hash,
            email_canonical,auth_version,created_at,expires_at) VALUES (%s,%s,'verify',%s,%s,1,%s,%s)''',
            (cid,other.id,digest(issue('qbt_ev_')),other.email_canonical,old,old+timedelta(minutes=30)))
    with psycopg.connect(email[0].database_url) as held,browser(email) as c:
        held.execute('SELECT 1 FROM qubite_core.email_challenges WHERE id=%s FOR UPDATE',(cid,))
        assert request(c).status_code==202
        assert held.execute('SELECT 1 FROM qubite_core.email_challenges WHERE id=%s',(cid,)).fetchone()
    with browser(email) as c:assert request(c).status_code==202
    with psycopg.connect(email[0].database_url) as db:
        assert not db.execute('SELECT 1 FROM qubite_core.email_challenges WHERE id=%s',(cid,)).fetchone()
        assert db.execute('SELECT count(*) FROM qubite_core.subjects').fetchone()[0]==2


def test_email_2fa_contract_is_explicitly_not_runtime_or_password_reset_bypass():
    spec=json.loads((Path(__file__).resolve().parents[2]/'contracts/identity-v2.json').read_text())['email_2fa']
    assert spec['status']=='contract_only' and spec['runtime_implemented'] is False
    assert spec['enable_default'] is False and spec['session_before_all_proofs'] is False
    assert spec['proof_reuse_from_verify_reset'] is False and spec['oauth_bypass'] is False
    assert spec['reset_disables_2fa'] is False and len(spec['required_proofs'])==3
