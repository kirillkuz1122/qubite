"""Private owner-managed bot; invitation-bound clients, independent durable worker."""
import asyncio
import contextlib
import json
import logging
import os
from pathlib import Path
import re
import signal
import time
import httpx
from ai import AI, ModelError
from config import Config, load_env
from document import exports
from store import Store, PRESETS, dumps

log=logging.getLogger('specbot')
HELP='''Qubite Brief — твой помощник по сбору ТЗ.

Создай приглашение → отправь ссылку клиенту → наблюдай интервью → получи PDF.

/new — создать приглашение
/sessions — интервью и кнопки управления
/test — пройти тестовое интервью самому
/stoptest — закончить тестовый режим
/presets — шаблоны и промпты
/prompt разработка текст — изменить промпт шаблона
/budget — расходы и дневной бюджет
/budget 0.05 — задать дневной потолок в долларах

Команды для конкретного интервью (ID виден в карточке):
/view ID — переписка и сводка
/take ID — ручной перехват
/say ID текст — отправить клиенту вручную
/steer ID текст — одноразовая подсказка следующему вопросу
/focus ID текст — постоянный фокус конкретного интервью
/resume ID — вернуть ИИ
/export ID — PDF, Markdown и исходный JSON
/revoke ID — закрыть приглашение и остановить интервью
/delete ID — удалить интервью и файлы

ИИ: Haiku 5.5, Anthropic → Google. Клиенты без приглашения не допускаются.
В PDF предположения и открытые вопросы отделены от требований.'''
ALIAS={'разработка':'development','дизайн':'design','маркетинг':'marketing','общий':'general',**{k:k for k in PRESETS}}
def button(text,data):return {'text':text,'callback_data':data}
def controls(sid):
    return [[button('Переписка','view:'+sid),button('Сводка','state:'+sid)],
            [button('Перехватить','take:'+sid),button('Вернуть ИИ','resume:'+sid)],
            [button('Написать клиенту','say:'+sid),button('Следующий вопрос','steer:'+sid)],
            [button('Фокус интервью','focus:'+sid)],
            [button('Собрать ТЗ','finish:'+sid),button('Файлы','export:'+sid)],
            [button('Закрыть ссылку','revoke:'+sid),button('Удалить','deleteask:'+sid)]]
def client_identity(s):
    if not s['client']:return 'Клиент ещё не вошёл'
    text=s.get('client_name') or 'Клиент'
    if s.get('client_username'):text+=' · @'+s['client_username']
    return text+' · ID '+str(s['client'])
def profile_button(s):
    if not s['client']:return []
    url='https://t.me/'+s['client_username'] if s.get('client_username') else 'tg://user?id='+str(s['client'])
    return [[{'text':'Открыть профиль клиента','url':url}]]

def client_keys(sid,ready=False):
    return [[button('Завершить интервью','finish:'+sid),button('Пауза','pause:'+sid)]] if ready else [[button('Готово, собрать ТЗ','finish:'+sid),button('Пауза','pause:'+sid)]]

class Telegram:
    def __init__(self,token):
        self.base='https://api.telegram.org/bot'+token+'/'
        self.filebase='https://api.telegram.org/file/bot'+token+'/'
        self.client=httpx.AsyncClient(timeout=35)
    async def call(self,method,payload=None,timeout=35):
        r=await self.client.post(self.base+method,json=payload or {},timeout=timeout)
        if r.status_code!=200: raise RuntimeError('Telegram HTTP '+str(r.status_code))
        data=r.json()
        if not data.get('ok'):raise RuntimeError('Telegram rejected request')
        return data.get('result')
    async def document(self,payload):
        path=Path(payload['path'])
        with path.open('rb') as f:
            r=await self.client.post(self.base+'sendDocument',data={'chat_id':str(payload['chat_id']),'caption':payload.get('caption','')},files={'document':(path.name,f)},timeout=60)
        if r.status_code!=200 or not r.json().get('ok'):raise RuntimeError('Telegram document delivery failed')
    async def close(self):await self.client.aclose()

class Bot:
    def __init__(self,c,s,tg,ai=None):
        self.c=c;self.s=s;self.tg=tg;self.ai=ai or AI(c,s)
        self.username='';self.stop=asyncio.Event()

    def chunks(self,chat,text):
        # Split on paragraph boundaries when possible; preserve complete transcript.
        while len(text)>3900:
            end=text.rfind('\n',0,3900)
            if end<1000:end=3900
            self.s.send(chat,text[:end]);text=text[end:].lstrip('\n')
        if text:self.s.send(chat,text)

    def card(self,sid):
        s=self.s.get(sid)
        text=s['title']+'\nID интервью: '+sid+' · '+s['status']+' · ответов: '+str(s['turns'])+'\n'+client_identity(s)
        if s['focus']:text+='\nФокус: '+s['focus'][:500]
        if s['steering']:text+='\nСледующий вопрос: '+s['steering'][:500]
        self.s.send(self.c.owner,text,profile_button(s)+controls(sid))

    def wizard(self,action,sid='',preset='',title=''):
        ticket=os.urandom(6).hex()
        self.s.set_setting('wizard',dumps({'action':action,'sid':sid,'preset':preset,'title':title[:150],'ticket':ticket,'expires':time.time()+600}))
        if action=='newfocus':
            self.s.send(self.c.owner,'Что тебе как исполнителю важно выяснить для проекта «'+title[:150]+'»?\n'
                'Например: какой результат нужен, источники данных, интеграции, бюджет и ограничения.\n'
                'Это постоянный фокус только этого интервью, до 5000 символов. Не передаётся клиенту как отдельное сообщение. Можно пропустить или /cancel.',
                [[button('Пропустить','newskip:'+ticket)]])
            return
        self.s.out(self.c.owner,'sendMessage',{'chat_id':self.c.owner,'text':{
            'new':'Напиши название проекта для приглашения. Можно /cancel.',
            'say':'Напиши сообщение клиенту. Можно /cancel.',
            'steer':'Что уточнить в следующем ещё не запущенном вопросе? Подсказка одноразовая, до 2000 символов. При ошибке сохранится для повтора. /clear — снять, /cancel — отменить.',
            'focus':'Постоянный фокус этого интервью: что важно выяснить? До 5000 символов. /clear — убрать фокус, /cancel — отменить.',
            'prompt':'Пришли новый промпт шаблона. Он применяется к новым интервью. Можно /cancel.'}[action],
            'reply_markup':{'force_reply':True,'selective':True}})

    def current(self,uid):
        sid=self.s.setting('active.'+str(uid))
        if not sid:raise ValueError('Открой приглашение или выбери интервью командой /sessions.')
        s=self.authorize(sid,uid)
        if s['client']!=uid:raise ValueError('Это интервью принадлежит другому клиенту.')
        return s

    def create(self,title,preset,focus=''):
        sid,token=self.s.create(title,preset,focus)
        self.s.send(self.c.owner,'Приглашение: '+title+'\n\nhttps://t.me/'+self.username+'?start='+token+
                    '\n\nСсылка действует 7 дней и закрепляется за первым клиентом. Его ответы будут доступны тебе. PDF получишь только ты.',controls(sid))

    def accepted(self,sid,text):
        s=self.s.get(sid)
        if s['status'] not in ('active','manual'):raise ValueError('Интервью на паузе или завершено. Используй кнопки управления.')
        if s['turns']>=40:raise ValueError('Достигнут предел интервью. Нажми «Завершить».')
        if len(text)>6000:raise ValueError('Ответ слишком длинный: до 6000 символов за раз.')
        if s['status']=='active' and self.s.db.execute("SELECT 1 FROM jobs WHERE session=? AND status IN ('pending','running')",(sid,)).fetchone():
            raise ValueError('Ещё обрабатываю предыдущий ответ. Дождись следующего вопроса.')
        self.s.add_message(sid,'client',text)
        self.s.update(sid,turns=s['turns']+1)
        if s['client']!=self.c.owner:self.chunks(self.c.owner,client_identity(s)+' · '+s['title']+' ['+sid+']\n'+text)
        if s['status']=='active':
            self.s.enqueue(sid,'interview')
            self.s.send(s['client'],'Ответ сохранён. Готовлю следующий вопрос.')

    def authorize(self,sid,uid):
        s=self.s.get(sid)
        if uid!=self.c.owner and self.s.is_lead(sid):raise ValueError('Для интервью открой отдельное приглашение Brief.')
        if uid!=self.c.owner and s['client']!=uid:raise ValueError('Нет доступа к этому интервью.')
        return s

    def finish(self,sid,uid):
        s=self.authorize(sid,uid)
        if s['status'] in ('invite','consent','revoked'):raise ValueError('Интервью ещё не начато или закрыто.')
        if s['status']=='done':
            self.s.send(uid,'Интервью завершено. Для дополнений напиши владельцу.');return
        if self.s.db.execute("SELECT 1 FROM jobs WHERE session=? AND status IN ('pending','running')",(sid,)).fetchone():raise ValueError('Дождись обработки последнего ответа.')
        # Summarize a manual conversation before final, preserving fresh statements.
        if s['status']=='manual':
            self.s.update(sid,status='active')
            self.s.enqueue(sid,'interview',{'then_final':True})
        else:self.s.enqueue(sid,'final')
        self.s.send(uid,'Собираю черновик ТЗ. Неизвестные детали останутся открытыми вопросами.')

    def admin_action(self,action,sid,uid):
        if uid!=self.c.owner:raise ValueError('Управление доступно только владельцу.')
        s=self.s.get(sid)
        if action=='view':
            text='Переписка · '+s['title']+' ['+sid+']\n\n'+'\n\n'.join(m['role']+': '+m['text'] for m in self.s.messages(sid))
            self.chunks(uid,text);self.card(sid)
        elif action=='state':
            self.chunks(uid,'Текущая сводка · '+s['title']+'\n'+json.dumps(s['state'],ensure_ascii=False,indent=2));self.card(sid)
        elif action=='take':
            if s['status'] in ('invite','consent','revoked','done'):raise ValueError('Перехват доступен во время интервью.')
            self.s.mode(sid,'manual');self.s.send(uid,'ИИ приостановлен. Отправляй реплики кнопкой «Написать клиенту».')
            self.s.send(s['client'],'К интервью подключился владелец проекта. Можно продолжать отвечать здесь.')
        elif action=='resume':
            if s['status']=='revoked':raise ValueError('Отозванное интервью нельзя открыть заново.')
            if not s['client'] or s['status']=='consent':raise ValueError('Дождись начала интервью клиентом.')
            self.s.mode(sid,'active');self.s.enqueue(sid,'interview');self.s.send(uid,'ИИ продолжит интервью с сохранёнными ответами.')
        elif action in ('say','steer','focus'):self.wizard(action,sid)
        elif action=='revoke':
            self.s.mode(sid,'revoked');self.s.update(sid,token_hash=None)
            self.s.send(uid,'Приглашение закрыто, интервью остановлено.')
            if s['client']:self.s.send(s['client'],'Владелец закрыл интервью. Ответы сохранены у него.')
        elif action=='export':
            if not s['document']:raise ValueError('Документ ещё не собран.')
            for suffix in ('.pdf','.md','.json'):
                self.s.out(uid,'document',{'chat_id':uid,'path':s['document']+suffix,'caption':s['title']})
        elif action=='deleteask':
            self.s.send(uid,'Удалить переписку и файлы «'+s['title']+'»? Это необратимо.',[[button('Да, удалить','delete:'+sid),button('Отмена','view:'+sid)]])
        elif action=='delete':
            # Running jobs will see a missing session and discard their results.
            self.s.db.execute('DELETE FROM sessions WHERE id=?',(sid,))
            for p in (self.c.data/'documents').glob(sid+'-v*.*'):p.unlink(missing_ok=True)
            self.s.send(uid,'Интервью и файлы удалены.')
        else:raise ValueError('Неизвестное действие.')

    def owner_message(self,text):
        cmd,*rest=text.split(maxsplit=1);arg=rest[0] if rest else ''
        cmd=cmd.split('@')[0].lower()
        if cmd in ('/start','/help'):self.s.send(self.c.owner,HELP,[[button('Новое приглашение','new'),button('Интервью','sessions')],[button('Промпты','presets'),button('Расходы','budget')],[button('Пройти тест самому','test')]])
        elif cmd=='/test':
            sid,token=self.s.create('Проверка бота владельцем','development')
            self.s.claim(token,self.c.owner);self.s.update(sid,status='active')
            self.s.set_setting('active.'+str(self.c.owner),sid)
            self.s.set_setting('wizard','');self.s.enqueue(sid,'interview')
            self.s.send(self.c.owner,'Тестовое интервью начато. Отвечай как клиент. Управление остаётся доступно командами. /stoptest — выйти.')
        elif cmd=='/stoptest':
            sid=self.s.setting('active.'+str(self.c.owner))
            if sid:
                self.s.mode(sid,'paused');self.s.set_setting('active.'+str(self.c.owner),'')
            self.s.send(self.c.owner,'Тестовый режим закрыт. /new — приглашение настоящему клиенту.')
        elif cmd=='/cancel':self.s.set_setting('wizard','');self.s.send(self.c.owner,'Отменено.')
        elif cmd=='/new':
            if arg:
                parts=arg.split(maxsplit=1)
                if parts[0].lower() in ALIAS and len(parts)==2:self.wizard('newfocus',preset=ALIAS[parts[0].lower()],title=parts[1])
                else:self.wizard('newfocus',preset='development',title=arg)
            else:self.s.send(self.c.owner,'Выбери шаблон интервью:',[[button(title,'new:'+key)] for key,(title,_) in PRESETS.items()])
        elif cmd=='/sessions':
            rows=self.s.listing()
            if not rows:self.s.send(self.c.owner,'Пока нет интервью. Нажми /new.')
            for s in rows[:30]:self.card(s['id'])
        elif cmd=='/presets':
            self.s.send(self.c.owner,'Шаблоны интервью. Нажми, чтобы прочитать и изменить промпт.',[[button(title,'preset:'+key)] for key,(title,_) in PRESETS.items()])
        elif cmd=='/prompt':
            parts=arg.split(maxsplit=1)
            if len(parts)!=2 or parts[0].lower() not in ALIAS:raise ValueError('Формат: /prompt разработка новый промпт')
            if len(parts[1])>5000:raise ValueError('Промпт: до 5000 символов.')
            self.s.set_setting('prompt.'+ALIAS[parts[0].lower()],parts[1]);self.s.send(self.c.owner,'Промпт обновлён для новых интервью.')
        elif cmd=='/budget':
            if arg:
                try:value=float(arg.replace(',','.'))
                except ValueError:raise ValueError('Пример: /budget 0.05') from None
                if not .001<=value<=10:raise ValueError('Бюджет: от $0.001 до $10.')
                self.s.set_setting('daily_budget',str(value))
            stats=self.s.stats();self.s.send(self.c.owner,'Сегодня: $'+format(stats['today_usd'],'.6f')+' / $'+self.s.setting('daily_budget',str(self.c.daily))+'\nВсего: $'+format(stats['total_usd'],'.6f')+'\nИнтервью: '+str(stats['sessions'])+' · задач в очереди: '+str(stats['jobs'])+'\nДень бюджета — UTC. Неопределённые после таймаута расходы учитываются с запасом.\nМеняет лимит только бота; потолок ключа OpenRouter остаётся отдельным.')
        elif cmd=='/clear':
            try:w=json.loads(self.s.setting('wizard','{}'))
            except ValueError:w={}
            if w.get('action') not in ('focus','steer') or w.get('expires',0)<time.time():raise ValueError('Сначала открой «Фокус интервью» или «Следующий вопрос».')
            self.owner_text(w['action'],w['sid'],'');self.s.set_setting('wizard','')
        elif cmd in ('/view','/take','/resume','/say','/steer','/focus','/export','/revoke','/delete','/finish'):
            parts=arg.split(maxsplit=1)
            if not parts:raise ValueError('Укажи ID интервью из /sessions.')
            sid=parts[0];s=self.s.get(sid)
            if cmd in ('/say','/steer','/focus') and len(parts)==2:self.owner_text(cmd[1:],sid,parts[1])
            elif cmd=='/finish':self.finish(sid,self.c.owner)
            elif cmd=='/delete':self.admin_action('deleteask',sid,self.c.owner)
            else:self.admin_action(cmd[1:],sid,self.c.owner)
        elif text.startswith('/'):
            raise ValueError('Неизвестная команда. Используй /help.')
        else:
            try:w=json.loads(self.s.setting('wizard','{}'))
            except ValueError:w={}
            if w.get('expires',0)<time.time():
                sid=self.s.setting('active.'+str(self.c.owner))
                if sid:
                    self.accepted(sid,text);return
                raise ValueError('Выбери действие через /new или /sessions.')
            if len(text)>5000:raise ValueError('Текст слишком длинный: до 5000 символов.')
            if w['action']=='new':
                self.wizard('newfocus',preset=w['preset'],title=text);return
            elif w['action']=='newfocus':self.create(w['title'],w['preset'],text)
            elif w['action']=='prompt':
                self.s.set_setting('prompt.'+w['preset'],text);self.s.send(self.c.owner,'Промпт обновлён для новых интервью.')
            else:self.owner_text(w['action'],w['sid'],text)
            self.s.set_setting('wizard','')

    def owner_text(self,action,sid,text):
        s=self.s.get(sid)
        if action=='say':
            if not s['client'] or s['status'] in ('revoked','invite','consent','done'):raise ValueError('Интервью не активно.')
            # Explicit owner text switches to manual mode; a late AI result is discarded.
            if s['status']!='manual':self.s.mode(sid,'manual')
            self.s.add_message(sid,'owner',text);self.chunks(s['client'],text)
            self.s.send(self.c.owner,'Сообщение поставлено в очередь доставки. ИИ на паузе.')
        elif action=='steer':
            if len(text)>2000:raise ValueError('Подсказка: до 2000 символов.')
            self.s.update(sid,steering=text);self.s.send(self.c.owner,'Одноразовая подсказка сохранена для следующего ещё не запущенного вопроса.' if text else 'Одноразовая подсказка снята.')
        elif action=='focus':
            if len(text)>5000:raise ValueError('Фокус: до 5000 символов.')
            self.s.update(sid,focus=text);self.s.send(self.c.owner,'Постоянный фокус интервью обновлён.' if text else 'Постоянный фокус интервью снят.')

    async def handle(self,u):
        cb=u.get('callback_query');m=u.get('message')
        if cb:
            uid=cb['from']['id'];chat=cb.get('message',{}).get('chat',{})
            if chat.get('type')!='private' or chat.get('id')!=uid:return
            text=cb.get('data','')
            try:
                if uid==self.c.owner and text in ('new','sessions','presets','budget','test'):self.owner_message('/'+text);return
                action,_,sid=text.partition(':')
                if uid==self.c.owner and action=='newskip':
                    try:w=json.loads(self.s.setting('wizard','{}'))
                    except ValueError:w={}
                    if w.get('action')!='newfocus' or w.get('ticket')!=sid or w.get('expires',0)<time.time():raise ValueError('Этот шаг уже завершён или истёк. Начни заново через /new.')
                    self.create(w['title'],w['preset']);self.s.set_setting('wizard','');return
                if uid==self.c.owner and action in ('new','preset','editprompt'):
                    if sid not in PRESETS:raise ValueError('Неизвестный шаблон.')
                    if action=='new':self.wizard('new',preset=sid)
                    elif action=='editprompt':self.wizard('prompt',preset=sid)
                    else:self.s.send(uid,PRESETS[sid][0]+'\n\n'+self.s.setting('prompt.'+sid),[[button('Изменить','editprompt:'+sid)]])
                    return
                if action=='retryjob':
                    if not sid.isdigit():raise ValueError('Недоступный повтор.')
                    job=self.s.db.execute("SELECT * FROM jobs WHERE id=? AND status='failed'",(int(sid),)).fetchone()
                    if not job:raise ValueError('Задача уже обработана или не найдена.')
                    s=self.authorize(job['session'],uid)
                    if s['status'] not in ('active','manual'):raise ValueError('Интервью не активно.')
                    self.s.enqueue(s['id'],job['kind'],json.loads(job['payload']))
                    self.s.db.execute("UPDATE jobs SET status='retried' WHERE id=?",(int(sid),))
                    self.s.send(uid,'Повтор поставлен в очередь.');return
                s=self.authorize(sid,uid)
                if uid==s['client']:self.s.profile(sid,cb['from']);s=self.s.get(sid)
                if action=='consent':
                    if uid!=s['client'] or s['status']!='consent':raise ValueError('Интервью уже начато или закрыто.')
                    self.s.update(sid,status='active');self.s.add_message(sid,'client','Согласен на интервью и передачу ответов владельцу проекта.')
                    self.s.enqueue(sid,'interview');self.s.send(uid,'Начинаем. Можно отвечать текстом или голосом, а при необходимости сделать паузу.')
                elif action=='finish':self.finish(sid,uid)
                elif action=='pause':
                    if uid!=s['client'] or s['status'] not in ('active','manual'):raise ValueError('Пауза сейчас недоступна.')
                    self.s.set_setting('pause_mode.'+sid,s['status'])
                    self.s.mode(sid,'paused');self.s.send(uid,'Интервью сохранено.',[[button('Продолжить','continue:'+sid)]])
                elif action=='continue':
                    if uid!=s['client'] or s['status']!='paused':raise ValueError('Интервью не на паузе.')
                    mode=self.s.setting('pause_mode.'+sid,'active')
                    self.s.mode(sid,mode if mode=='manual' else 'active')
                    if mode=='manual':self.s.send(uid,'Продолжаем разговор с владельцем проекта.')
                    else:self.s.enqueue(sid,'interview')
                elif action=='select':
                    if uid!=s['client']:raise ValueError('Нет доступа.')
                    self.s.set_setting('active.'+str(uid),sid)
                    self.s.send(uid,'Выбрано интервью «'+s['title']+'».',[[button('Продолжить','continue:'+sid)]] if s['status']=='paused' else client_keys(sid))
                elif action=='retry':
                    if s['status']!='active':raise ValueError('Интервью на паузе или закрыто.')
                    self.s.enqueue(sid,'interview');self.s.send(uid,'Повтор поставлен в очередь.')
                elif action=='approve':
                    if s['status']!='review':raise ValueError('Черновик ещё не готов.')
                    self.s.mode(sid,'done');self.deliver(sid)
                elif action=='correct':
                    if s['status']!='review':raise ValueError('Черновик ещё не готов.')
                    self.s.mode(sid,'active');self.s.send(uid,'Напиши, что нужно исправить или дополнить. Потом снова нажми «Завершить».')
                else:self.admin_action(action,sid,uid)
            except ValueError as e:self.s.send(uid,str(e))
            return
        if not m or m.get('chat',{}).get('type')!='private':return
        uid=m['from']['id']
        if m['chat']['id']!=uid:return
        text=str(m.get('text') or '')
        try:
            if uid==self.c.owner:
                if text:self.owner_message(text);return
                if not self.s.setting('active.'+str(uid)):
                    raise ValueError('В управлении используй текст. Для голосового теста сначала /test.')
            if text.startswith('/start '):
                token=text.split(maxsplit=1)[1]
                if not re.fullmatch(r'[A-Za-z0-9_-]{25,50}',token):raise ValueError('Нужна личная ссылка приглашения от владельца.')
                sid=self.s.claim(token,uid);self.s.profile(sid,m['from']);s=self.s.get(sid);self.s.set_setting('active.'+str(uid),sid)
                if not self.s.setting('joined.'+sid):
                    self.s.set_setting('joined.'+sid,'1')
                    self.s.send(self.c.owner,'По приглашению вошёл '+client_identity(s)+'\nПроект: '+s['title'],profile_button(s)+controls(sid))
                if s['status']=='consent':
                    from negotiation import personal_contact_notice
                    self.s.send(uid,'Интервью для проекта «'+s['title']+'».\n\nБот уточнит задачу и передаст ответы владельцу проекта. Ответы обрабатывает ИИ через OpenRouter; итоговый PDF получает владелец. Не присылай пароли или секреты. Можно сделать паузу и вернуться.'+personal_contact_notice(self.s,sid)+'\n\nНачать?',[[button('Начать интервью','consent:'+sid)]])
                else:self.s.send(uid,'Интервью «'+s['title']+'» · '+s['status'],client_keys(sid))
                return
            if text in ('/start','/help'):
                self.s.send(uid,'Это личный помощник по сбору ТЗ. Открой приглашение от владельца проекта. Для начатого интервью: /sessions, /finish, /pause, /continue.');return
            if text=='/sessions':
                for row in self.s.listing(uid):self.s.send(uid,row['title']+' · '+row['status'],[[button('Открыть','select:'+row['id'])]])
                return
            s=self.current(uid);sid=s['id'];self.s.profile(sid,m['from']);s=self.s.get(sid)
            if text=='/finish':self.finish(sid,uid);return
            if text in ('/pause','/continue'):
                return await self.handle({'callback_query':{'id':'local','from':{'id':uid},'message':{'chat':{'id':uid,'type':'private'}},'data':text[1:]+':'+sid}})
            audio=m.get('voice') or m.get('video_note') or m.get('audio')
            if audio:
                if s['status'] not in ('active','manual'):raise ValueError('Интервью не активно.')
                if not self.c.stt_python or not self.c.stt_script:raise ValueError('Голосовые пока не настроены. Ответь текстом.')
                if audio.get('duration',0)>300 or audio.get('file_size',0)>12_000_000:raise ValueError('Голосовое: до 5 минут и 12 МБ.')
                if self.s.db.execute("SELECT 1 FROM jobs WHERE session=? AND status IN ('pending','running')",(sid,)).fetchone():raise ValueError('Дождись обработки предыдущего ответа.')
                self.s.enqueue(sid,'voice',{'file_id':audio['file_id']});self.s.send(uid,'Голосовое сохранено. Расшифрую через Hermes и продолжу интервью.')
                return
            if not text:raise ValueError('Ответь текстом или голосовым. Референсы можно прислать ссылкой.')
            if text.startswith('/'):raise ValueError('Неизвестная команда. Используй /help.')
            self.accepted(sid,text)
        except ValueError as e:self.s.send(uid,str(e))

    def deliver(self,sid):
        s=self.s.get(sid)
        self.s.send(self.c.owner,'Готово ТЗ · '+s['title']+' ['+sid+']\n\nКлиент подтвердил черновик. Перед договором проверь открытые вопросы и предположения.',controls(sid))
        for suffix in ('.pdf','.md'):
            self.s.out(self.c.owner,'document',{'chat_id':self.c.owner,'path':s['document']+suffix,'caption':s['title']})
        if s['client']:
            self.s.send(s['client'],'Спасибо! Интервью завершено, ТЗ передано владельцу проекта.')
            if self.c.send_client:self.s.out(s['client'],'document',{'chat_id':s['client'],'path':s['document']+'.pdf','caption':s['title']})

    async def transcription(self,payload):
        # Pi's memory cgroup is disabled: systemd MemoryMax alone is insufficient.
        try:
            mem={k:int(v.split()[0]) for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())}
            if mem.get('MemAvailable',0)<600*1024:raise ValueError('Сейчас мало свободной памяти для голосового. Ответь текстом или повтори позже.')
        except OSError:pass
        file=await self.tg.call('getFile',{'file_id':payload['file_id']})
        if file.get('file_size',0)>12_000_000:raise ValueError('Файл слишком большой.')
        tmp=self.c.data/'audio';tmp.mkdir(mode=0o700,exist_ok=True)
        import secrets
        path=tmp/(secrets.token_hex(8)+'.audio')
        try:
            async with self.tg.client.stream('GET',self.tg.filebase+file['file_path'],timeout=60) as r:
                if r.status_code!=200:raise ValueError('Не удалось загрузить голосовое.')
                size=0
                with path.open('wb') as f:
                    os.chmod(path,0o600)
                    async for part in r.aiter_bytes():
                        size+=len(part)
                        if size>12_000_000:raise ValueError('Файл слишком большой.')
                        f.write(part)
            proc=await asyncio.create_subprocess_exec(self.c.stt_python,self.c.stt_script,str(path),
                stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,start_new_session=True)
            try:out,_=await asyncio.wait_for(proc.communicate(),timeout=600)
            except (asyncio.TimeoutError,asyncio.CancelledError):
                with contextlib.suppress(ProcessLookupError):os.killpg(proc.pid,signal.SIGKILL)
                await proc.wait();raise
            try:data=json.loads(out.decode().strip().splitlines()[-1])
            except Exception:raise ValueError('Hermes не вернул транскрипцию. Можно ответить текстом.') from None
            if not data.get('success') or not str(data.get('transcript','')).strip():raise ValueError('Не удалось разобрать голосовое. Можно ответить текстом.')
            return str(data['transcript']).strip()[:6000]
        finally:path.unlink(missing_ok=True)

    async def work(self,job):
        sid=job['session'];s=self.s.get(sid)
        if s['revision']!=job['revision'] or s['status'] not in ('active','manual'):
            self.s.db.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(job['id'],));return
        payload=json.loads(job['payload'])
        if job['kind']=='voice':
            text=await self.transcription(payload)
            s=self.s.get(sid)
            if s['revision']!=job['revision'] and s['status']!='manual':return
            # Release voice slot before enqueuing the next interview step.
            self.s.db.execute("UPDATE jobs SET status='done' WHERE id=?",(job['id'],))
            self.chunks(s['client'],'Распознал: '+text)
            self.accepted(sid,text);return
        if s['status']=='manual':return
        if payload.get('then_final'):s={**s,'steering':''}
        result,provider=await self.ai.generate(s,final=job['kind']=='final')
        current=self.s.get(sid)
        if current['revision']!=job['revision'] or current['status']!='active':return
        cursor=result.pop('_cursor',0)
        if job['kind']=='interview':
            def commit_question():
                self.s.set_setting('cursor.'+sid,str(cursor))
                self.s.update(sid,state=result['state'])
                self.s.db.execute("UPDATE jobs SET status='done' WHERE id=?",(job['id'],))
                if payload.get('then_final'):
                    self.s.enqueue(sid,'final');return
                if s['steering']:self.s.consume_steering(sid,s['steering_version'])
                self.s.add_message(sid,'assistant',result['message'])
                self.s.send(s['client'],result['message']+'\n\nУточнено примерно '+str(round(result['progress']))+'%.',client_keys(sid,result['ready']),session=sid,revision=job['revision'])
                if s['client']!=self.c.owner:self.s.send(self.c.owner,'ИИ → клиент · '+s['title']+' ['+sid+']\n'+result['message']+'\nМаршрут: '+provider,controls(sid))
            # A crash cannot consume a one-shot instruction without preserving
            # the generated question and its durable delivery in the same commit.
            self.s.transaction(commit_question)
        else:
            version=self.s.db.execute("SELECT COUNT(*) FROM jobs WHERE session=? AND kind='final' AND status='done'",(sid,)).fetchone()[0]+1
            stem=await asyncio.to_thread(exports,self.c.data/'documents',sid,s['title'],result,version)
            try:current=self.s.get(sid)
            except ValueError:current={}
            if current.get('revision')!=job['revision'] or current.get('status')!='active':
                for suffix in ('.pdf','.md','.json'):Path(stem+suffix).unlink(missing_ok=True)
                return
            self.s.update(sid,document=stem,status='review')
            summary=result['summary']+'\n\n'+'\n\n'.join(section['title']+'\n'+'\n'.join('• '+x for x in section['items']) for section in result['sections'])+'\n\nКритерии приёмки:\n'+'\n'.join('• '+x for x in result['acceptance'][:8])
            summary+='\n\nОткрытые вопросы:\n'+'\n'.join('• '+x for x in result['open_questions'][:8])
            self.chunks(s['client'],'Проверь итог интервью:\n\n'+summary)
            self.s.send(s['client'],'Всё верно или нужно дополнить?',[[button('Всё верно','approve:'+sid),button('Добавить/исправить','correct:'+sid)]])
            self.s.send(self.c.owner,'Черновик ТЗ готов · '+s['title']+' ['+sid+']. Клиенту предложено проверить сводку. PDF доступен уже сейчас.',controls(sid))
            self.s.out(self.c.owner,'document',{'chat_id':self.c.owner,'path':stem+'.pdf','caption':'Черновик · '+s['title']})

    async def worker(self):
        while not self.stop.is_set():
            row=self.s.db.execute("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT 1").fetchone()
            if not row:await asyncio.sleep(.4);continue
            job=dict(row);self.s.db.execute("UPDATE jobs SET status='running' WHERE id=?",(job['id'],))
            try:
                await self.work(job)
                self.s.db.execute("UPDATE jobs SET status='done' WHERE id=? AND status='running'",(job['id'],))
            except asyncio.CancelledError:raise
            except Exception as e:
                self.s.db.execute("UPDATE jobs SET status='failed' WHERE id=?",(job['id'],))
                log.warning('Job %s failed: %s',job['id'],type(e).__name__)
                try:
                    s=self.s.get(job['session'])
                    text=str(e) if isinstance(e,(ValueError,ModelError)) else 'Обработка не завершена. Ответ сохранён.'
                    self.s.send(self.c.owner,'Интервью '+s['title']+' ['+s['id']+']: '+text,[[button('Повторить обработку','retryjob:'+str(job['id']))]]+controls(s['id']))
                    if s['client'] and s['status']=='active':self.s.send(s['client'],text,[[button('Повторить обработку','retryjob:'+str(job['id'])),button('Завершить','finish:'+s['id'])]])
                except ValueError:pass

    async def sender(self):
        while not self.stop.is_set():
            row=self.s.db.execute("SELECT * FROM outbox WHERE status='pending' AND next_try<=? ORDER BY id LIMIT 1",(time.time(),)).fetchone()
            if not row:await asyncio.sleep(.25);continue
            item=dict(row);self.s.db.execute("UPDATE outbox SET status='running' WHERE id=?",(item['id'],))
            try:
                p=json.loads(item['payload'])
                sid=p.pop('_session',None);revision=p.pop('_revision',None)
                if sid:
                    try:current=self.s.get(sid)
                    except ValueError:current={}
                    if current.get('revision')!=revision:
                        self.s.db.execute("UPDATE outbox SET status='cancelled',payload='{}' WHERE id=?",(item['id'],));continue
                if item['method']=='document':
                    if not Path(p['path']).is_file():raise FileNotFoundError()
                    await self.tg.document(p)
                else:await self.tg.call(item['method'],p)
                self.s.db.execute("UPDATE outbox SET status='sent',payload='{}' WHERE id=?",(item['id'],))
                await asyncio.sleep(.07)
            except asyncio.CancelledError:raise
            except Exception as e:
                attempts=item['attempts']+1
                terminal=attempts>=8 or isinstance(e,FileNotFoundError)
                self.s.db.execute('UPDATE outbox SET status=?,attempts=?,next_try=? WHERE id=?',('failed' if terminal else 'pending',attempts,time.time()+min(300,2**attempts),item['id']))
                log.warning('Delivery %s: %s (%s)',item['id'],type(e).__name__,attempts)

    async def polling(self):
        offset=int(self.s.setting('offset','0'))
        while not self.stop.is_set():
            try:
                updates=await self.tg.call('getUpdates',{'offset':offset,'timeout':25,'allowed_updates':['message','callback_query']},timeout=32)
                for u in updates:
                    if self.s.db.execute('SELECT 1 FROM updates WHERE id=?',(u['update_id'],)).fetchone():
                        offset=max(offset,u['update_id']+1);continue
                    # ACK outside DB transaction: routing below has no network IO.
                    if u.get('callback_query'):
                        try:await self.tg.call('answerCallbackQuery',{'callback_query_id':u['callback_query']['id']})
                        except Exception:pass
                    # Transaction across fast routing only; no AI/file IO here.
                    self.s.db.execute('BEGIN IMMEDIATE')
                    try:
                        await self.handle(u)
                        self.s.db.execute('INSERT INTO updates VALUES(?,?)',(u['update_id'],time.time()))
                        offset=u['update_id']+1;self.s.set_setting('offset',str(offset));self.s.db.execute('COMMIT')
                    except BaseException:
                        self.s.db.execute('ROLLBACK');raise
            except asyncio.CancelledError:raise
            except Exception as e:
                log.warning('Polling: %s',type(e).__name__);await asyncio.sleep(4)

    async def run(self):
        me=await self.tg.call('getMe');self.username=me['username']
        webhook=await self.tg.call('getWebhookInfo')
        if webhook.get('url'):raise RuntimeError('A webhook is set; refusing concurrent delivery')
        for sid in self.s.recover():
            with contextlib.suppress(ValueError):self.s.send(self.c.owner,'После перезапуска задача '+sid+' требует ручного повтора.',controls(sid))
        try:
            await self.tg.call('setMyCommands',{'commands':[{'command':'start','description':'Меню'},{'command':'new','description':'Новое приглашение'},{'command':'sessions','description':'Интервью'},{'command':'presets','description':'Промпты и шаблоны'},{'command':'budget','description':'Расходы'},{'command':'help','description':'Инструкция'}], 'scope':{'type':'chat','chat_id':self.c.owner}})
        except RuntimeError:
            log.warning('Owner command menu not ready; owner must /start first')
        self.s.send(self.c.owner,'Qubite Brief запущен. /new — приглашение клиенту, /help — все возможности. Бюджет $'+self.s.setting('daily_budget',str(self.c.daily))+' в день.')
        tasks=[asyncio.create_task(f()) for f in (self.polling,self.worker,self.sender)]
        try:await self.stop.wait()
        finally:
            for task in tasks:task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
            await self.tg.close();await self.ai.client.aclose()

async def main():
    env=os.environ.get('SPECBOT_ENV')
    if env:load_env(env)
    c=Config()
    if not c.token or not c.key:raise RuntimeError('Missing required private configuration')
    c.data.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(c.data,0o700)
    # One polling instance, including accidental manual startup.
    import fcntl
    with (c.data/'bot.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        s=Store(c.data/'specbot.sqlite');bot=Bot(c,s,Telegram(c.token))
        for sig in (signal.SIGTERM,signal.SIGINT):asyncio.get_running_loop().add_signal_handler(sig,bot.stop.set)
        await bot.run()

if __name__=='__main__':
    logging.basicConfig(level=logging.WARNING,format='%(asctime)s %(name)s %(levelname)s %(message)s')
    logging.getLogger('httpx').setLevel(logging.CRITICAL)
    asyncio.run(main())
