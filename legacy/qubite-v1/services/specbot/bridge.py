"""Local-only Kwork invitations. No HTTP server, Telegram polling or AI call."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sys
import time
from config import Config, load_env
from store import Store, PRESETS, digest


def link_key(data):
    path = data / 'brief-link.key'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'wb') as f:
            f.write(secrets.token_bytes(32))
    info = path.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Private integration key permissions invalid')
    key = path.read_bytes()
    if len(key) != 32:
        raise ValueError('Private integration key invalid')
    return key


def create_invitation(store, request, key, owner, username):
    if set(request) - {'oid', 'title', 'preset', 'focus'}:
        raise ValueError('Unknown invitation field')
    oid = str(request.get('oid', ''))
    title = request.get('title')
    focus = request.get('focus', '')
    preset = request.get('preset', 'general')
    if not re.fullmatch(r'\d{1,20}', oid):
        raise ValueError('Invalid project id')
    if not isinstance(title, str) or not title.strip() or len(title) > 150:
        raise ValueError('Invalid title')
    if not isinstance(focus, str) or len(focus) > 5000 or preset not in PRESETS:
        raise ValueError('Invalid interview focus')
    if not re.fullmatch(r'[A-Za-z0-9_]{5,32}', username) or owner <= 0:
        raise ValueError('Invalid owner/bot')
    store.db.execute('''CREATE TABLE IF NOT EXISTS external_invites(
        source TEXT PRIMARY KEY,session TEXT NOT NULL UNIQUE
        REFERENCES sessions(id) ON DELETE CASCADE)''')

    def action():
        source = 'kwork:' + oid
        row = store.db.execute('SELECT session FROM external_invites WHERE source=?', (source,)).fetchone()
        created = row is None
        if created:
            sid, _ = store.create(title.strip(), preset, focus)
            store.db.execute('INSERT INTO external_invites VALUES(?,?)', (source, sid))
        else:
            sid = row['session']
        session = store.get(sid)
        if session['status'] == 'revoked' or session['expires'] < time.time():
            raise ValueError('Invitation expired or revoked; use Brief owner controls')
        token = base64.urlsafe_b64encode(hmac.new(key, (source + ':' + sid).encode(), hashlib.sha256).digest()).decode().rstrip('=')
        if created:
            store.db.execute('UPDATE sessions SET token_hash=? WHERE id=?', (digest(token), sid))
        elif store.db.execute('SELECT token_hash FROM sessions WHERE id=?', (sid,)).fetchone()[0] != digest(token):
            raise ValueError('Integration key changed; invitation cannot be recovered')
        url = 'https://t.me/' + username + '?start=' + token
        if created:
            store.send(owner, 'Интервью для заказа Kwork ' + oid + ': ' + title +
                       '\n\n' + url + '\n\nСсылка действует 7 дней. Профиль появится после начала интервью; PDF только тебе.',
                       [[{'text': 'Открыть интервью', 'callback_data': 'view:' + sid}]])
        return {'sid': sid, 'url': url, 'created': created}
    return store.transaction(action)


def main():
    # Credentials remain inside this helper, never included in stdout/stderr.
    os.umask(0o077)
    root = Path(__file__).resolve().parent.parent
    load_env(root / 'private.env')
    config = Config()
    settings = json.loads((root / 'kwork-bridge.json').read_text())
    if settings.get('enabled') is not True:
        raise ValueError('Integration disabled')
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError('Request too large')
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError('Invalid request')
    store = Store(config.data / 'specbot.sqlite')
    try:
        result = create_invitation(store, request, link_key(config.data), config.owner, settings['bot_username'])
        print(json.dumps(result, ensure_ascii=False))
    finally:
        store.db.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print exception values: they can originate from user content.
        print('Brief bridge failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
