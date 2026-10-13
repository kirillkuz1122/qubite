"""Protocol vectors/oracle tests; real web Auth is checked separately in core/tests. No production data.

The response oracle below describes the target contract; it is deliberately
test-only. Passing it does not mean that the planned endpoints are implemented.
"""
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / 'contracts/identity-v2.json').read_text())
VECTORS = json.loads((ROOT / 'contracts/identity-vectors.json').read_text())
NOW = 1_800_000_000


def token_kind(value):
    if not isinstance(value, str):
        return None
    for kind, prefix in CONTRACT['tokens']['kinds'].items():
        if re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9_-]{43}', value):
            return kind
    return None


def credential(cookie, authorization):
    """No legacy cookie decoding and no precedence that hides ambiguity."""
    if cookie and authorization:
        return None
    if cookie:
        return cookie if token_kind(cookie) == 'web_session' else None
    if not isinstance(authorization, str) or not authorization.startswith('Bearer '):
        return None
    token = authorization[7:]
    return token if token_kind(token) in ('access_token', 'api_key') else None


def principal():
    return dict(subject_id='00000000-0000-4000-8000-000000000001',
                credential_id='00000000-0000-4000-8000-000000000002',
                session_id='00000000-0000-4000-8000-000000000002',
                credential_kind='web_session', audience='search',
                subject_status='active', platform_owner=False,
                scopes=['search.query'], expires_at=NOW + 60,
                auth_version=1, policy_version=1)


def valid_response(payload, audience='search', auth_version=1,
                   policy_version=1, allowed_scopes=('search.query',)):
    """Only for an already authenticated service reply; never trust user JSON."""
    if not isinstance(payload, dict) or set(payload) != {'active', 'principal'}:
        return False
    if payload['active'] is not True or not isinstance(payload['principal'], dict):
        return False
    p = payload['principal']
    schema = CONTRACT['$defs']['principal']
    if set(p) != set(schema['required']):
        return False
    for name, spec in schema['properties'].items():
        value = p[name]
        if 'enum' in spec and value not in spec['enum']:
            return False
        if 'const' in spec and value != spec['const']:
            return False
        kind = spec.get('type')
        if kind == 'boolean' and type(value) is not bool:
            return False
        if kind == 'integer' and (type(value) is not int or value < spec['minimum']):
            return False
        if spec.get('format') == 'uuid' and value is not None:
            try:
                if not isinstance(value, str) or str(uuid.UUID(value)) != value:
                    return False
            except (ValueError, AttributeError):
                return False
        if name in ('subject_id', 'credential_id') and value is None:
            return False
    if p['audience'] != audience or p['expires_at'] <= NOW:
        return False
    if p['auth_version'] != auth_version or p['policy_version'] != policy_version:
        return False
    if not isinstance(p['scopes'], list) or any(type(x) is not str for x in p['scopes']):
        return False
    scopes = set(p['scopes'])
    if len(scopes) != len(p['scopes']) or not scopes <= set(allowed_scopes):
        return False
    if not scopes <= set(CONTRACT['scopes']):
        return False
    if p['credential_kind'] == 'api_key':
        return p['session_id'] is None
    return p['session_id'] is not None


def test_fresh_install_records_partial_runtime_without_legacy_import():
    assert CONTRACT['status'] == 'partial_implementation' and CONTRACT['runtime_implemented']
    assert CONTRACT['implemented_tasks'] == ['QUB-AUTH-009', 'QUB-AUTH-010', 'QUB-AUTH-011']
    assert all(r['status'] == ('implemented' if r['task'] in CONTRACT['implemented_tasks'] else 'planned') for r in CONTRACT['routes'])
    install = CONTRACT['installation']
    assert install['mode'] == 'fresh_install'
    assert not any(install[k] for k in (
        'legacy_import', 'legacy_password_verification',
        'legacy_session_acceptance', 'legacy_login_alias'))
    assert not install['public_registration_default']
    assert install['owner_bootstrap'] == 'explicit_local_operator_transaction'
    assert not CONTRACT['authority']['owner_paid_bypass']
    assert not CONTRACT['authority']['registration_grants_modules']


def test_cross_runtime_digest_and_pkce_vectors():
    assert VECTORS['fixture_only'] is True
    for v in VECTORS['opaque']:
        assert token_kind(v['token']) == v['kind']
        assert hashlib.sha256(v['token'].encode('ascii')).hexdigest() == v['sha256']
    for v in VECTORS['pkce']:
        digest = hashlib.sha256(v['verifier'].encode('ascii')).digest()
        assert base64.urlsafe_b64encode(digest).rstrip(b'=').decode() == v['challenge']
    code = """const fs=require('node:fs'),crypto=require('node:crypto');
const v=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({opaque:v.opaque.map(x=>crypto.createHash('sha256').update(x.token,'ascii').digest('hex')),
pkce:v.pkce.map(x=>crypto.createHash('sha256').update(x.verifier,'ascii').digest('base64url'))}));"""
    r = subprocess.run(['node', '-e', code], input=json.dumps(VECTORS),
                       capture_output=True, text=True, check=True, timeout=10)
    result = json.loads(r.stdout)
    assert result == dict(opaque=[v['sha256'] for v in VECTORS['opaque']],
                          pkce=[v['challenge'] for v in VECTORS['pkce']])


@pytest.mark.parametrize('value', [None, '', 'qb_session_legacy', 'qbs_' + 'A' * 43,
    '%E0%A4%A', 'qbt_s_' + 'A' * 42, 'qbt_s_' + 'A' * 44,
    'qbt_s_' + 'Ж' * 43, 'qbt_s_' + 'A' * 43 + '\n'])
def test_invalid_credentials_are_rejected_without_decoding_exception(value):
    assert token_kind(value) is None
    assert credential(value, '') is None


def test_token_types_and_ambiguous_credentials_cannot_be_confused():
    values = {v['kind']: v['token'] for v in VECTORS['opaque']}
    assert credential(values['web_session'], '') == values['web_session']
    assert credential('', 'Bearer ' + values['access_token']) == values['access_token']
    assert credential('', 'Bearer ' + values['api_key']) == values['api_key']
    assert credential(values['api_key'], '') is None
    assert credential('', 'Bearer ' + values['refresh_token']) is None
    assert credential('', 'Bearer ' + values['web_session']) is None
    assert credential(values['web_session'], 'Bearer ' + values['api_key']) is None


@pytest.mark.parametrize('field,value', [
    ('subject_id', 1), ('subject_id', None), ('session_id', None),
    ('platform_owner', 'true'), ('platform_owner', 1),
    ('audience', 'writing'), ('subject_status', 'blocked'),
    ('expires_at', NOW), ('expires_at', NOW - 1), ('expires_at', True),
    ('auth_version', 2), ('policy_version', 2),
    ('scopes', ['search.ai']), ('scopes', ['owner.manage']),
    ('scopes', ['search.query', 'search.query']), ('scopes', 'search.query')])
def test_negative_service_response_matrix(field, value):
    p = principal()
    p[field] = value
    assert not valid_response(dict(active=True, principal=p))


def test_inactive_partial_role_or_secret_response_fails_closed():
    good = dict(active=True, principal=principal())
    assert valid_response(good)
    for bad in ({'active': False}, {'active': 'true', 'principal': principal()},
                {'active': True}, {'active': True, 'principal': None}):
        assert not valid_response(bad)
    for field in ('role', 'actual_role', 'password_hash', 'token', 'budget_bypass'):
        bad = deepcopy(good)
        bad['principal'][field] = 'owner'
        assert not valid_response(bad)
    bad = deepcopy(good)
    del bad['principal']['policy_version']
    assert not valid_response(bad)
    bad = deepcopy(good)
    bad['upstream_exception'] = 'private'
    assert not valid_response(bad)


def test_owner_identity_does_not_add_scopes_and_api_keys_have_no_session():
    p = principal()
    p['platform_owner'] = True
    assert valid_response(dict(active=True, principal=p))
    p['scopes'].append('search.ai')
    assert not valid_response(dict(active=True, principal=p))
    p['scopes'] = ['search.query']
    p['credential_kind'] = 'api_key'
    assert not valid_response(dict(active=True, principal=p))
    p['session_id'] = None
    assert valid_response(dict(active=True, principal=p))


def test_endpoint_boundary_native_flow_and_response_hygiene():
    seen = set()
    for r in CONTRACT['routes']:
        key = (r['method'], r['path'])
        assert key not in seen and r['status'] == ('implemented' if r['task'] in CONTRACT['implemented_tasks'] else 'planned')
        seen.add(key)
        assert not any(x in r['path'] for x in ('code-entry', 'app/login', 'owner/bootstrap'))
    introspection = next(r for r in CONTRACT['routes'] if r['path'] == CONTRACT['internal']['path'])
    assert introspection['method'] == 'POST' and not CONTRACT['internal']['public_route']
    assert CONTRACT['internal']['forwarded_headers_trusted'] is False
    assert CONTRACT['internal']['principal_is_not_budget_or_resource_authorization'] is True
    assert not CONTRACT['oauth']['automatic_email_linking']
    assert CONTRACT['oauth']['callback_rechecks_enabled']
    assert CONTRACT['oauth']['configured_provider_only']
    native = CONTRACT['native']
    assert not any(native[k] for k in ('password_grant', 'implicit_grant', 'client_secret', 'dynamic_client_registration'))
    assert native['code_single_use'] and native['code_ttl_seconds'] == 60
    cookie = CONTRACT['web']['cookie']
    assert cookie['name'].startswith('__Host-') and cookie['path'] == '/' and cookie['domain'] is None
    assert cookie['secure'] and cookie['httponly']
    assert CONTRACT['tokens']['store_plaintext'] is False
    assert CONTRACT['tokens']['credential_cache_seconds'] == 0


def test_task_reference_syntax_and_private_route_boundary():
    # Source-copy intentionally excludes docs; the runner has already checked it.
    assert all(re.fullmatch(r'QUB-AUTH-\d{3}', r['task']) for r in CONTRACT['routes'])
    assert all(not r['path'].startswith('/api/') for r in CONTRACT['routes']
               if r['auth'].startswith('private'))
