"""Opt-in account history and an atomic cost ledger."""
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path


class LimitError(Exception):
    pass


def day():
    return datetime.now(timezone.utc).date().isoformat()


class Store:
    def __init__(self, root, budget=0.05):
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
        self.path = root / 'search.sqlite'
        self.budget = budget
        self.policies = {}
        with self.connect() as c:
            c.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, day TEXT, user TEXT, kind TEXT, reserved REAL, cost REAL, created REAL);
            CREATE TABLE IF NOT EXISTS attempts(user TEXT, day TEXT, created REAL);
            CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, user TEXT, title TEXT, created REAL, updated REAL);
            CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, conversation TEXT, user TEXT, query TEXT, result TEXT, created REAL);
            CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation, id);
            CREATE INDEX IF NOT EXISTS attempt_day ON attempts(user, day);
            CREATE TABLE IF NOT EXISTS encrypted_history(id TEXT PRIMARY KEY, user TEXT NOT NULL, ciphertext TEXT NOT NULL, updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS history_salts(user TEXT PRIMARY KEY, salt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS answer_preferences(user TEXT PRIMARY KEY,verify_enabled INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL,updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS history_preferences(user TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS search_events(id TEXT PRIMARY KEY,user TEXT NOT NULL,query TEXT NOT NULL,results TEXT NOT NULL,created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS search_events_user_time ON search_events(user,created);
            CREATE TABLE IF NOT EXISTS browser_sessions(token_hash TEXT PRIMARY KEY, user TEXT NOT NULL, expires REAL NOT NULL, created REAL NOT NULL);
            ''')
            columns = {row[1] for row in c.execute('PRAGMA table_info(ledger)')}
            for name, default in [('model','legacy/unknown'), ('provider',''), ('status','legacy')]:
                if name not in columns:
                    c.execute(f"ALTER TABLE ledger ADD COLUMN {name} TEXT NOT NULL DEFAULT '{default}'")
            c.execute('CREATE INDEX IF NOT EXISTS ledger_user_day ON ledger(user,day)')
        os.chmod(self.path, 0o600)

    def connect(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def create_browser_session(self,user,ttl=2592000):
        import secrets,hashlib
        token=secrets.token_urlsafe(32)
        now=time.time()
        with self.connect() as c:
            c.execute('DELETE FROM browser_sessions WHERE expires<?',(now,))
            c.execute('INSERT INTO browser_sessions VALUES (?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user,now+ttl,now))
        return token

    def browser_session_user(self,token):
        import hashlib
        if not token or len(token)>150:return None
        with self.connect() as c:
            row=c.execute('SELECT user FROM browser_sessions WHERE token_hash=? AND expires>?',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
        return row['user'] if row else None

    def revoke_browser_session(self,token):
        import hashlib
        with self.connect() as c:c.execute('DELETE FROM browser_sessions WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))

    def reserve(self, user, kind, amount):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            used = c.execute('SELECT COALESCE(SUM(reserved+cost),0) FROM ledger WHERE day=?', (day(),)).fetchone()[0]
            if amount>0 and used + amount > self.budget + 1e-9:
                raise LimitError('Дневной бюджет ИИ закончился. Обычный поиск продолжает работать.')
            policy=self.policies.get(user,{})
            for key,where,args in [('daily_usd','day=?',[day()]),('monthly_usd','substr(day,1,7)=?',[day()[:7]]),('lifetime_usd','1=1',[])]:
                limit=policy.get(key)
                if amount>0 and limit is not None:
                    total=c.execute('SELECT COALESCE(SUM(reserved+cost),0) FROM ledger WHERE user=? AND '+where,[user]+args).fetchone()[0]
                    if total+amount>limit+1e-9:raise LimitError('Твой лимит расходов на ИИ исчерпан. Обычный поиск доступен.')
            key = uuid.uuid4().hex
            c.execute('INSERT INTO ledger(id,day,user,kind,reserved,cost,created) VALUES (?,?,?,?,?,?,?)', (key, day(), user, kind, amount, 0, time.time()))
            return key

    def settle(self, key, actual, status='success', provider=''):
        # Unknown cost after a connection loss stays reserved; never assume it was free.
        if actual is not None:
            with self.connect() as c:
                c.execute('UPDATE ledger SET reserved=0,cost=?,status=?,provider=? WHERE id=?', (max(0, actual), status, provider[:100], key))

    def annotate(self, key, model):
        with self.connect() as c:
            c.execute("UPDATE ledger SET model=?,status='pending' WHERE id=?", (str(model)[:150], key))

    def analytics(self, days=30, user=None):
        days = max(1, min(90, int(days)))
        start = (datetime.now(timezone.utc).date()-timedelta(days=days-1)).isoformat()
        where = 'day>=?'; args = [start]
        if user:
            where += ' AND user=?'; args.append(user)
        fields = "COUNT(*) AS calls, SUM(status='success') AS successful, SUM(status='error') AS failed, SUM(status='pending') AS pending, COALESCE(SUM(cost),0) AS cost_usd, COALESCE(SUM(reserved),0) AS reserved_usd"
        with self.connect() as c:
            total = dict(c.execute('SELECT '+fields+' FROM ledger WHERE '+where, args).fetchone())
            today = dict(c.execute('SELECT '+fields+' FROM ledger WHERE '+where+' AND day=?', args+[day()]).fetchone())
            daily = [dict(r) for r in c.execute('SELECT day,'+fields+' FROM ledger WHERE '+where+' GROUP BY day ORDER BY day', args)]
            users = [dict(r) for r in c.execute('SELECT user,'+fields+' FROM ledger WHERE '+where+' GROUP BY user ORDER BY cost_usd DESC', args)]
            models = [dict(r) for r in c.execute('SELECT model,provider,'+fields+' FROM ledger WHERE '+where+' GROUP BY model,provider ORDER BY cost_usd DESC', args)]
            by_user_model = [dict(r) for r in c.execute('SELECT user,model,provider,'+fields+' FROM ledger WHERE '+where+' GROUP BY user,model,provider ORDER BY cost_usd DESC', args)]
        return {'timezone':'UTC','days':days,'from':start,'today':today,'totals':total,'daily':daily,'users':users,'models':models,'user_models':by_user_model,'selected_user':user}

    def usage(self):
        with self.connect() as c:
            r = c.execute('SELECT COALESCE(SUM(cost),0), COALESCE(SUM(reserved),0) FROM ledger WHERE day=?', (day(),)).fetchone()
        return {'spent': r[0], 'reserved': r[1], 'limit': self.budget, 'remaining': max(0, self.budget - sum(r))}

    def claim_guest(self, user, daily=10, hourly=3):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            n = c.execute('SELECT COUNT(*) FROM attempts WHERE user=? AND day=?', (user, day())).fetchone()[0]
            h = c.execute('SELECT COUNT(*) FROM attempts WHERE user=? AND created>?', (user, time.time()-3600)).fetchone()[0]
            if (daily is not None and n >= daily) or (hourly is not None and h >= hourly):
                raise LimitError('Лимит гостевого ИИ: не более %s запросов в день и %s в час. Поиск остаётся доступен.' % (daily if daily is not None else 'без лимита', hourly if hourly is not None else 'без лимита'))
            c.execute('INSERT INTO attempts VALUES (?,?,?)', (user, day(), time.time()))
            c.execute('DELETE FROM attempts WHERE created<?', (time.time()-172800,))

    def guest_remaining(self, user, daily):
        if daily is None:return None
        with self.connect() as c:
            n = c.execute('SELECT COUNT(*) FROM attempts WHERE user=? AND day=?', (user, day())).fetchone()[0]
        return max(0, daily-n)

    def context(self, cid, user):
        if not cid:
            return []
        with self.connect() as c:
            row = c.execute('SELECT user FROM conversations WHERE id=?', (cid,)).fetchone()
            if row is None or row['user'] != user:
                raise PermissionError('Разговор недоступен.')
            rows = c.execute('SELECT query,result FROM messages WHERE conversation=? ORDER BY id DESC LIMIT 4', (cid,)).fetchall()
        return [{'query': r['query'], 'answer': json.loads(r['result']).get('answer_markdown', '')[:5000]} for r in reversed(rows)]

    def save(self, cid, user, query, result):
        if cid:
            self.context(cid, user)
        else:
            cid = uuid.uuid4().hex
        now = time.time()
        with self.connect() as c:
            c.execute('INSERT OR IGNORE INTO conversations VALUES (?,?,?,?,?)', (cid, user, query[:90], now, now))
            c.execute('INSERT INTO messages(conversation,user,query,result,created) VALUES (?,?,?,?,?)', (cid, user, query, json.dumps(result, ensure_ascii=False), now))
            c.execute('UPDATE conversations SET updated=? WHERE id=?', (now, cid))
        return cid

    def history(self, user):
        with self.connect() as c:
            return [dict(r) for r in c.execute('SELECT id,title,updated FROM conversations WHERE user=? ORDER BY updated DESC LIMIT 60', (user,))]

    def conversation(self, cid, user):
        self.context(cid, user)
        with self.connect() as c:
            return [{'query': r['query'], 'result': json.loads(r['result'])} for r in c.execute('SELECT query,result FROM messages WHERE conversation=? AND user=? ORDER BY id LIMIT 100', (cid, user))]

    def delete_history(self, user):
        with self.connect() as c:
            c.execute('DELETE FROM messages WHERE user=?', (user,))
            c.execute('DELETE FROM conversations WHERE user=?', (user,))

    def encrypted_list(self,user):
        with self.connect() as c:
            return [dict(r) for r in c.execute('SELECT id,ciphertext,updated FROM encrypted_history WHERE user=? ORDER BY updated DESC LIMIT 100',(user,))]

    def encrypted_put(self,user,cid,text):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT user FROM encrypted_history WHERE id=?',(cid,)).fetchone()
            if r and r['user']!=user:raise PermissionError()
            count=c.execute('SELECT COUNT(*) FROM encrypted_history WHERE user=?',(user,)).fetchone()[0]
            if not r and count>=100:raise LimitError('Не более 100 сохранённых разговоров. Удали старые.')
            c.execute('INSERT INTO encrypted_history VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,updated=excluded.updated',(cid,user,text,time.time()))

    def encrypted_delete(self,user,cid=None):
        with self.connect() as c:
            if cid:c.execute('DELETE FROM encrypted_history WHERE user=? AND id=?',(user,cid))
            else:c.execute('DELETE FROM encrypted_history WHERE user=?',(user,))

    def history_salt(self,user):
        import secrets
        with self.connect() as c:
            c.execute('INSERT OR IGNORE INTO history_salts VALUES (?,?)',(user,secrets.token_hex(16)))
            return c.execute('SELECT salt FROM history_salts WHERE user=?',(user,)).fetchone()[0]


    def verification_enabled(self,user):
        with self.connect() as c:
            row=c.execute('SELECT verify_enabled FROM answer_preferences WHERE user=?',(user,)).fetchone()
        return bool(row[0]) if row else True

    def set_verification_enabled(self,user,enabled):
        with self.connect() as c:
            c.execute('INSERT INTO answer_preferences VALUES (?,?,?,?) ON CONFLICT(user) DO UPDATE SET verify_enabled=excluded.verify_enabled,updated=excluded.updated',(user,int(enabled),time.time(),time.time()))

    def history_enabled(self,user):
        with self.connect() as c:
            row=c.execute('SELECT enabled FROM history_preferences WHERE user=?',(user,)).fetchone()
        return bool(row and row[0])

    def set_history_enabled(self,user,enabled):
        with self.connect() as c:c.execute('INSERT INTO history_preferences VALUES (?,?,?) ON CONFLICT(user) DO UPDATE SET enabled=excluded.enabled,updated=excluded.updated',(user,int(enabled),time.time()))

    def put_chat(self,user,cid,title,turns):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT user FROM conversations WHERE id=?',(cid,)).fetchone()
            if row and row[0]!=user:raise PermissionError('Разговор недоступен.')
            if not row and c.execute('SELECT COUNT(*) FROM conversations WHERE user=?',(user,)).fetchone()[0]>=100:raise LimitError('Не более 100 чатов. Удали старые.')
            now=time.time()
            c.execute('INSERT OR IGNORE INTO conversations VALUES (?,?,?,?,?)',(cid,user,title[:120],now,now))
            c.execute('UPDATE conversations SET title=?,updated=? WHERE id=? AND user=?',(title[:120],now,cid,user))
            c.execute('DELETE FROM messages WHERE conversation=? AND user=?',(cid,user))
            for turn in turns[-100:]:c.execute('INSERT INTO messages(conversation,user,query,result,created) VALUES (?,?,?,?,?)',(cid,user,turn['query'],json.dumps(turn['result'],ensure_ascii=False),now))

    def delete_chat(self,user,cid):
        with self.connect() as c:
            c.execute('DELETE FROM messages WHERE user=? AND conversation=?',(user,cid))
            c.execute('DELETE FROM conversations WHERE user=? AND id=?',(user,cid))

    def record_search(self,user,search):
        if not self.history_enabled(user):return
        with self.connect() as c:
            c.execute('INSERT OR REPLACE INTO search_events VALUES (?,?,?,?,?)',(search['id'],user,search['query'],json.dumps(search['results'][:8],ensure_ascii=False),time.time()))
            c.execute('DELETE FROM search_events WHERE user=? AND id NOT IN (SELECT id FROM search_events WHERE user=? ORDER BY created DESC LIMIT 1000)',(user,user))

    def search_history(self,user,limit=30):
        with self.connect() as c:return [dict(row,id='search-'+row['id']) for row in c.execute('SELECT id,query,created FROM search_events WHERE user=? ORDER BY created DESC LIMIT ?',(user,limit))]

    def search_context(self,user,event_id):
        with self.connect() as c:row=c.execute('SELECT query,results FROM search_events WHERE id=? AND user=?',(event_id,user)).fetchone()
        if not row:raise PermissionError('Поиск недоступен.')
        items=json.loads(row['results'])
        return [{'query':row['query'],'answer':'\n'.join(x['title']+': '+x.get('content','')+' ('+x['url']+')' for x in items[:4])[:3000]}]

    def clear_search_history(self,user):
        with self.connect() as c:c.execute('DELETE FROM search_events WHERE user=?',(user,))
