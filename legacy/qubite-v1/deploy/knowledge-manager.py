#!/usr/bin/env python3
"""One-use, local account enrollment. No arbitrary commands or password persistence."""
import datetime
import http.server
import json
import os
from pathlib import Path
import pty
import re
import select
import socket
import socketserver
import sqlite3
import struct
import subprocess
import termios
import threading
import time
import urllib.error
import urllib.request

SOCKET='/run/qubite-knowledge/manage.sock'
STATE=Path('/var/lib/qubite-knowledge/enrollment.json')
CONFIG=Path('/etc/qubite/knowledge-management.json')
LOCK=threading.Lock()
class Denied(Exception):pass

def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(state):
 STATE.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 temporary=STATE.with_suffix('.tmp')
 with temporary.open('w') as f:
  os.fchmod(f.fileno(),0o600);f.write(json.dumps(state));f.flush();os.fsync(f.fileno())
 os.replace(temporary,STATE)
 fd=os.open(STATE.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def load():return json.loads(STATE.read_text()) if STATE.exists() else {}
def native_username(data):
 return data['login'] if re.fullmatch(r'[a-z0-9][a-z0-9-]{1,34}[a-z0-9]',data['login']) else 'qb-'+str(data['user_id'])
def native(method,url,data=None,token=None):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(url,json.dumps(data).encode() if data is not None else None,headers,method=method)
 with urllib.request.urlopen(req,timeout=15) as r:return json.loads(r.read(65536) or b'{}')
def vik_user(login):
 file=json.loads(CONFIG.read_text())['vikunja_db']
 with sqlite3.connect('file:'+file+'?mode=ro',uri=True) as db:
  row=db.execute('SELECT id FROM users WHERE username=?',(login,)).fetchone()
  return row[0] if row else None

def cli_password(args,password):
 # PTY lets the official CLI read a hidden password; it never appears in argv.
 master,slave=pty.openpty();settings=termios.tcgetattr(slave);settings[3]&=~termios.ECHO;termios.tcsetattr(slave,termios.TCSANOW,settings)
 proc=subprocess.Popen(['docker','exec','-it','vikunja','/app/vikunja/vikunja','user',*args],stdin=slave,stdout=slave,stderr=slave,close_fds=True);os.close(slave)
 buffer=b'';sent=0;deadline=time.monotonic()+30
 try:
  while proc.poll() is None and time.monotonic()<deadline:
   ready,_,_=select.select([master],[],[],.3)
   if ready:
    try:chunk=os.read(master,4096)
    except OSError:break
    buffer=(buffer+chunk)[-8192:]
    # Send only when a prompt is visible; confirmations are handled separately.
    if re.search(rb'(?:password|confirm)[^\r\n]*[:>]\s*$',buffer,re.I) and sent<2:
     os.write(master,(password+'\n').encode());sent+=1;buffer=b''
  if proc.poll() is None:proc.kill()
  if proc.wait(timeout=3)!=0 or sent==0:raise RuntimeError('Native CLI failed')
 finally:
  os.close(master)
  if proc.poll() is None:proc.kill();proc.wait()

def validate(data):
 if not isinstance(data,dict) or data.get('action') not in ('info','enroll','lookup') or data.get('service') not in ('memos','vikunja'):raise ValueError()
 if data['action']=='lookup':
  if set(data)!={'action','service','login'} or not isinstance(data['login'],str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,34}[a-z0-9]',data['login']):raise ValueError()
  return
 expected={'action','service','user_id','login','email'}|({'password'} if data['action']=='enroll' else set())
 if set(data)!=expected or type(data['user_id']) is not int or data['user_id']<1:raise ValueError()
 if not isinstance(data['login'],str) or not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,31}',data['login']):raise ValueError()
 if not isinstance(data['email'],str) or len(data['email'])>120 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',data['email']):raise ValueError()
 if data['action']=='enroll':
  p=data['password']
  if not isinstance(p,str) or not 8<=len(p)<=72 or len(p.encode('utf-8'))>72 or not re.search(r'[A-Za-z]',p) or not re.search(r'\d',p) or re.search(r'\s',p):raise ValueError()

def manage(data):
 validate(data)
 if data['action']=='lookup':
  with LOCK:
   matches=[(k,e) for k,e in load().items() if k.endswith(':'+data['service']) and e['login']==data['login'] and e['state']=='active']
   if len(matches)!=1:return {'ready':False}
   k,e=matches[0];return {'ready':True,'user_id':int(k.split(':')[0]),'login':e['login'],'native_id':e['native_id']}
 key=str(data['user_id'])+':'+data['service']
 with LOCK:
  state=load();entry=state.get(key);login=entry['login'] if entry else native_username(data)
  if data['action']=='info':return {'ready':bool(entry and entry['state']=='active'),'blocked':bool(entry and entry['state'] not in ('active','pending_owner')),'login':login}
  if entry and entry['state']!='pending_owner':raise Denied()
  password=data['password'];config=json.loads(CONFIG.read_text());service=data['service'];existing=None
  if service=='memos':
   try:existing=native('GET','http://127.0.0.1:5230/api/v1/users/'+login,token=config['memos_token'])
   except urllib.error.HTTPError as e:
    if e.code!=404:raise
  else:
   native('GET','http://127.0.0.1:3456/api/v1/info');existing=vik_user(login)
  if existing and not entry:raise Denied()
  if entry and not existing:raise RuntimeError('Prepared native account missing')
  if entry and str(entry['native_id'])!=str(existing.get('name') if service=='memos' else existing):raise Denied()
  state[key]={**(entry or {}),'login':login,'state':'creating','created':entry.get('created') if entry else stamp(),'updated':stamp()};save(state)
  if service=='memos':
   if entry:result=native('PATCH','http://127.0.0.1:5230/api/v1/users/'+login+'?updateMask=password',{'password':password},config['memos_token'])
   else:result=native('POST','http://127.0.0.1:5230/api/v1/users',{'username':login,'email':data['email'],'displayName':data['login'],'role':'USER','password':password},config['memos_token'])
   identity=result['name']
   # Verify supplied password, without storing the login token or password.
   native('POST','http://127.0.0.1:5230/api/v1/auth/signin',{'passwordCredentials':{'username':login,'password':password}})
  else:
   if entry:cli_password(['reset-password',str(existing),'--direct'],password)
   else:cli_password(['create','-u',login,'-e',data['email']],password)
   identity=str(vik_user(login));assert identity!='None'
   native('POST','http://127.0.0.1:3456/api/v1/login',{'username':login,'password':password})
  state[key].update(state='active',native_id=identity,updated=stamp());save(state)
  return {'ok':True,'login':login}

class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):daemon_threads=True
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  try:
   _,uid,_=struct.unpack('3i',self.connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
   if uid!=int(os.environ['QUBITE_UID']):raise PermissionError()
   self.connection.settimeout(5);n=int(self.headers.get('Content-Length','0'))
   if self.path!='/manage' or not 0<n<=4096:raise ValueError()
   self.reply(200,manage(json.loads(self.rfile.read(n))))
  except (ValueError,KeyError,TypeError):self.reply(400,{'error':'Некорректные данные регистрации.'})
  except PermissionError:self.reply(403,{'error':'Нет доступа.'})
  except Denied:self.reply(409,{'error':'Первичная регистрация недоступна: аккаунт уже создан или требуется проверка владельцем.'})
  except Exception:self.reply(503,{'error':'Не удалось подтвердить создание аккаунта. Повтори позже; если пароль уже был отправлен, нужна проверка владельцем.'})
 def reply(self,code,data):
  b=json.dumps(data).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
if __name__=='__main__':
 Path(SOCKET).parent.mkdir(parents=True,exist_ok=True,mode=0o750);Path(SOCKET).unlink(missing_ok=True)
 with Server(SOCKET,Handler) as server:
  os.chown(SOCKET,0,int(os.environ['QUBITE_GID']));os.chmod(SOCKET,0o660);server.serve_forever()
