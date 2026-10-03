#!/usr/bin/env python3
"""Restricted local AliasVault account management; encrypted vault content is untouched."""
import http.server
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import struct
import subprocess

SOCKET='/run/qubite-vault/manage.sock'
class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        try:
            _,uid,_=struct.unpack('3i',self.connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            if uid!=int(os.environ['QUBITE_UID']):raise PermissionError()
            n=int(self.headers.get('Content-Length','0'))
            if self.path!='/manage' or not 0<n<=4096:raise ValueError()
            d=json.loads(self.rfile.read(n));login=d.get('login','')
            if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,31}',login):raise ValueError()
            # Strict identifier validation, quoted SQL literal; never arbitrary SQL or shell.
            where='"NormalizedUserName"=\''+login.upper()+"'"
            if d['action']=='block' and isinstance(d.get('blocked'),bool):
                blocked='TRUE' if d['blocked'] else 'FALSE'
                sql='BEGIN; UPDATE "AliasVaultUsers" SET "Blocked"='+blocked+',"BlockedAt"='+('NOW()' if d['blocked'] else 'NULL')+',"UpdatedAt"=NOW() WHERE '+where+'; '
                if d['blocked']:sql+='DELETE FROM "AliasVaultUserRefreshTokens" WHERE "UserId" IN (SELECT "Id" FROM "AliasVaultUsers" WHERE '+where+'); '
                sql+='COMMIT;'
            elif d['action']=='delete':
                sql='DELETE FROM "AliasVaultUsers" WHERE '+where+';'
            else:raise ValueError()
            result=subprocess.run(['docker','exec','-i','aliasvault','psql','-v','ON_ERROR_STOP=1','-U','aliasvault','-d','aliasvault'],input=sql,text=True,capture_output=True,timeout=15)
            if result.returncode:raise RuntimeError()
            self.reply(200,{'ok':True})
        except (ValueError,KeyError,json.JSONDecodeError):self.reply(400,{'error':'Invalid management request'})
        except PermissionError:self.reply(403,{'error':'Forbidden'})
        except Exception:self.reply(503,{'error':'AliasVault management unavailable'})
    def reply(self,status,data):
        b=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
if __name__=='__main__':
    Path(SOCKET).parent.mkdir(mode=0o750,exist_ok=True)
    try:os.unlink(SOCKET)
    except FileNotFoundError:pass
    with Server(SOCKET,Handler) as server:
        os.chown(SOCKET,0,int(os.environ['QUBITE_GID']));os.chmod(SOCKET,0o660);server.serve_forever()
