"""Uses only the existing listener's Telethon client, policies and audit notifier."""
import asyncio
from collections import defaultdict, deque
import json
import time
from leads import Leads, configuration, fingerprint
from store import Store

RECENT = defaultdict(lambda: deque(maxlen=5))


def opened():
    cfg=configuration()
    if not cfg:return None,None
    store=Store(__import__('pathlib').Path(cfg['data_dir'])/'specbot.sqlite')
    return store,Leads(store,cfg)


def member(folder, user):
    def ids(peers):return {getattr(p,'user_id',None) for p in peers}
    if user.id in ids(folder.exclude_peers):return False
    if user.id in ids(folder.include_peers):return True
    if user.id in ids(folder.pinned_peers):return True
    return bool(folder.contacts if getattr(user,'contact',False) else folder.non_contacts)


async def setup(client, policy, notify):
    from telethon.tl.functions.messages import GetDialogFiltersRequest
    from telethon.tl.functions.channels import JoinChannelRequest, GetFullChannelRequest
    from telethon.tl.types import DialogFilter
    s,l=opened()
    if not s:return
    try:
        if (await client.get_me()).id != l.c['owner']:raise ValueError('Wrong account')
        money_ref,heart_ref='mbemlin','nexinsight'
        users=[]
        for ref in [money_ref,heart_ref]:
            if not policy(0,ref):raise ValueError('Folder reference blocked')
            user=await client.get_entity(ref)
            if not policy(user.id,getattr(user,'username','')):raise ValueError('Folder reference blocked')
            users.append(user)
        fs=await client(GetDialogFiltersRequest());fs=getattr(fs,'filters',fs)
        fs=[f for f in fs if isinstance(f,DialogFilter)]
        money=[f for f in fs if users[0].id in {getattr(p,'user_id',None) for p in f.include_peers+f.pinned_peers} and not member(f,users[1])]
        heart=[f for f in fs if member(f,users[1]) and not member(f,users[0])]
        if len(money)!=1 or len(heart)!=1:raise ValueError('Ambiguous folders')
        s.set_setting('lead_money_folder',str(money[0].id));s.set_setting('lead_heart_folder',str(heart[0].id))
        if not s.setting('lead_folders_notified'):
            notify('Проверены папки для заказчиков: 💰 ID '+str(money[0].id)+', ❤️ ID '+str(heart[0].id)+'. Определены по @mbemlin и @nexinsight; переписка не читалась, папки пока не менялись.')
            s.set_setting('lead_folders_notified','1')
        for row in list(s.db.execute("SELECT * FROM lead_sources WHERE status='pending'")):
            ref=row['username']
            try:
                if not policy(0,ref):raise ValueError('Source blocked')
                entity=await client.get_entity(ref)
                if not getattr(entity,'megagroup',False):raise ValueError('Not a discussion group')
                from telethon.utils import get_peer_id
                cid=get_peer_id(entity)
                if not policy(cid,ref):raise ValueError('Source blocked')
                await client(JoinChannelRequest(entity))
                full=await client(GetFullChannelRequest(entity))
                about=getattr(full.full_chat,'about','') or ''
                pinned=getattr(full.full_chat,'pinned_msg_id',None)
                if pinned:
                    notify('Прочитаю закреплённые правила сообщества @'+ref+' для подключения поиска заявок.')
                    msg=await client.get_messages(entity,ids=pinned)
                    about+='\n'+(getattr(msg,'raw_text','') or '')[:5000]
                import re
                forbidden=bool(re.search(r'(?i)(запрещ.{0,60}(личк|личные сообщ|лс)|не\s+пиш.{0,50}(личк|личные сообщ|лс))',about))
                s.db.execute("UPDATE lead_sources SET chat_id=?,title=?,rules=?,status='joined',auto_allowed=?,updated_at=? WHERE username=?",(cid,(entity.title or '')[:200],about[:6000],int(not forbidden),time.time(),ref))
                notify('Подключён поиск заявок в @'+ref+('. Автообращения запрещены найденными правилами; только карточки.' if forbidden else '. Пока режим обучения, без автоматических первых сообщений.'))
                await asyncio.sleep(3)
            except Exception as error:
                seconds=getattr(error,'seconds',None)
                status='waiting' if isinstance(seconds,int) else 'unavailable'
                s.db.execute('UPDATE lead_sources SET status=?,updated_at=? WHERE username=?',(status,time.time(),ref))
                notify('Сообщество @'+ref+' не подключено: '+type(error).__name__+'. Ограничения не обхожу.')
                if isinstance(seconds,int):break
    except Exception as error:
        notify('Настройка папок/сообществ отложена: '+type(error).__name__+'. Отправка новым людям закрыта до проверки папок.')
    finally:s.db.close()


async def forward(event, policy):
    if event.out or event.is_private:return False
    s,l=opened()
    if not s:return False
    try:
        source=l.source(event.chat_id)
        if not source or not policy(event.chat_id,source['username']):return False
        # Only new text/captions; do not transcribe all community voice messages.
        if time.time()-event.date.timestamp()>120:return False
        sender=await event.get_sender()
        if not sender or getattr(sender,'bot',False) or not hasattr(sender,'first_name'):return False
        uid=sender.id;username=getattr(sender,'username','') or ''
        if not policy(uid,username):return False
        reply=getattr(event.message,'reply_to',None)
        key=(event.chat_id,getattr(reply,'reply_to_top_id',None) or (getattr(reply,'reply_to_msg_id',None) if getattr(reply,'forum_topic',False) else None))
        context='\n'.join(RECENT[key])
        text=event.raw_text or ''
        accepted=l.capture(event.chat_id,event.id,uid,username,text,context)
        if accepted:
            from tg_common import notify
            await asyncio.to_thread(notify,'Найдена возможная заявка в '+l.source(event.chat_id)['username']+' · сообщение '+str(event.id)+'. Сохранён текст и короткий контекст для отбора; переписка вне выбранных групп не читалась.')
        RECENT[key].append(text[:250])
        return accepted
    finally:s.db.close()


async def source_current(client, store, sid, policy):
    row=store.db.execute('SELECT * FROM telegram_leads WHERE sid=?',(sid,)).fetchone() if store.db.execute("SELECT 1 FROM sqlite_master WHERE name='telegram_leads'").fetchone() else None
    if not row or row['first_sent']:return True
    cfg=configuration()
    if not cfg or not store.setting('lead_money_folder') or not store.setting('lead_heart_folder'):return False
    if time.time()-row['created_at']>7200:return False
    if not policy(row['chat_id'],row['source']) or not policy(row['client'],row['username']):return False
    from tg_common import notify
    await asyncio.to_thread(notify,'Проверю исходную Telegram-заявку перед откликом: '+row['link'])
    msg=await client.get_messages(row['chat_id'],ids=row['message_id'])
    return bool(msg and msg.sender_id==row['client'] and fingerprint(msg.raw_text or '')==row['hash'])


async def folders(client, policy, notify):
    from telethon.tl.functions.messages import GetDialogFiltersRequest, UpdateDialogFilterRequest
    from telethon.tl.types import DialogFilter
    s,l=opened()
    if not s:return
    try:
        if float(s.setting('lead_folder_cooldown','0'))>time.time():return
        row=s.db.execute("SELECT * FROM negotiation_folder_jobs WHERE status='pending' LIMIT 1").fetchone()
        if not row:return
        if not policy(row['client'],row['username']):return
        peer=await client.get_input_entity(row['client'])
        if getattr(peer,'user_id',None)!=row['client']:raise ValueError('Wrong peer')
        for key,include in [('lead_money_folder',True),('lead_heart_folder',False)]:
            fid=int(s.setting(key,'0'))
            filters=await client(GetDialogFiltersRequest());filters=getattr(filters,'filters',filters)
            f=next((f for f in filters if isinstance(f,DialogFilter) and f.id==fid),None)
            if not f:raise ValueError('Folder disappeared')
            uid=row['client']
            if include:
                f.exclude_peers=[p for p in f.exclude_peers if getattr(p,'user_id',None)!=uid]
                if uid not in {getattr(p,'user_id',None) for p in f.include_peers+f.pinned_peers}:f.include_peers.append(peer)
            else:
                f.include_peers=[p for p in f.include_peers if getattr(p,'user_id',None)!=uid]
                f.pinned_peers=[p for p in f.pinned_peers if getattr(p,'user_id',None)!=uid]
                if uid not in {getattr(p,'user_id',None) for p in f.exclude_peers}:f.exclude_peers.append(peer)
            await client(UpdateDialogFilterRequest(id=fid,filter=f))
        s.db.execute("UPDATE negotiation_folder_jobs SET status='done',updated_at=? WHERE client=?",(time.time(),row['client']))
        s.db.execute('UPDATE telegram_leads SET folder_done=1 WHERE client=?',(row['client'],))
        notify('Заказчик ID '+str(row['client'])+' добавлен в 💰 и исключён из ❤️. Переписка сохранена.')
    except Exception as error:
        if s and not s.setting('lead_folder_error'):
            s.set_setting('lead_folder_error',type(error).__name__)
            notify('Не удалось обновить папки заказчика: '+type(error).__name__+'. Сообщение повторно не отправляю.')
        seconds=getattr(error,'seconds',None)
        s.set_setting('lead_folder_cooldown',str(time.time()+(seconds+5 if isinstance(seconds,int) else 300)))
    finally:s.db.close()
