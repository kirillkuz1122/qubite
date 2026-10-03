#!/usr/bin/env python3
"""Generate private service config without replacing an existing Caddy/VPN instance."""
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import socket
import time
import platform
import re
import subprocess
import sys
from urllib.parse import urlparse
root=Path(sys.argv[1]).resolve()
env={}
for line in (root/'.env').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);env[k.strip()]=v.strip().strip('"\'')
for k in ['INSTALL_PLATFORM','INSTALL_SEARCH','INSTALL_VAULT','INSTALL_VPN','INGRESS_MODE','SERVICES_VPN_ENABLED']:
 if k in os.environ:env[k]=os.environ[k]
def on(k,default=True):return env.get(k,str(default)).lower() in ('true','yes','1')
def run(args,**kwargs):subprocess.run(args,check=True,**kwargs)
def private(path,content):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content);path.chmod(0o600)
def unit(name,description,command,cwd,user):
 file=Path('/etc/systemd/system')/(name+'.service')
 if file.exists() and name not in ('qubite-platform','qubite-search','qubite-vault-manager','qubite-cloudflared'):raise RuntimeError('Service already exists: '+name)
 file.write_text(f'[Unit]\nDescription={description}\nAfter=network-online.target\n[Service]\nUser={user}\nWorkingDirectory={cwd}\nExecStart={command}\nRestart=on-failure\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\n[Install]\nWantedBy=multi-user.target\n')
if (on('INSTALL_SEARCH') or on('INSTALL_VAULT')) and not on('INSTALL_PLATFORM'):
 raise RuntimeError('Search and invited vault enrollment require the Qubite platform. Install it or configure an existing platform explicitly.')
if on('INSTALL_SEARCH') and not env.get('SEARCH_OPENROUTER_API_KEY'):raise RuntimeError('Fill SEARCH_OPENROUTER_API_KEY first')
if env.get('INGRESS_MODE','cloudflare') not in ('cloudflare','direct'):raise RuntimeError('INGRESS_MODE: direct or cloudflare')
if env.get('INGRESS_MODE','cloudflare')=='cloudflare':env['SERVICES_VPN_ENABLED']='false'
if '--check' in sys.argv:
 print(json.dumps({'platform':on('INSTALL_PLATFORM'),'search':on('INSTALL_SEARCH'),'vault':on('INSTALL_VAULT'),'vpn':on('INSTALL_VPN',False),'ingress':env.get('INGRESS_MODE','cloudflare'),'search_key_configured':bool(env.get('SEARCH_OPENROUTER_API_KEY'))}))
 sys.exit(0)
user=env.get('SERVICES_USER') or os.environ.get('SUDO_USER') or 'qubite'
if user=='root':user='qubite'
try:account=pwd.getpwnam(user)
except KeyError:run(['useradd','--system','--create-home','--shell','/usr/sbin/nologin',user]);account=pwd.getpwnam(user)
base=root/'services/runtime';base.mkdir(parents=True,exist_ok=True)
app_port=int(env.get('APP_PORT','9130'));search_port=int(env.get('SEARCH_PORT','9120'));searx_port=int(env.get('SEARXNG_PORT','9081'));vault_port=int(env.get('ALIASVAULT_PORT','9082'))
main=env.get('MAIN_SITE_DOMAIN','qubiteapp.online');search_url=env.get('SERVICES_SEARCH_BASE_URL','https://search.'+main);vault_url=env.get('SERVICES_VAULT_BASE_URL','https://vault.'+main)
for value in [main,urlparse(search_url).hostname,urlparse(vault_url).hostname]:
 if not value or any(x not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.' for x in value):raise RuntimeError('Invalid service hostname')
key=env.get('SERVICES_INTERNAL_KEY') or secrets.token_hex(32);env['SERVICES_INTERNAL_KEY']=key
if len(key)<32 or any(c not in '0123456789abcdefABCDEF_-' for c in key):raise RuntimeError('Invalid internal key')
env.update(HOST='127.0.0.1',PORT=str(app_port),NODE_ENV='production',APP_BASE_URL='https://'+main,TRUST_PROXY='1',SEED_DEMO_DATA='false',TURNSTILE_DEV_BYPASS='false',SESSION_COOKIE_DOMAIN='.'+main,ALLOWED_ORIGINS='https://'+main+','+vault_url,SERVICES_SEARCH_BASE_URL=search_url,SERVICES_VAULT_BASE_URL=vault_url)
env['MAIN_SITE_DOMAIN']=main
env['SERVICES_USER']=user
env['SEARCH_INTERNAL_URL']=f'http://127.0.0.1:{search_port}'
# Existing DATABASE_PATH is respected; a new installer never copies seeded development data.
if not env.get('DATABASE_PATH') or env['DATABASE_PATH'].startswith('/home/kirill/programing/qubite/'):env['DATABASE_PATH']=str(base/'qubite.sqlite')
env['VAULT_MANAGEMENT_SOCKET']='/run/qubite-vault/manage.sock'
env['VAULT_ORIGIN_PORT']=str(vault_port)
secret_path=base/'platform.env';private(secret_path,'\n'.join(k+'='+v for k,v in env.items() if '\n' not in v)+'\n')
# Node loads this EnvironmentFile before its optional root .env.
if on('INSTALL_PLATFORM'):
 unit('qubite-platform','Qubite platform',f'{shutil.which("node")} {root}/back/server.js',str(root),user)
 with Path('/etc/systemd/system/qubite-platform.service').open('a') as f:f.write(f'\n[Service]\nEnvironmentFile={secret_path}\n')
services=[]
if on('INSTALL_SEARCH'):
 settings=base/'searxng';settings.mkdir(parents=True,exist_ok=True)
 private(settings/'settings.yml','use_default_settings: true\nserver:\n  secret_key: '+secrets.token_hex(32)+'\n  limiter: false\n  image_proxy: true\nsearch:\n  formats: [html, json]\noutgoing:\n  request_timeout: 5.0\n  max_request_timeout: 8.0\n')
 if subprocess.run(['docker','inspect','searxng'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
  run(['docker','run','-d','--restart','unless-stopped','--name','searxng','-p',f'127.0.0.1:{searx_port}:8080','-v',str(settings)+':/etc/searxng','ghcr.io/searxng/searxng:latest'])
 app=root/'services/search';run(['python3','-m','venv',str(app/'.venv')]);run([str(app/'.venv/bin/pip'),'install','-r',str(app/'requirements.txt')])
 searchenv={k:v for k,v in env.items() if k.startswith('SEARCH_')}
 searchenv.update(OPENROUTER_API_KEY=env.get('SEARCH_OPENROUTER_API_KEY',''),PROXY_SECRET=key,SEARXNG_URL=f'http://127.0.0.1:{searx_port}',QUBITE_INTERNAL_URL=f'http://127.0.0.1:{app_port}',SERVICES_INTERNAL_KEY=key,QUBITE_PUBLIC_URL='https://'+main,QUBITE_HOST=main,SEARCH_PUBLIC_URL=search_url,DAILY_BUDGET_USD=env.get('SEARCH_DAILY_BUDGET_USD','.05'),DATA_DIR=str(base/'search-data'))
 (settings/'settings.yml').chmod(0o644)
 if not searchenv['OPENROUTER_API_KEY']:raise RuntimeError('Fill SEARCH_OPENROUTER_API_KEY first')
 private(app/'.env','\n'.join(k+'='+v for k,v in searchenv.items())+'\n')
 unit('qubite-search','Qubite AI search',f'{app}/.venv/bin/uvicorn app:app --host 127.0.0.1 --port {search_port} --workers 1 --no-access-log',str(app),user)
 services.append(f'{urlparse(search_url).hostname} {{\n reverse_proxy 127.0.0.1:{search_port} {{\n header_up -X-Qubite-User\n header_up X-Qubite-Proxy {key}\n }}\n}}\n')
if on('INSTALL_VAULT'):
 vault=base/'aliasvault'
 for directory in ['database','logs','secrets','certificates']:(vault/directory).mkdir(parents=True,exist_ok=True)
 if subprocess.run(['docker','inspect','aliasvault'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
  # Registration stays disabled until the authenticated proxy guard is installed.
  run(['docker','run','-d','--restart','unless-stopped','--name','aliasvault','--label','org.qubite.managed=true','-e','FORCE_HTTPS_REDIRECT=true','-e','PUBLIC_REGISTRATION_ENABLED=false','-p',f'127.0.0.1:{vault_port}:443',*[x for directory in ['database','logs','secrets','certificates'] for x in ['-v',str(vault/directory)+':/'+directory]],env.get('ALIASVAULT_IMAGE','ghcr.io/aliasvault/aliasvault:0.30.7')])
 # Certificate and guarded registration activation are finalized by configure-ingress.
 services.append(f'# AliasVault: origin https://127.0.0.1:{vault_port}, pinned certificate required; see docs/services.md\n')
# Keep secrets and DB writable by the app user, but never change an unrelated service's ownership.
for path in [base,*[p for p in base.rglob('*') if 'aliasvault' not in p.relative_to(base).parts],root/'services/search',*(root/'services/search').rglob('*')]:
 if path.exists():os.chown(path,account.pw_uid,account.pw_gid)
os.chown(secret_path,account.pw_uid,account.pw_gid)
private(base/'caddy-services.generated',f'{main} {{\n reverse_proxy 127.0.0.1:{app_port}\n}}\n'+''.join(services))
run(['systemctl','daemon-reload'])
for name,flag in [('qubite-platform','INSTALL_PLATFORM'),('qubite-search','INSTALL_SEARCH')]:
 if on(flag):run(['systemctl','enable','--now',name])
from ingress import install
install(root,base,env,account,run,private,unit)
print('Компоненты установлены. Завершите HTTPS/туннель и приглашение владельца по docs/services.md.')
print('Маршруты Caddy добавлены после проверки. Nginx, sing-box и firewall этот этап не меняет.')
