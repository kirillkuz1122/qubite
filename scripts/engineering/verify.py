#!/usr/bin/env python3
"""Изолированные проверки: копия исходников без .env, отдельные HOME/БД, no external network."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]

def run(argv, cwd, env):
    result = subprocess.run(argv, cwd=cwd, env=env, timeout=180, capture_output=True, text=True)
    print(result.stdout[-1800:])
    if result.returncode == 0 and result.stderr:
        print(result.stderr[-1800:])
    if result.returncode:
        print(result.stdout)
        print(result.stderr[-6000:])
        raise SystemExit(result.returncode)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', choices=['all', 'node', 'deploy', 'search', 'specbot', 'kwork', 'siyuan', 'core'], default='all')
    parser.add_argument('--python', default=sys.executable, help='Python с pytest и зависимостями сервисов')
    parser.add_argument('--postgres-bin', help='Каталог native initdb/postgres только для disposable core fixture')
    args = parser.parse_args()
    run([sys.executable, 'scripts/engineering/check.py'], ROOT, os.environ.copy())
    with tempfile.TemporaryDirectory(prefix='qubite-harness-') as directory:
        root = Path(directory)
        code = root / 'code'
        code.mkdir()
        names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
        allowed = {'back', 'front', 'deploy', 'services', 'integrations', 'scripts', 'tests', 'core', 'contracts'}
        suffixes = {'.js', '.cjs', '.mjs', '.py', '.json', '.html', '.css', '.txt', '.md', '.svg', '.ttf', '.sql'}
        for name in sorted(set(names)):
            p = Path(name)
            if not name or '.env' in p.name or p.suffix not in suffixes:
                continue
            if len(p.parts) > 1 and p.parts[0] not in allowed:
                continue
            source = ROOT / p
            if source.is_symlink() or not source.is_file():
                continue
            target = code / p
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        modules = ROOT / 'back/node_modules'
        if modules.is_dir():
            (code / 'back/node_modules').symlink_to(modules, target_is_directory=True)
        home = root / 'home'
        home.mkdir()
        policy = root / 'policy'
        policy.mkdir()
        # Deny external network even when a legacy test forgets to mock a provider.
        (policy / 'sitecustomize.py').write_text('''import socket
import ipaddress
_original = socket.socket.connect
def connect(self, address):
    if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1", "localhost"):
        raise RuntimeError("Harness: external network denied")
    return _original(self, address)
socket.socket.connect = connect
_original_dns = socket.getaddrinfo
def dns(host, *args, **kwargs):
    if host not in ("127.0.0.1", "::1", "localhost", None):
        try: ipaddress.ip_address(host)
        except ValueError: raise RuntimeError("Harness: external DNS denied")
    return _original_dns(host, *args, **kwargs)
socket.getaddrinfo = dns
''')
        (policy / 'offline.cjs').write_text('''const net=require('node:net');
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const normalized=net._normalizeArgs(args), o=normalized[0];
 if(o.host && !['127.0.0.1','::1','localhost'].includes(o.host))throw Error('Harness: external network denied');
 return original.apply(this,args);
};
const dns=require('node:dns');
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!['127.0.0.1','::1','localhost'].includes(host))throw Error('Harness: external DNS denied');return lookup.call(this,host,...args);};
''')
        # Do not inherit credentials/proxy variables from the developer session.
        env = {k:v for k,v in os.environ.items() if k in {'PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT'}}
        env.update(HOME=str(home), DATABASE_PATH=str(root/'test.sqlite'), QUBITE_EVENT_SOCKET_DIR=str(root/'ipc'),
                   SEED_DEMO_DATA='false', TELEGRAM_ENABLED='false', PYTHONDONTWRITEBYTECODE='1',
                   PYTEST_DISABLE_PLUGIN_AUTOLOAD='1', DATA_DIR=str(root/'data'),
                   NODE_OPTIONS=f'--require={policy}/offline.cjs')
        suites = ['node', 'deploy', 'search', 'specbot', 'kwork', 'siyuan', 'core'] if args.suite == 'all' else [args.suite]
        for suite in suites:
            print('SUITE:', suite, flush=True)
            if suite == 'node':
                files = sorted(str(p.relative_to(code)) for p in (code/'back/tests').glob('*.test.js'))
                run(['node', '--test', '--test-reporter=tap', *files, 'services/search/tests/test_media.cjs'], code, env)
            elif suite == 'deploy':
                run([args.python, '-m', 'unittest', 'discover', '-s', 'deploy/services/tests'], code, {**env, 'PYTHONPATH':str(policy)})
            elif suite == 'core':
                folder = code / 'core'
                core_env = {**env, 'PYTHONPATH': os.pathsep.join([str(policy), str(folder)])}
                if args.postgres_bin:
                    core_env['QUBITE_TEST_POSTGRES_BIN'] = str(Path(args.postgres_bin).resolve())
                run([args.python, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'tests'], folder, core_env)
            else:
                folders = {'search':'services/search', 'specbot':'services/specbot', 'kwork':'integrations/kwork', 'siyuan':'integrations/qubite-siyuan'}
                folder = code / folders[suite]
                run([args.python, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'tests'], folder,
                    {**env, 'PYTHONPATH': os.pathsep.join([str(policy), str(folder), str(code/'integrations/kwork')])})
    print('PASS: выбранные suites завершены; production не запускался')
