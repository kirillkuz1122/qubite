#!/usr/bin/env python3
"""Explicit browser fixture: source copy, disposable PostgreSQL, synthetic users/mail.
Never a deployment entrypoint. No .env, operator data, SMTP, or external network.
"""
from contextlib import contextmanager, ExitStack
from pathlib import Path
import json
import os
import shutil
import socket
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'http://127.0.0.1:4323'
PASSWORD = 'Synthetic browser password 42!'
EMAIL = 'browser-owner@example.test'


def main():
    configured_bin = os.environ.get('QUBITE_TEST_POSTGRES_BIN')
    task_path = os.environ.get('PATH', '')
    os.environ.clear()
    os.environ.update(PATH=task_path, LANG='C.UTF-8')
    if configured_bin:
        os.environ['QUBITE_TEST_POSTGRES_BIN'] = configured_bin
    with tempfile.TemporaryDirectory(prefix='qubite-web-auth-') as directory, ExitStack() as stack:
        root = Path(directory)
        home = root / 'home'; home.mkdir()
        os.environ['HOME'] = str(home)
        source = root / 'code'
        for path in (ROOT / 'core').rglob('*'):
            if path.is_file() and not path.is_symlink() and path.suffix in {'.py', '.sql'} and '.env' not in path.name:
                target = source / path.relative_to(ROOT)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
        sys.path[:0] = [str(source / 'core'), str(source / 'core/tests')]
        # Reuse the same audited cluster lifecycle as core integration tests.
        from conftest import postgres_cluster, database_url
        from qubite.app import create_app
        from qubite.config import Settings
        from qubite.identity import bootstrap_owner
        from qubite.identity.auth.store import setup_owner_password
        from qubite.identity.registration.store import RegistrationStore
        from qubite.identity.auth.tokens import issue, digest
        from qubite.migrations import apply
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse
        from starlette.staticfiles import StaticFiles
        import psycopg
        import uvicorn
        from uuid import uuid4
        from datetime import datetime, timedelta, timezone
        connect = socket.socket.connect
        def offline(self, address):
            if isinstance(address, tuple) and address[0] not in {'127.0.0.1', '::1', 'localhost'}:
                raise RuntimeError('Browser fixture: external network denied')
            return connect(self, address)
        socket.socket.connect = offline
        class Factory:
            def mktemp(self, name):
                return Path(tempfile.mkdtemp(prefix=name, dir=root))
        cluster = stack.enter_context(contextmanager(postgres_cluster.__wrapped__)(Factory()))
        databases = stack.enter_context(ExitStack())
        database = None
        settings = None
        mail = []
        def transport(envelope):
            mail.append(envelope)
            return True
        state = {'app': None}
        def reset(mode='public', enabled=True):
            nonlocal settings, database
            databases.close()
            database = databases.enter_context(contextmanager(database_url.__wrapped__)(cluster))
            settings = Settings(database, auth_origin=ORIGIN, auth_local_http=True, email_challenges_enabled=enabled)
            apply(settings)
            bootstrap_owner(settings, EMAIL)
            setup_owner_password(settings, PASSWORD)
            with psycopg.connect(database) as db:
                db.execute("UPDATE qubite_core.subjects SET email_verified_at=CURRENT_TIMESTAMP")
                db.execute("UPDATE qubite_core.registration_state SET mode=%s WHERE singleton=1", (mode,))
            mail.clear()
            state['app'] = create_app(settings, mail_transport=transport)
        reset()
        control = FastAPI(docs_url=None, openapi_url=None)
        @control.post('/__fixture__/reset')
        async def reset_route(request: Request):
            body = await request.json()
            if body.get('mode', 'public') not in {'public', 'invite', 'disabled'} or type(body.get('mail_enabled', True)) is not bool:
                return JSONResponse({'code':'invalid_fixture'}, status_code=400)
            reset(body.get('mode', 'public'), body.get('mail_enabled', True))
            return {'status':'synthetic_ready'}
        @control.post('/__fixture__/invite')
        def invite_route():
            raw = issue('qbt_ri_'); now = datetime.now(timezone.utc)
            with psycopg.connect(database) as db:
                owner = db.execute('SELECT subject_id FROM qubite_core.platform_owner').fetchone()[0]
                db.execute('''INSERT INTO qubite_core.registration_invites
                    (id,token_hash,request_hash,email_canonical,created_by,created_at,expires_at)
                    VALUES (%s,%s,%s,NULL,%s,%s,%s)''', (uuid4(), digest(raw), digest(raw), owner, now, now+timedelta(hours=1)))
            return {'token':raw}
        @control.get('/__fixture__/mail')
        def mail_route():
            return {'items':[{'purpose':e.purpose,'challenge_id':str(e.challenge_id),'token':e.token} for e in mail]}
        @control.post('/__fixture__/revoke')
        def revoke_route():
            with psycopg.connect(database) as db:
                db.execute('UPDATE qubite_core.sessions SET revoked_at=CURRENT_TIMESTAMP')
            return {'status':'revoked'}
        @control.post('/__fixture__/catalog')
        async def catalog_state(request: Request):
            # Synthetic registrar/member setup, never a production API.
            from qubite.identity import create_subject
            from qubite.identity.auth.passwords import hash_password
            from qubite.policy.store import POLICY_LOCK
            body = await request.json()
            module = body.get('module', 'docs')
            status = body.get('status', 'preparing')
            if module not in {'docs','projects','planner','search','writing','vpn','vault','atlas'} or status not in {'preparing','unavailable','ready'}:
                return JSONResponse({'code':'invalid_fixture'}, status_code=400)
            with psycopg.connect(database) as db:
                row=db.execute("SELECT id FROM qubite_core.subjects WHERE email_canonical='browser-member@example.test'").fetchone()
            if not row:
                member=create_subject(settings, 'browser-member@example.test')
                with psycopg.connect(database) as db:
                    db.execute("UPDATE qubite_core.subjects SET status='active',email_verified_at=CURRENT_TIMESTAMP WHERE id=%s", (member.id,))
                    db.execute('INSERT INTO qubite_core.password_credentials(subject_id,password_hash) VALUES (%s,%s)', (member.id,hash_password(PASSWORD)))
                member_id=member.id
            else: member_id=row[0]
            with psycopg.connect(database) as db:
                db.execute('SELECT pg_advisory_xact_lock(%s)', (POLICY_LOCK,))
                db.execute('UPDATE qubite_core.policy_modules SET installed=%s,enabled=%s WHERE id=%s', (status!='preparing',status=='ready',module))
                db.execute('UPDATE qubite_core.module_catalog SET released=%s WHERE module=%s', (status=='ready',module))
                db.execute('UPDATE qubite_core.policy_state SET revision=revision+1 WHERE singleton')
            return {'member_id':str(member_id)}
        @control.get('/__fixture__/counts')
        def counts_route():
            with psycopg.connect(database) as db:
                return {name: db.execute('SELECT count(*) FROM qubite_core.' + name).fetchone()[0]
                        for name in ('subjects','sessions','registration_consents','policy_entitlements','policy_ai_grants')}
        from starlette.applications import Starlette
        from starlette.routing import Mount
        static = Starlette(routes=[Mount('/', app=StaticFiles(directory=ROOT / 'apps/web/dist', html=True))])
        class Router:
            async def __call__(self, scope, receive, send):
                if scope['type'] == 'http' and scope['path'].startswith('/__fixture__/'):
                    await control(scope, receive, send)
                elif scope['type'] == 'http' and scope['path'].startswith('/api/'):
                    await state['app'](scope, receive, send)
                elif scope['type'] == 'http':
                    await static(scope, receive, send)
                else:
                    await control(scope, receive, send)
        uvicorn.run(Router(), host='127.0.0.1', port=4323, access_log=False, log_level='warning')

if __name__ == '__main__':
    main()
