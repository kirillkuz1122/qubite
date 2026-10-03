"""HTTPS and guarded enrollment, preserving unrelated existing listeners and routes."""
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import time
from urllib.parse import urlparse

def install(root,base,env,account,run,private,unit):
 main=env['MAIN_SITE_DOMAIN'];search=urlparse(env['SERVICES_SEARCH_BASE_URL']).hostname;vault=urlparse(env['SERVICES_VAULT_BASE_URL']).hostname
 key=env['SERVICES_INTERNAL_KEY'];mode=env.get('INGRESS_MODE','cloudflare')
 app_port=int(env['PORT']);search_port=int(env.get('SEARCH_PORT','9120'));vault_port=int(env.get('ALIASVAULT_PORT','9082'))
 on=lambda name:env.get(name,'true').lower() in ('true','1','yes')
 if not shutil.which('caddy'):run(['apt-get','install','-y','caddy'])
 ca=base/'vault-ca.pem'
 if on('INSTALL_VAULT'):
  origin_cert=base/'aliasvault/certificates/ssl/cert.pem'
  # For a pre-existing managed installation the exact cert path is supplied explicitly.
  if env.get('VAULT_EXISTING_CERT'):origin_cert=Path(env['VAULT_EXISTING_CERT'])
  for _ in range(60):
   if origin_cert.exists():break
   time.sleep(1)
  if not origin_cert.exists():raise RuntimeError('AliasVault has not generated its origin certificate yet')
  shutil.copy2(origin_cert,ca);ca.chmod(0o644)
  env['VAULT_ORIGIN_CA']=str(ca)
  unit('qubite-vault-manager','Restricted AliasVault account manager',f'/usr/bin/python3 {root}/deploy/vault-manager.py',str(root),'root')
  with Path('/etc/systemd/system/qubite-vault-manager.service').open('a') as f:f.write(f'\n[Service]\nEnvironment=QUBITE_UID={account.pw_uid}\nEnvironment=QUBITE_GID={account.pw_gid}\nRuntimeDirectory=qubite-vault\nRuntimeDirectoryMode=0755\n')
 config=Path(env.get('SERVICES_CADDY_INCLUDE') or '/etc/caddy/Caddyfile')
 original=config.read_text() if config.exists() else '';previous_original=original
 from caddy_merge import merge_master
 original,reuse_main=merge_master(original,main,app_port) if on('INSTALL_PLATFORM') else (original,False)
 blocks=[];routes=[]
 for host,target,port,kind,flag in [(main,app_port,9284,'portal','INSTALL_PLATFORM'),(search,search_port,9281,'search','INSTALL_SEARCH'),(vault,vault_port,9280,'vault','INSTALL_VAULT')]:
  if not on(flag):continue
  if kind=='portal' and reuse_main and mode=='direct':continue
  address=host if mode=='direct' else f'http://127.0.0.1:{port}'
  lines=[address+' {']
  if mode!='direct':lines+=[' @wrongHost not host '+host,' respond @wrongHost "Unknown host" 404']
  if kind=='search':lines += [f' reverse_proxy 127.0.0.1:{target} {{','  header_up -X-Qubite-User','  header_up X-Qubite-Proxy '+key,' }']
  elif kind=='vault':
   lines += [' @admin path /admin* /api/admin*',' respond @admin "Private administration only" 403',' @registration path_regexp vault_register (?i)^/api/+v[^/]+/+auth/+(register|validate-username)/*$',' handle @registration {','  rewrite * /internal/services/vault/{re.vault_register.1}',f'  reverse_proxy 127.0.0.1:{app_port} {{','   header_up Host '+main,'   header_up X-Qubite-Service-Key '+key,'  }',' }',f' reverse_proxy https://127.0.0.1:{target} {{','  transport http {','   tls_trusted_ca_certs '+str(ca),'  }',' }']
  else:lines += [f' reverse_proxy 127.0.0.1:{target}']
  lines.append('}');blocks.append('\n'.join(lines));routes.append({'hostname':host,'service':f'http://127.0.0.1:{port}'})
 fragment=base/'Caddyfile.services';previous_fragment=fragment.read_text() if fragment.exists() else None;fragment.write_text('\n'.join(blocks)+'\n');fragment.chmod(0o640)
 caddy_gid=__import__('grp').getgrnam('caddy').gr_gid;os.chown(fragment,0,caddy_gid)
 # Caddy needs traversal of the app runtime directory to read its fragment/certificate.
 os.chmod(base,0o755)
 include='import '+str(fragment)
 proposed=original if include in original else original+'\n'+include+'\n'
 candidate=base/'Caddyfile.candidate';candidate.write_text(proposed);candidate.chmod(0o600)
 try:run(['caddy','validate','--config',str(candidate),'--adapter','caddyfile'])
 except Exception:
  if previous_fragment is None:fragment.unlink(missing_ok=True)
  else:fragment.write_text(previous_fragment)
  raise
 backup=base/'Caddyfile.previous';private(backup,previous_original)
 config.parent.mkdir(parents=True,exist_ok=True);config.write_text(proposed);os.chown(config,0,caddy_gid);config.chmod(0o640)
 run(['systemctl','enable','--now','caddy']);run(['systemctl','reload','caddy'])
 if mode=='cloudflare':
  if not shutil.which('cloudflared'):
   arch={'aarch64':'arm64','x86_64':'amd64'}.get(platform.machine())
   if not arch:raise RuntimeError('Unsupported cloudflared architecture')
   package=base/'cloudflared.deb';run(['curl','-fL','https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-'+arch+'.deb','-o',str(package)]);run(['dpkg','-i',str(package)]);package.unlink()
  token=env.get('CLOUDFLARE_TUNNEL_TOKEN','')
  if token:
   # A remotely managed tunnel has its public hostnames configured in the Cloudflare dashboard.
   if Path('/etc/systemd/system/cloudflared.service').exists():raise RuntimeError('Existing cloudflared service: use named tunnel config rather than replacing it')
   token_file=base/'cloudflare-token';private(token_file,token);os.chown(token_file,account.pw_uid,account.pw_gid)
   unit('qubite-cloudflared','Qubite Cloudflare Tunnel',f'/usr/bin/cloudflared tunnel --no-autoupdate run --token-file {token_file}',str(base),account.pw_name)
   print('В Cloudflare Public Hostnames назначьте адреса: '+', '.join(r['hostname']+' → '+r['service'] for r in routes))
  else:
   import json
   # Preserve a running named tunnel and merge only the selected hostnames.
   config_path=Path(env.get('CLOUDFLARE_CONFIG_PATH') or str(base/'cloudflared.json'))
   cert_dir=Path(account.pw_dir)/'.cloudflared';cert_dir.mkdir(mode=0o700,exist_ok=True);os.chown(cert_dir,account.pw_uid,account.pw_gid)
   cert=cert_dir/'cert.pem'
   if not cert.exists():
    print('Откройте ссылку авторизации Cloudflare и выберите домен '+main)
    run(['runuser','-u',account.pw_name,'--','cloudflared','tunnel','login'])
   name=env.get('CLOUDFLARE_TUNNEL_NAME') or 'qubite-'+main.replace('.','-')
   existing=run_capture(['cloudflared','tunnel','--origincert',str(cert),'list','--output','json'])
   entries=json.loads(existing);entry=next((d for d in entries if d.get('name')==name or d.get('id')==name),None)
   if entry:tid=entry['id']
   else:
    credential=cert_dir/(name+'.json')
    run(['cloudflared','tunnel','--origincert',str(cert),'--credentials-file',str(credential),'create',name]);tid=json.loads(credential.read_text())['TunnelID']
   credential=cert_dir/(tid+'.json')
   if not credential.exists():credential=cert_dir/(name+'.json')
   if not credential.exists():raise RuntimeError('Existing tunnel credential file not found')
   os.chown(credential,account.pw_uid,account.pw_gid);credential.chmod(0o600)
   prior={}
   if config_path.exists():
    try:prior=json.loads(config_path.read_text())
    except ValueError:
     import yaml
     prior=yaml.safe_load(config_path.read_text())
    if prior.get('tunnel') not in (None,tid,name):raise RuntimeError('Config belongs to another tunnel')
   ingress=[r for r in prior.get('ingress',[]) if r.get('hostname') not in {r['hostname'] for r in routes} and r.get('hostname')]
   prior.update(tunnel=tid,**{'credentials-file':str(credential),'protocol':'http2','ingress':ingress+routes+[{'service':'http_status:404'}]})
   if config_path.exists():shutil.copy2(config_path,base/'cloudflared.previous')
   private(config_path,json.dumps(prior,indent=2));os.chown(config_path,account.pw_uid,account.pw_gid)
   for r in routes:run(['cloudflared','tunnel','--origincert',str(cert),'route','dns',tid,r['hostname']])
   unit('qubite-cloudflared','Qubite named Cloudflare Tunnel',f'/usr/bin/cloudflared tunnel --config {config_path} --no-autoupdate run',str(base),account.pw_name)
   if Path('/etc/systemd/system/cloudflared.service').exists():
    # Config was explicitly provided for an existing service; avoid running the same tunnel twice.
    if not env.get('CLOUDFLARE_CONFIG_PATH'):raise RuntimeError('Set CLOUDFLARE_CONFIG_PATH to use the existing tunnel safely')
    run(['systemctl','restart','cloudflared']);return finalize_vault(root,base,env,run,private)
  run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','qubite-cloudflared'])
 elif mode!='direct':raise RuntimeError('INGRESS_MODE must be direct or cloudflare')
 finalize_vault(root,base,env,run,private)

def run_capture(args):return subprocess.check_output(args,text=True)

def finalize_vault(root,base,env,run,private):
 # The app .env is a managed private environment, never overwrite the user's source .env.
 private(base/'platform.env','\n'.join(k+'='+v for k,v in env.items() if '\n' not in v)+'\n')
 os.chown(base/'platform.env',__import__('pwd').getpwnam(env['SERVICES_USER']).pw_uid,__import__('pwd').getpwnam(env['SERVICES_USER']).pw_gid)
 run(['systemctl','daemon-reload'])
 if env.get('INSTALL_PLATFORM','true').lower()=='true':run(['systemctl','restart','qubite-platform'])
 if env.get('INSTALL_VAULT','true').lower()!='true':return
 run(['systemctl','enable','--now','qubite-vault-manager'])
 # Prove that unknown callers cannot reach native registration before enabling it.
 import urllib.request,urllib.error
 port=9280
 if env.get('INGRESS_MODE')=='direct':
  endpoint=env['SERVICES_VAULT_BASE_URL']+'/api/v1/Auth/register';headers={'Content-Type':'application/json'}
 else:endpoint=f'http://127.0.0.1:{port}/api/v1/Auth/register';headers={'Host':urlparse(env['SERVICES_VAULT_BASE_URL']).hostname,'Content-Type':'application/json'}
 try:urllib.request.urlopen(urllib.request.Request(endpoint,data=b'{"username":"registration-probe"}',headers=headers),timeout=15);raise RuntimeError('Registration guard did not deny the probe')
 except urllib.error.HTTPError as e:
  if e.code not in (401,403):raise RuntimeError('Registration guard not ready: '+str(e.code))
 # Recreate only our managed container using its existing mounts; credentials/data survive.
 detail=__import__('json').loads(subprocess.check_output(['docker','inspect','aliasvault'],text=True))[0]
 if detail.get('Config',{}).get('Labels',{}).get('org.qubite.managed')!='true':
  print('Existing AliasVault was left unchanged. Enable its internal registration only after verifying the proxy guard; docs/services.md.');return
 if 'PUBLIC_REGISTRATION_ENABLED=true' in detail['Config']['Env']:return
 old_name='aliasvault-before-invitations-'+str(int(time.time()))
 run(['docker','stop','aliasvault']);run(['docker','rename','aliasvault',old_name])
 try:
  args=['docker','run','-d','--restart','unless-stopped','--name','aliasvault','--label','org.qubite.managed=true','-e','FORCE_HTTPS_REDIRECT=true','-e','PUBLIC_REGISTRATION_ENABLED=true','-p',f"127.0.0.1:{env.get('ALIASVAULT_PORT','9082')}:443"]
  for m in detail['Mounts']:args.extend(['-v',m['Source']+':'+m['Destination']])
  args.append(detail['Config']['Image']);run(args)
 except Exception:
  subprocess.run(['docker','rm','-f','aliasvault'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  run(['docker','rename',old_name,'aliasvault']);run(['docker','start','aliasvault']);raise
 print('AliasVault enrollment enabled behind authenticated Qubite grant checks. Previous stopped container retained for rollback.')
