"""One-process SQLite state; durable jobs and outbox, no secrets in the database."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone

PRESETS = {
    'development': ('Разработка', 'Выясни пользователей, сценарии, функции, платформы, интеграции, данные, права, безопасность, ограничения и критерии приёмки.'),
    'design': ('Дизайн', 'Выясни аудиторию, бренд, носители, визуальные предпочтения, референсы, размеры, исходники, права и критерии приёмки.'),
    'marketing': ('Маркетинг', 'Выясни продукт, аудиторию, географию, каналы, KPI, бюджет, материалы, аналитику, ограничения и согласования.'),
    'general': ('Любой проект', 'Выясни цель, проблему, аудиторию, результат, объём, ограничения, бюджет, сроки и критерии приёмки.'),
}
def dumps(x): return json.dumps(x, ensure_ascii=False)
def digest(x): return hashlib.sha256(x.encode()).hexdigest()

class Store:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path.parent, 0o700)
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,preset TEXT NOT NULL,prompt TEXT NOT NULL,
        token_hash TEXT UNIQUE,expires REAL NOT NULL,client INTEGER,status TEXT NOT NULL DEFAULT 'invite',
        revision INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT '{}',steering TEXT NOT NULL DEFAULT '',
        created REAL NOT NULL,updated REAL NOT NULL,turns INTEGER NOT NULL DEFAULT 0,document TEXT);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,session TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,text TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,session TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,chat INTEGER NOT NULL,method TEXT NOT NULL,payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_try REAL NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY,session TEXT,
        day TEXT NOT NULL,cost REAL NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status,id);
        CREATE INDEX IF NOT EXISTS messages_session ON messages(session,id);
        ''')
        columns={r['name'] for r in self.db.execute('PRAGMA table_info(sessions)')}
        for name in ('client_name','client_username'):
            if name not in columns:self.db.execute('ALTER TABLE sessions ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''")
        if 'focus' not in columns:self.db.execute("ALTER TABLE sessions ADD COLUMN focus TEXT NOT NULL DEFAULT ''")
        if 'steering_version' not in columns:self.db.execute('ALTER TABLE sessions ADD COLUMN steering_version INTEGER NOT NULL DEFAULT 0')
        # Monetary accounting survives deletion of interview content.
        if self.db.execute('PRAGMA foreign_key_list(usage)').fetchone():
            self.db.executescript("""BEGIN IMMEDIATE;
            CREATE TABLE usage_v2(id INTEGER PRIMARY KEY,session TEXT,day TEXT NOT NULL,cost REAL NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,created REAL NOT NULL);
            INSERT INTO usage_v2 SELECT * FROM usage;
            DROP TABLE usage;
            ALTER TABLE usage_v2 RENAME TO usage;
            COMMIT;""")
        self.db.execute('CREATE INDEX IF NOT EXISTS usage_day ON usage(day)')
        self.db.execute('CREATE INDEX IF NOT EXISTS usage_session ON usage(session)')
        os.chmod(path, 0o600)
        for key, (title, prompt) in PRESETS.items():
            self.db.execute('INSERT OR IGNORE INTO settings VALUES(?,?)', ('prompt.'+key, prompt))

    def transaction(self, fn):
        if self.db.in_transaction: return fn()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            out = fn(); self.db.execute('COMMIT'); return out
        except BaseException:
            self.db.execute('ROLLBACK'); raise

    def get(self, sid):
        row = self.db.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if not row: raise ValueError('Интервью не найдено.')
        d = dict(row); d['state'] = json.loads(d['state']); d.pop('token_hash', None)
        return d

    def listing(self, client=None):
        q = 'SELECT id,title,preset,status,client,turns,created,updated FROM sessions '
        rows = self.db.execute(q + ('WHERE client=? ' if client else '') + 'ORDER BY updated DESC LIMIT 100', (client,) if client else ())
        return [dict(r) for r in rows]

    def setting(self, key, default=''):
        row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return row['value'] if row else default

    def set_setting(self, key, value):
        self.db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))

    def create(self, title, preset='development', focus=''):
        if preset not in PRESETS: raise ValueError('Неизвестный шаблон.')
        token = secrets.token_urlsafe(24); sid = secrets.token_hex(6); now=time.time()
        if not isinstance(focus,str) or len(focus)>5000:raise ValueError('Фокус интервью: до 5000 символов.')
        self.db.execute('INSERT INTO sessions(id,title,preset,prompt,focus,token_hash,expires,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
                        (sid, title[:150], preset, self.setting('prompt.'+preset), focus, digest(token), now+7*86400, now, now))
        return sid, token

    def claim(self, token, uid):
        def action():
            row = self.db.execute('SELECT * FROM sessions WHERE token_hash=?', (digest(token),)).fetchone()
            if not row or row['expires'] < time.time() or row['status']=='revoked': raise ValueError('Ссылка истекла или отозвана.')
            if row['client'] is not None and row['client'] != uid: raise ValueError('Ссылка уже закреплена за другим клиентом.')
            self.db.execute("UPDATE sessions SET client=?,status=CASE WHEN status='invite' THEN 'consent' ELSE status END,updated=? WHERE id=?", (uid,time.time(),row['id']))
            return row['id']
        return self.transaction(action)

    def profile(self, sid, user):
        s=self.get(sid)
        if s['client']!=user.get('id'):raise ValueError('Нет доступа к профилю клиента.')
        name=' '.join(str(user.get(k) or '') for k in ('first_name','last_name')).strip()
        name=''.join(ch for ch in name if ch.isprintable())[:150]
        username=str(user.get('username') or '')
        if not re.fullmatch(r'[A-Za-z0-9_]{1,32}',username):username=''
        self.db.execute('UPDATE sessions SET client_name=?,client_username=? WHERE id=?',(name,username,sid))

    def messages(self, sid, limit=300):
        return [dict(r) for r in self.db.execute('SELECT * FROM (SELECT id,role,text,created FROM messages WHERE session=? ORDER BY id DESC LIMIT ?) ORDER BY id', (sid,limit))]

    def context(self, sid):
        cursor=int(self.setting('cursor.'+sid,'0'))
        recent=[dict(r) for r in self.db.execute('SELECT id,role,text FROM (SELECT id,role,text FROM messages WHERE session=? AND id<=? ORDER BY id DESC LIMIT 3) ORDER BY id',(sid,cursor))]
        fresh=[dict(r) for r in self.db.execute('SELECT id,role,text FROM messages WHERE session=? AND id>? ORDER BY id',(sid,cursor))]
        return recent+fresh, max([cursor]+[r['id'] for r in fresh])

    def recent_questions(self,sid):
        # Small question-only reminder, not another copy of the entire dialogue.
        rows=list(self.db.execute("SELECT text FROM messages WHERE session=? AND role='assistant' ORDER BY id DESC LIMIT 8",(sid,)))
        questions=[]
        for row in reversed(rows):
            questions.extend(x.strip()[:350] for x in re.findall(r'[^.!?\n]*\?',row['text']) if x.strip())
        return questions[-12:]

    def add_message(self, sid, role, text):
        self.db.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(sid,role,text,time.time()))

    def send(self, chat, text, keyboard=None, session=None, revision=None):
        payload={'chat_id':chat,'text':text[:4000]}
        if keyboard: payload['reply_markup']={'inline_keyboard':keyboard}
        if session: payload.update(_session=session,_revision=revision)
        self.out(chat, 'sendMessage', payload)

    def out(self, chat, method, payload):
        self.db.execute('INSERT INTO outbox(chat,method,payload) VALUES(?,?,?)', (chat,method,dumps(payload)))

    def enqueue(self, sid, kind, payload=None):
        s=self.get(sid)
        if self.db.execute("SELECT COUNT(*) FROM jobs WHERE session=? AND status IN ('pending','running')",(sid,)).fetchone()[0]>=2:
            raise ValueError('Уже обрабатываю ответ. Дождись следующего вопроса.')
        self.db.execute('INSERT INTO jobs(session,kind,payload,revision,created) VALUES(?,?,?,?,?)',(sid,kind,dumps(payload or {}),s['revision'],time.time()))

    def update(self, sid, **fields):
        allowed={'status','revision','state','steering','focus','turns','document','token_hash'}
        if set(fields)-allowed: raise ValueError('Invalid fields')
        if 'state' in fields: fields['state']=dumps(fields['state'])
        fields['updated']=time.time()
        assignments=[k+'=?' for k in fields]
        if 'steering' in fields:assignments.append('steering_version=steering_version+1')
        self.db.execute('UPDATE sessions SET '+','.join(assignments)+' WHERE id=?',(*fields.values(),sid))

    def consume_steering(self,sid,version):
        # A new owner instruction, even with identical text, belongs to the next
        # question and must not be cleared by an earlier in-flight request.
        self.db.execute("UPDATE sessions SET steering='',updated=? WHERE id=? AND steering_version=?",(time.time(),sid,version))

    def mode(self, sid, status):
        s=self.get(sid)
        self.update(sid,status=status,revision=s['revision']+1)
        self.db.execute("UPDATE jobs SET status='cancelled' WHERE session=? AND status='pending'",(sid,))

    def reserve(self, sid, ceiling, provider, daily, per_session):
        def action():
            day=datetime.now(timezone.utc).date().isoformat()
            d=self.db.execute('SELECT COALESCE(SUM(cost),0) FROM usage WHERE day=?',(day,)).fetchone()[0]
            s=self.db.execute('SELECT COALESCE(SUM(cost),0) FROM usage WHERE session=?',(sid,)).fetchone()[0]
            if d+ceiling>daily+1e-10 or s+ceiling>per_session+1e-10: raise ValueError('Лимит расходов исчерпан. Владелец может изменить бюджет.')
            return self.db.execute('INSERT INTO usage(session,day,cost,provider,status,created) VALUES(?,?,?,?,?,?)',(sid,day,ceiling,provider,'reserved',time.time())).lastrowid
        return self.transaction(action)

    def settle(self, id, cost, status):
        self.db.execute('UPDATE usage SET cost=?,status=? WHERE id=?',(cost,status,id))

    def stats(self):
        day=datetime.now(timezone.utc).date().isoformat()
        return {'today_usd':self.db.execute('SELECT COALESCE(SUM(cost),0) FROM usage WHERE day=?',(day,)).fetchone()[0],
                'total_usd':self.db.execute('SELECT COALESCE(SUM(cost),0) FROM usage').fetchone()[0],
                'sessions':self.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],
                'jobs':self.db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('pending','running')").fetchone()[0]}

    def recover(self):
        # Unknown outcome: do not automatically repeat potentially billed AI calls.
        rows=self.db.execute("SELECT session FROM jobs WHERE status='running'").fetchall()
        self.db.execute("UPDATE jobs SET status='failed' WHERE status='running'")
        self.db.execute("UPDATE outbox SET status='pending' WHERE status='running'")
        return {r['session'] for r in rows}
