#!/usr/bin/env python3
"""Only fixed application services can be controlled; networking/auth are excluded."""
import http.server
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import threading

SOCKET = '/run/qubite-runtime/manage.sock'
SERVICES = {
    'qubite': ('system', 'qubite-platform.service'),
    'hermes': ('user', 'hermes-gateway.service'),
    'vault': ('docker', 'aliasvault'),
    'languagetool': ('system', 'qubite-languagetool.service'),
    'omniroute': ('system', 'omniroute.service'),
    'searxng': ('docker', 'searxng'),
    'hermes_dashboard': ('system', 'hermes-dashboard.service'),
    'search': ('system', 'qubite-search.service'),
    'brief': ('system', 'qubite-specbot.service'),
    'memos': ('docker', 'memos'),
    'siyuan': ('docker', 'qubite-siyuan'),
    'vikunja': ('docker', 'vikunja'),
    'kwork_poll': ('system', 'kwork-bot-poll.service'),
    'kwork_work': ('system', 'kwork-bot-work.service'),
    'voice_listener': ('user', 'tg-listener.service'),
    'voice_bot': ('user', 'tg-notify-bot.service'),
}
LOCK = threading.Lock()

def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=45)

def systemctl(kind, *args):
    if kind == 'user':
        return ['runuser', '-u', os.environ.get('QUBITE_USER', 'kirill'), '--',
                'env', 'XDG_RUNTIME_DIR=/run/user/'+os.environ['QUBITE_UID'],
                'systemctl', '--user', *args]
    return ['systemctl', *args]

def status(name):
    kind, target = SERVICES[name]
    if kind == 'docker':
        r = run(['docker', 'inspect', '--format', '{{json .State}}', target])
        if r.returncode: return {'id': name, 'state': 'missing', 'running': False}
        state = json.loads(r.stdout)
        return {'id': name, 'state': state['Status'], 'running': bool(state['Running'])}
    r = run(systemctl(kind, 'show', target, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState'))
    props = dict(line.split('=', 1) for line in r.stdout.splitlines() if '=' in line)
    state = 'missing' if props.get('LoadState') != 'loaded' else props.get('ActiveState', 'unknown')
    return {'id': name, 'state': state, 'running': state == 'active'}

def manage(data):
    if not isinstance(data, dict): raise ValueError()
    if data == {'action': 'status'}:
        return {'items': [status(name) for name in SERVICES]}
    if set(data) != {'action', 'id', 'enabled'} or data['action'] != 'set' or data['id'] not in SERVICES or type(data['enabled']) is not bool:
        raise ValueError()
    name, enabled = data['id'], data['enabled']
    kind, target = SERVICES[name]
    with LOCK:
        if status(name)['state'] == 'missing': raise RuntimeError('missing')
        if kind == 'docker':
            # unless-stopped preserves a manual stop across Docker/host restarts.
            r = run(['docker', 'start' if enabled else 'stop', target])
        else:
            r = run(systemctl(kind, 'enable' if enabled else 'disable', '--now', target))
        current = status(name)
        if r.returncode or current['running'] != enabled: raise RuntimeError('transition')
        return {'ok': True, 'item': current}

class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        try:
            _, uid, _ = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != int(os.environ['QUBITE_UID']): raise PermissionError()
            self.connection.settimeout(5)
            n = int(self.headers.get('Content-Length', '0'))
            if self.path != '/manage' or not 0 < n <= 1024: raise ValueError()
            self.reply(200, manage(json.loads(self.rfile.read(n))))
        except (ValueError, KeyError, TypeError): self.reply(400, {'error': 'Некорректная команда.'})
        except PermissionError: self.reply(403, {'error': 'Нет доступа.'})
        except Exception: self.reply(503, {'error': 'Операция не завершена. Проверь статус сервиса.'})
    def reply(self, code, data):
        b = json.dumps(data).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

if __name__ == '__main__':
    Path(SOCKET).parent.mkdir(mode=0o750, exist_ok=True)
    Path(SOCKET).unlink(missing_ok=True)
    with Server(SOCKET, Handler) as server:
        os.chown(SOCKET, 0, int(os.environ['QUBITE_GID'])); os.chmod(SOCKET, 0o660)
        server.serve_forever()
