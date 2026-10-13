"""AUTH-005: account codes cannot authenticate; other proof protocols remain separate."""
import json
from pathlib import Path

import psycopg
import pytest

from qubite.app import create_app
from qubite.config import Settings
from test_auth import auth, client, challenge, login, member, EMAIL, PASSWORD, ORIGIN
from test_challenges import email, browser, request, confirm, verified, proof_row, NEW

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / 'contracts/auth-v1.json').read_text())
REJECTED = (
    '/api/auth/code-entry', '/api/auth/code-entry/inspect', '/api/auth/login',
    '/api/v1/auth/code-entry', '/api/v1/auth/code-entry/inspect', '/api/v1/auth/login',
)
CODE = 'SYNTHETIC-JOIN-42'
PAYLOADS = [
    {'code': CODE},
    {'email': EMAIL, 'code': CODE},
    {'login': EMAIL, 'password': PASSWORD},
    *[{'email': EMAIL, 'password': PASSWORD, key: CODE}
      for key in ('code', 'accessCode', 'access_code', 'account_code', 'invite_code', 'token')],
    {'email': EMAIL, 'password': PASSWORD, 'grant_type': 'code'},
    {'email': EMAIL, 'password': PASSWORD, 'mode': 'code-entry'},
]


def snapshot(settings):
    """No session creation/revoke, subject mutation, credential or entitlement side effect."""
    with psycopg.connect(settings.database_url) as db:
        return (
            db.execute('SELECT id,subject_id,token_hash,revoked_at FROM qubite_core.sessions ORDER BY id').fetchall(),
            db.execute('SELECT id,status,auth_version,email_verified_at FROM qubite_core.subjects ORDER BY id').fetchall(),
            db.execute('SELECT subject_id,password_hash FROM qubite_core.password_credentials ORDER BY subject_id').fetchall(),
            db.execute('SELECT subject_id,module,action,effect FROM qubite_core.policy_entitlements ORDER BY subject_id,module,action').fetchall(),
            db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchall(),
        )


def test_login_boundary_contract_matches_actual_openapi_and_parent_protocol():
    schema = create_app(Settings()).openapi()
    parent = json.loads((ROOT / 'contracts/identity-v2.json').read_text())
    recorded = json.loads((ROOT / 'contracts/core-v1.json').read_text())
    assert schema == recorded
    assert CONTRACT['account_code_entry'] is CONTRACT['legacy_import'] is False
    assert CONTRACT['runtime_changes'] is CONTRACT['production_deployment'] is False
    assert tuple(CONTRACT['rejected_routes']) == REJECTED
    entry = CONTRACT['password_login']
    operation = schema['paths'][entry['path']][entry['method'].lower()]
    ref = operation['requestBody']['content']['application/json']['schema']['$ref'].split('/')[-1]
    dto = schema['components']['schemas'][ref]
    assert set(dto['properties']) == set(dto['required']) == set(entry['allowed_fields']) == {'email', 'password'}
    assert dto['additionalProperties'] is entry['additional_properties'] is False
    assert entry['required_fields'] == ['email', 'password']
    assert all(entry[key] is False for key in ('grants_modules', 'grants_models', 'grants_owner', 'legacy_alias'))
    assert parent['installation']['legacy_import'] is False
    assert parent['installation']['legacy_session_acceptance'] is False
    for path in REJECTED:
        assert path not in schema['paths']
    for purpose in ('email_verify', 'email_reset'):
        for kind in ('request', 'confirm'):
            assert 'post' in schema['paths'][CONTRACT['separate_protocols'][purpose][kind]]
    callback = CONTRACT['separate_protocols']['oauth']['callback']
    # Callback query fields are parsed strictly from Request by the OAuth store,
    # not declared as FastAPI parameters; signed HTTP coverage is in test_oauth.
    assert 'get' in schema['paths'][callback]
    assert CONTRACT['separate_protocols']['email_two_factor']['status'] == 'protocol_only'


@pytest.mark.parametrize('path', REJECTED)
@pytest.mark.parametrize('signed_in', [False, True])
def test_known_old_routes_never_authenticate_or_replace_an_existing_session(auth, path, signed_in):
    with client(auth) as c:
        if signed_in:
            assert login(c).status_code == 200
        before = snapshot(auth[0])
        cookie = c.cookies.get(auth[0].session_cookie)
        nonce = challenge(c)
        for method in CONTRACT['rejection']['methods']:
            kwargs = {'json': {'code': CODE, 'email': EMAIL, 'password': PASSWORD}} if method == 'POST' else {}
            response = c.request(method, path, headers={'Origin': ORIGIN, 'X-CSRF-Token': nonce}, **kwargs)
            assert response.status_code == 404
            assert response.json() == {'detail': 'Not Found'}
            assert 'set-cookie' not in response.headers and 'location' not in response.headers
            assert not any(secret in response.text for secret in (CODE, EMAIL, PASSWORD))
        assert snapshot(auth[0]) == before
        assert c.cookies.get(auth[0].session_cookie) == cookie
        assert c.get('/api/v1/me').status_code == (200 if signed_in else 401)


@pytest.mark.parametrize('payload', PAYLOADS)
@pytest.mark.parametrize('signed_in', [False, True])
def test_code_and_legacy_alias_fields_cannot_fall_back_to_password_login(auth, payload, signed_in):
    with client(auth) as c:
        if signed_in:
            assert login(c).status_code == 200
        before = snapshot(auth[0])
        cookie = c.cookies.get(auth[0].session_cookie)
        nonce = challenge(c)
        response = c.post('/api/v1/auth/session', json=payload,
                          headers={'Origin': ORIGIN, 'X-CSRF-Token': nonce})
        assert response.status_code == 400 and response.json() == {'code': 'invalid_request'}
        assert 'set-cookie' not in response.headers
        assert not any(secret in response.text for secret in (CODE, EMAIL, PASSWORD))
        assert snapshot(auth[0]) == before
        assert c.cookies.get(auth[0].session_cookie) == cookie
        assert c.get('/api/v1/me').status_code == (200 if signed_in else 401)


@pytest.mark.parametrize('owner', [False, True])
def test_email_password_still_authenticates_only_the_expected_subject_without_module_grants(auth, owner):
    subject = auth[1] if owner else member(auth)
    with client(auth) as c:
        response = login(c, subject.email_original)
        assert response.status_code == 200
        assert response.json()['subject']['id'] == str(subject.id)
        assert response.json()['subject']['platform_owner'] is owner
        assert c.get('/api/v1/me/access').json()['items'] == []
        assert c.get('/api/v1/me').json() == response.json()['subject']
        assert PASSWORD not in response.text and c.cookies.get(auth[0].session_cookie) not in response.text


@pytest.mark.parametrize('status', ['pending', 'blocked'])
def test_code_dto_does_not_activate_or_unblock_account(auth, status):
    subject = member(auth)
    with psycopg.connect(auth[0].database_url) as db:
        db.execute('UPDATE qubite_core.subjects SET status=%s WHERE id=%s', (status, subject.id))
    before = snapshot(auth[0])
    with client(auth) as c:
        nonce = challenge(c)
        r = c.post('/api/v1/auth/session', json={'email': subject.email_original, 'code': CODE},
                   headers={'Origin': ORIGIN, 'X-CSRF-Token': nonce})
        assert r.status_code == 400
        assert snapshot(auth[0]) == before
        assert login(c, subject.email_original).status_code == 401


@pytest.mark.parametrize('purpose', ['verify', 'reset'])
@pytest.mark.parametrize('placement', ['password', 'cookie', 'bearer'])
def test_email_proof_cannot_login_and_remains_usable_only_by_its_confirmation_protocol(email, purpose, placement):
    if purpose == 'reset':
        verified(email)
    with browser(email) as c:
        assert request(c, purpose).status_code == 202
        envelope = email[4].items[-1]
        before = snapshot(email[0]); proof_before = proof_row(email, envelope)
        if placement == 'password':
            response = login(c, password=envelope.token)
        elif placement == 'cookie':
            c.cookies.clear()
            c.cookies.set(email[0].session_cookie, envelope.token, domain='qubite.example.test', path='/')
            response = c.get('/api/v1/me')
        else:
            c.cookies.clear()  # One credential: mixed preauth cookie/bearer rejects earlier with400.
            response = c.get('/api/v1/me', headers={'Authorization': 'Bearer ' + envelope.token})
        assert response.status_code == 401
        assert envelope.token not in response.text
        assert snapshot(email[0]) == before and proof_row(email, envelope) == proof_before
        c.cookies.clear()
        assert confirm(c, envelope).status_code == 204
        assert c.get('/api/v1/me').status_code == 401
        assert not c.cookies.get(email[0].session_cookie)
        assert login(c, password=NEW if purpose == 'reset' else PASSWORD).status_code == 200
