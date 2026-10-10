#!/usr/bin/env python3
"""Private Kwork bot: short callback intake, durable queue, separate draft worker."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import requests
import kwork_negotiation as negotiation_integration
import kwork_brief as brief_integration

ROOT = Path(os.environ.get('KWORK_BOT_ROOT', str(Path.home()/'services/kwork-bot')))


def config():
    return json.loads((ROOT/'private.json').read_text())


def api(method, payload, timeout=35, retries=1):
    cfg=config()
    try:
        r=requests.post('https://api.telegram.org/bot'+cfg['token']+'/'+method,json=payload,timeout=timeout)
        data=r.json()
    except (requests.RequestException,ValueError):
        raise RuntimeError('Telegram network error') from None
    if not data.get('ok'):
        delay=data.get('parameters',{}).get('retry_after')
        if retries>0 and r.status_code==429 and isinstance(delay,int) and 0<delay<=60:
            time.sleep(delay+1)
            return api(method,payload,timeout,retries-1)
        raise RuntimeError('Telegram '+str(data.get('error_code',r.status_code))+': '+str(data.get('description','Request failed'))[:180])
    return data['result']


def keyboard(oid, ready=False):
    rows=[[{'text':'Открыть заказ','url':'https://kwork.ru/projects/'+str(oid)}]]
    if not ready:rows.append([{'text':'Сгенерировать отклик','callback_data':'gen:'+str(oid),'style':'primary'}])
    rows.append([{'text':'👍 Подходит','callback_data':'like:'+str(oid)},{'text':'👎 Не подходит','callback_data':'dislike:'+str(oid)}])
    rows.append([{'text':'Удалить','callback_data':'del:'+str(oid),'style':'danger'}])
    return brief_integration.keyboard({'inline_keyboard':rows},oid,ready,ROOT)


class State:
    def __init__(self,root=ROOT):
        root.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.path=root/'bot.sqlite'
        with self.db() as c:
            c.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, data TEXT NOT NULL, message_id INTEGER, ready INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, oid TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, due REAL NOT NULL DEFAULT 0, UNIQUE(oid,kind));
            CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
            CREATE TABLE IF NOT EXISTS feedback(oid TEXT PRIMARY KEY, rating INTEGER NOT NULL CHECK(rating IN (-1,1)), data TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS feedback_time ON feedback(updated);''')
        os.chmod(self.path,0o600)
        brief_integration.initialize(self)

    def db(self):
        c=sqlite3.connect(self.path,timeout=10);c.row_factory=sqlite3.Row;return c

    def save(self,order):
        oid=str(order['id'])
        if not oid.isdigit():raise ValueError('Invalid order id')
        with self.db() as c:
            c.execute('INSERT INTO orders(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',(oid,json.dumps(order,ensure_ascii=False)))

    def get(self,oid):
        with self.db() as c:
            r=c.execute('SELECT * FROM orders WHERE id=?',(str(oid),)).fetchone()
        return dict(r) if r else None

    def sent(self,oid,message_id,ready):
        with self.db() as c:c.execute('UPDATE orders SET message_id=?,ready=? WHERE id=?',(message_id,int(ready),str(oid)))

    def callback(self,action,oid,message_id):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT * FROM orders WHERE id=? AND message_id=?',(oid,message_id)).fetchone()
            if not r:return 'Карточка недоступна'
            if action in ('like','dislike'):
                if r['deleted']:return 'Объявление уже удалено'
                rating=1 if action=='like' else -1
                c.execute('INSERT INTO feedback(oid,rating,data,created,updated) VALUES (?,?,?,?,?) ON CONFLICT(oid) DO UPDATE SET rating=excluded.rating,data=excluded.data,updated=excluded.updated',(oid,rating,r['data'],time.time(),time.time()))
                return 'Учту: такие заказы подходят' if rating==1 else 'Учту: такие заказы не подходят'
            if action=='del':
                c.execute('UPDATE orders SET deleted=1 WHERE id=?',(oid,))
                c.execute("UPDATE jobs SET status='cancelled' WHERE oid=? AND kind='gen' AND status='pending'",(oid,))
                c.execute("INSERT INTO jobs(oid,kind) VALUES (?,'del') ON CONFLICT(oid,kind) DO UPDATE SET status='pending',due=0",(oid,))
                return 'Удаляем карточку'
            if r['deleted']:return 'Объявление уже удалено'
            if r['ready']:return 'Отклик уже находится в карточке'
            cur=c.execute("INSERT INTO jobs(oid,kind) VALUES (?,'gen') ON CONFLICT(oid,kind) DO UPDATE SET status='pending',attempts=0,due=0 WHERE jobs.status='failed'",(oid,))
            return 'Готовим отклик' if cur.rowcount else 'Отклик уже в очереди'

    def claim(self):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute("SELECT * FROM jobs WHERE status='pending' AND due<=? ORDER BY kind='del' DESC,id LIMIT 1",(time.time(),)).fetchone()
            if not r:return None
            c.execute("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?",(r['id'],))
            return dict(r)

    def finish(self,jid):
        with self.db() as c:c.execute("UPDATE jobs SET status='done' WHERE id=?",(jid,))

    def retry(self,job):
        with self.db() as c:
            c.execute("UPDATE jobs SET status=?,due=? WHERE id=?",('failed' if job['attempts']>=4 else 'pending',time.time()+min(600,30*2**job['attempts']),job['id']))

    def offset(self,value=None):
        with self.db() as c:
            if value is not None:c.execute("INSERT INTO meta VALUES ('offset',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",(str(value),))
            r=c.execute("SELECT v FROM meta WHERE k='offset'").fetchone()
            return int(r[0]) if r else 0


def handle_callback(state,cb,owner):
    negotiation_result=negotiation_integration.callback(state,cb,owner,api)
    if negotiation_result is not None:return negotiation_result
    brief_result=brief_integration.callback(state,cb,owner)
    if brief_result is not None:return brief_result
    if cb.get('from',{}).get('id')!=owner or cb.get('message',{}).get('chat',{}).get('id')!=owner:
        return 'Этот бот доступен только владельцу'
    m=re.fullmatch(r'(gen|del|like|dislike):(\d{1,20})',cb.get('data',''))
    if not m:return 'Неизвестная кнопка'
    return state.callback(m[1],m[2],cb.get('message',{}).get('message_id'))


def poll():
    state=State();owner=int(config()['owner_chat_id'])
    while True:
        try:
            updates=api('getUpdates',{'offset':state.offset(),'timeout':25,'allowed_updates':['callback_query','message']},35)
            for update in updates:
                if 'callback_query' in update:
                    cb=update['callback_query'];text=handle_callback(state,cb,owner)
                    try:api('answerCallbackQuery',{'callback_query_id':cb['id'],'text':text},8)
                    except RuntimeError:pass
                elif update.get('message',{}).get('chat',{}).get('id')==owner:
                    if negotiation_integration.message(state,update['message'],owner,api):
                        state.offset(update['update_id']+1);continue
                    api('sendMessage',{'chat_id':owner,'text':'Здесь будут заказы Kwork. «Удалить» убирает прочитанную карточку; для спорных заказов можно запросить отклик кнопкой. 👍/👎 сохраняют твои предпочтения для следующих подборов; оценку можно изменить.'},10)
                state.offset(update['update_id']+1)
        except Exception as e:
            print('Polling error: '+type(e).__name__,flush=True);time.sleep(3)


def work():
    import kwork_runner as runner
    import kwork_parser as parser
    state=State();owner=int(config()['owner_chat_id'])
    with state.db() as c:c.execute("UPDATE jobs SET status='pending' WHERE status='running'")
    while True:
        negotiation_integration.tick(state,owner,api)
        job=state.claim()
        if not job:time.sleep(.5);continue
        row=state.get(job['oid'])
        try:
            if job['kind']=='del':
                if row and row['message_id']:
                    try:api('deleteMessage',{'chat_id':owner,'message_id':row['message_id']})
                    except RuntimeError as e:
                        if 'message to delete not found' not in str(e):
                            api('editMessageText',{'chat_id':owner,'message_id':row['message_id'],'text':'Просмотрено. Карточка удалена из очереди.','reply_markup':{'inline_keyboard':[]}})
            elif job['kind']=='brief':
                brief_integration.process(state,row,owner,api,runner,parser,keyboard)
            elif row and not row['deleted']:
                order=json.loads(row['data'])
                result=runner.draft(order,parser.env_keys(),parser.DATA/'kwork_drafts')
                current=state.get(job['oid'])
                if current and not current['deleted']:
                    payload=runner.notification(order,result)
                    payload.update(chat_id=owner,message_id=current['message_id'],reply_markup=keyboard(job['oid'],True))
                    try:api('editMessageText',payload)
                    except RuntimeError as e:
                        if 'message is not modified' not in str(e):raise
                    state.sent(job['oid'],current['message_id'],True)
            state.finish(job['id'])
        except Exception as e:
            state.retry(job)
            print('Job failed: '+str(job['id'])+' '+type(e).__name__,flush=True)
            if job['attempts']>=4 and row and not row['deleted']:
                if job['kind']=='brief':
                    try:api('sendMessage',{'chat_id':owner,'text':'Не удалось добавить Brief для заказа '+job['oid']+'. Отклик сохранён. Можно повторить кнопку; платной генерации не было.'})
                    except RuntimeError:pass
                    continue
                try:api('sendMessage',{'chat_id':owner,'text':'Не удалось подготовить отклик для заказа '+job['oid']+'. Заказ сохранён; повторные запросы не отправлялись другому дорогому провайдеру.'})
                except RuntimeError:pass


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['poll','work']);args=p.parse_args()
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (ROOT/(args.mode+'.lock')).open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        (poll if args.mode=='poll' else work)()
