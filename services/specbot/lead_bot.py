"""Separate owner bot for community leads; one poller for its own token only."""
import json
import logging
import os
from pathlib import Path
import signal
import sqlite3
import sys
import threading
import time
from contextlib import contextmanager
import httpx

ROOT=Path.home()/'services/qubite-specbot'
sys.path.insert(0,str(Path.home()/'.hermes/scripts'))
import kwork_leads as ui
import kwork_negotiation as negotiations_ui
from leads import configuration,Leads
from store import Store


class MessageGone(ValueError):pass


class State:
    def __init__(self,path):
        self.path=path
        with self.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL)')
    @contextmanager
    def db(self):
        c=sqlite3.connect(self.path,timeout=5);c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def get(self,k,default=''):
        with self.db() as c:r=c.execute('SELECT v FROM meta WHERE k=?',(k,)).fetchone()
        return r[0] if r else default
    def set(self,k,v):
        with self.db() as c:c.execute('INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',(k,str(v)))


def button(text,data):return {'text':text,'callback_data':data}


class Bot:
    def __init__(self):
        private=json.loads((ROOT/'lead-bot-private.json').read_text())
        self.token=private['token'];self.owner=int(private['owner'])
        self.state=State(Path.home()/'services/kwork-bot/lead-bot.sqlite')
        self.stop=threading.Event()
    def api(self,method,payload,timeout=15):
        # No response bodies or request URLs in logs/raised errors.
        try:
            payload=dict(payload)
            if isinstance(payload.get('text'),str):payload['text']=payload['text'].encode('utf-16-le')[:7600].decode('utf-16-le',errors='ignore')
            r=httpx.post('https://api.telegram.org/bot'+self.token+'/'+method,json=payload,timeout=timeout).json()
        except Exception:raise RuntimeError('Telegram transport unavailable') from None
        if not r.get('ok'):
            desc=r.get('description','')
            if method=='editMessageText' and 'message is not modified' in desc:return {'message_id':payload['message_id']}
            if method=='editMessageText' and ('message to edit not found' in desc or "message can't be edited" in desc):raise MessageGone()
            if method=='deleteMessage' and 'message to delete not found' in desc:return True
            raise RuntimeError('Telegram request rejected')
        return r['result']
    def send(self,text,rows=None):
        p={'chat_id':self.owner,'text':text[:3900]}
        if rows:p['reply_markup']={'inline_keyboard':rows}
        return self.api('sendMessage',p)
    def menu(self):
        self.send('Заявки из Telegram\nПервое время оцениваем и исправляем отклики. «Нормальный заказ → написать» разрешает попытку первого обращения даже при сомнении Jev. Цены и сроки всегда утверждаешь ты.\n\n/leads — заявки и обучение\n/sources — сообщества\n/leadpause — пауза\n/leadtrain — продолжить\n/negotiations — диалоги',[
            [button('Заявки','menu:leads'),button('Источники / настройки','menu:sources')],
            [button('Добавить чат','menu:add'),button('Пауза','menu:pause')],
            [button('Продолжить','menu:train')]])
    def sources(self):
        data=ui.helper(self.state,{'action':'sources','uid':self.owner,'chat':self.owner})
        rows=[[button('Добавить чат','menu:add')]]
        for r in data['sources']:
            rows.append([button((r['title'] or '@'+r['username'])[:40]+(' · включить' if r['status']=='disabled' else ' · отключить'),'source:'+('add' if r['status']=='disabled' else 'off')+':'+r['username'])])
        self.send(data['text'],rows)
    def prompt_source(self):
        p=self.api('sendMessage',{'chat_id':self.owner,'text':'Пришли @username, https://t.me/username или точное название группы. По названию/ID подключаются только группы, где ты уже состоишь. Закрытую ссылку-приглашение пока не принимаю. /cancel — отмена.','reply_markup':{'force_reply':True,'selective':True}})
        self.state.set('add_source_prompt',p['message_id'])
    def source(self,username,op):
        data=ui.helper(self.state,{'action':'source','username':username,'op':op,'uid':self.owner,'chat':self.owner})
        self.send(data['text'])
    def handle(self,u):
        cb=u.get('callback_query');msg=u.get('message',{})
        if cb:
            if cb.get('from',{}).get('id')!=self.owner or cb.get('message',{}).get('chat',{}).get('id')!=self.owner:return
            answer=''
            try:
                data=cb.get('data','')
                if data.startswith('menu:'):
                    op=data.split(':')[1]
                    if op=='sources':self.sources()
                    elif op=='add':self.prompt_source()
                    else:
                        action={'leads':'list','pause':'mode','train':'mode'}[op]
                        result=ui.helper(self.state,{'action':action,'mode':'paused' if op=='pause' else 'training','uid':self.owner,'chat':self.owner});self.send(result['text'])
                elif data.startswith('source:'):
                    _,op,username=data.split(':');self.source(username,op)
                else:
                    answer=ui.callback(self.state,cb,self.owner,self.api)
                    if answer is None:answer=negotiations_ui.callback(self.state,cb,self.owner,self.api)
                    if answer is None:answer='Неизвестная кнопка'
                    if data.startswith('lead:no:') and answer.startswith('Оценка сохранена'):
                        self.api('deleteMessage',{'chat_id':self.owner,'message_id':cb['message']['message_id']})
                    if data.startswith('lead:good:') and answer.startswith('Сохранено'):
                        cfg=configuration();s=Store(Path(cfg['data_dir'])/'specbot.sqlite')
                        try:
                            ident=data.split(':')[2];base=cb['message'].get('text','')
                            s.set_setting('lead.cardtext.'+ident,base)
                            self.api('editMessageText',{'chat_id':self.owner,'message_id':cb['message']['message_id'],'text':base+'\n\n⏳ Отклик в очереди'})
                        finally:s.db.close()
            except Exception:answer='Не удалось обработать кнопку. Проверь актуальную карточку или /sources.'
            try:self.api('answerCallbackQuery',{'callback_query_id':cb['id'],'text':answer[:190]})
            except Exception:pass
            return
        if msg.get('from',{}).get('id')!=self.owner or msg.get('chat',{}).get('id')!=self.owner:return
        text=(msg.get('text') or '').strip()
        if text in ('/start','/help','/menu'):self.menu();return
        if text=='/sources':self.sources();return
        if text=='/addsource':self.prompt_source();return
        if text.startswith('/addsource '):self.source(text.split(maxsplit=1)[1],'add');return
        if text=='/cancel':self.state.set('add_source_prompt','')
        prompt=self.state.get('add_source_prompt')
        if prompt and str(msg.get('reply_to_message',{}).get('message_id'))==prompt:
            self.source(text,'add');self.state.set('add_source_prompt','');return
        if ui.message(self.state,msg,self.owner,self.api):return
        if negotiations_ui.message(self.state,msg,self.owner,self.api):return
        self.send('Открой /menu. Чтобы добавить группу: /addsource @username либо кнопка «Добавить чат».')
    def notices(self):
        cfg=configuration()
        if not cfg:return
        s=Store(Path(cfg['data_dir'])/'specbot.sqlite')
        try:
            Leads(s,cfg)
            for r in list(s.db.execute('SELECT * FROM telegram_leads ORDER BY updated_at DESC LIMIT 100')):
                key='lead.card.'+str(r['id']);mid=s.setting(key)
                if not mid:continue
                active=s.db.execute("SELECT 1 FROM negotiation_proposals WHERE sid=? AND status IN ('draft','approved')",(r['sid'],)).fetchone()
                if r['status']=='rejected' or (r['first_sent'] and not active):
                    self.api('deleteMessage',{'chat_id':self.owner,'message_id':int(mid)})
                    s.set_setting(key,'');continue
                stage={'processing':'⏳ Готовлю отклик','approved':'⏳ Отправляю с личного Telegram','pending':'⏳ Отклик в очереди'}.get(r['status'])
                if r['sid']:
                    n=s.db.execute('SELECT status FROM negotiations WHERE sid=?',(r['sid'],)).fetchone()
                    failed=s.db.execute("SELECT 1 FROM negotiation_personal_outbox WHERE sid=? AND status IN ('failed','uncertain') LIMIT 1",(r['sid'],)).fetchone()
                    if (n and n['status']=='paused') or failed:stage='⚠️ Отправка остановлена. Проверь /negoview '+r['sid']+'. Не повторяю неизвестную отправку.'
                if stage and (r['manual_override'] or r['status']=='approved'):
                    base=s.setting('lead.cardtext.'+str(r['id']))
                    stagekey='lead.cardstage.'+str(r['id'])
                    if base and s.setting(stagekey)!=stage:
                        try:self.api('editMessageText',{'chat_id':self.owner,'message_id':int(mid),'text':base+'\n\n'+stage})
                        except MessageGone:s.set_setting(key,'')
                        s.set_setting(stagekey,stage)
            for r in list(s.db.execute("SELECT * FROM lead_bot_outbox WHERE status='pending' LIMIT 5")):
                self.send(r['text']);s.db.execute("UPDATE lead_bot_outbox SET status='sent' WHERE id=?",(r['id'],))
            for r in list(s.db.execute("SELECT * FROM telegram_leads WHERE status IN ('filtered','failed','expired') ORDER BY created_at DESC LIMIT 20")):
                key='lead.notice.'+str(r['id'])+'.'+r['status']
                if s.setting(key):continue
                base=str(r['id'])+' · '+r['status']+'\n'+r['link']+'\n\n'+r['text'][:2400]+'\n\nЕсли это нормальная заявка — кнопка разрешит попытку отклика. Проверки автора, текста, blacklist и бюджета сохраняются.'
                rows=[
                    [button('Нормальный заказ → написать','lead:good:'+str(r['id'])+':open')],
                    [button('Не заказ','lead:no:'+str(r['id'])+':not_order'),button('Не наша услуга','lead:no:'+str(r['id'])+':not_service')]]
                oldmid=s.setting('lead.card.'+str(r['id']))
                if oldmid:
                    try:sent=self.api('editMessageText',{'chat_id':self.owner,'message_id':int(oldmid),'text':base,'reply_markup':{'inline_keyboard':rows}})
                    except MessageGone:sent=self.send(base,rows)
                else:sent=self.send(base,rows)
                mid=sent['message_id']
                s.set_setting(key,str(mid));s.set_setting('lead.card.'+str(r['id']),str(mid))
                s.set_setting('lead.cardtext.'+str(r['id']),base)
        finally:s.db.close()
    def worker(self):
        while not self.stop.is_set():
            try:
                ui.tick(self.state,self.owner,self.api)
                negotiations_ui.tick(self.state,self.owner,self.api)
                self.notices()
            except Exception as error:logging.warning('Lead worker: %s',type(error).__name__)
            self.stop.wait(2)
    def run(self):
        me=self.api('getMe',{})
        if not self.state.get('welcome'):
            try:self.menu();self.state.set('welcome','1')
            except Exception:pass  # Owner may not have pressed /start yet.
        logging.warning('Lead bot started: @%s',me['username'])
        threading.Thread(target=self.worker,daemon=True,name='lead-controls').start()
        offset=int(self.state.get('offset','0'))
        while not self.stop.is_set():
            try:
                updates=self.api('getUpdates',{'offset':offset,'timeout':15,'allowed_updates':['message','callback_query']},22)
                for u in updates:
                    try:self.handle(u)
                    except Exception as error:
                        logging.warning('Lead update: %s',type(error).__name__)
                        try:self.send('Не удалось обработать запрос. Проверь /menu; данные и отклики сохранены.')
                        except Exception:pass
                    offset=u['update_id']+1;self.state.set('offset',offset)
            except Exception as error:
                logging.warning('Lead polling: %s',type(error).__name__);self.stop.wait(4)


if __name__=='__main__':
    os.umask(0o077)
    bot=Bot()
    signal.signal(signal.SIGTERM,lambda *_:bot.stop.set())
    signal.signal(signal.SIGINT,lambda *_:bot.stop.set())
    bot.run()
