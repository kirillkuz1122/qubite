"""Plugin for the existing Telethon listener; never creates a second Telegram session."""
import asyncio
import json
from pathlib import Path
import time
import logging
from negotiation import Negotiations
from store import Store

ROOT = Path.home() / 'services/qubite-specbot'


def configuration():
    try:
        cfg = json.loads((ROOT / 'negotiation-config.json').read_text())
    except (OSError, ValueError): return None
    return cfg if cfg.get('enabled') is True else None


def open_store(cfg):
    s = Store(Path(cfg['data_dir']) / 'specbot.sqlite')
    return s, Negotiations(s, int(cfg['owner']), cfg['profile_url'])


async def forward_event(event, policy, text=None):
    """policy(uid, username) must reuse the host listener's hard block-list."""
    cfg = configuration()
    if not cfg or not event.is_private or event.out: return False
    uid = event.sender_id
    if not isinstance(uid, int) or uid <= 0 or uid == cfg['owner']: return False
    s, n = open_store(cfg)
    try:
        if not s.db.execute("SELECT 1 FROM negotiations WHERE client=? AND status='active'", (uid,)).fetchone(): return False
        conversation=s.db.execute("SELECT sid FROM negotiations WHERE client=? AND status='active'",(uid,)).fetchone()
        lead=n.lead(conversation['sid'])
        if lead and not lead['first_sent']:return False
        sender = await event.get_sender()
        if getattr(sender, 'bot', False) or sender.id != uid or not policy(uid, getattr(sender, 'username', '') or ''): return False
        return n.receive(uid, event.id, text if text is not None else (event.raw_text or ''))
    finally: s.db.close()


async def send_one(client, policy):
    cfg = configuration()
    if not cfg: return False
    s, n = open_store(cfg)
    try:
        if float(s.setting('negotiation_transport_cooldown', '0')) > time.time(): return False
        candidate = n.dispatchable()
        if not candidate: return False
        me = await client.get_me()
        if me.id != int(cfg['owner']): raise ValueError('Wrong personal Telegram account')
        item, conversation = candidate; uid = conversation['client']; username = conversation['username']
        if n.lead(conversation['sid']):
            from leads_personal import source_current
            if not await source_current(client,s,conversation['sid'],policy):
                n.pause(conversation['sid'],'Исходная Telegram-заявка удалена/изменена/устарела или папки не определены. Старый отклик не отправлен.')
                return False
        if not policy(uid, username):
            n.pause(conversation['sid'], 'Чат заблокирован политикой личного Telegram')
            return False
        try:
            try: peer = await client.get_input_entity(uid)
            except (ValueError, TypeError):
                if not username: raise ValueError('Client has no resolvable personal Telegram peer')
                entity = await client.get_entity(username)
                if entity.id != uid or getattr(entity, 'bot', False): raise ValueError('Username changed owner or points to bot')
                peer = await client.get_input_entity(entity)
            if getattr(peer, 'user_id', None) != uid: raise ValueError('Peer ID mismatch')
        except Exception:
            s.db.execute("UPDATE negotiation_personal_outbox SET status='failed' WHERE id=?", (item['id'],))
            n.pause(conversation['sid'], 'Не удалось безопасно адресовать личный чат. Нужен ручной контакт с клиентом; отправка другому username запрещена.')
            return False
        # Check again after asynchronous entity resolution; stale approval must not be sent.
        current = n.dispatchable()
        if not current or current[0]['id'] != item['id'] or not policy(uid, username): return False
        from telethon.tl.functions.messages import SendMessageRequest
        s.db.execute("UPDATE negotiation_personal_outbox SET status='sending',sending_started=? WHERE id=? AND status='pending'", (time.time(),item['id']))
        try:
            result = await client(SendMessageRequest(peer=peer, message=item['text'], random_id=item['random_id'], no_webpage=True))
            mid = getattr(result, 'id', None)
            for update in getattr(result, 'updates', []):
                if getattr(update, 'random_id', None) == item['random_id']: mid = getattr(update, 'id', mid)
                msg = getattr(update, 'message', None)
                if msg and getattr(getattr(msg, 'peer_id', None), 'user_id', None) == uid: mid = msg.id
            if not isinstance(mid, int): raise ValueError('No verified sent message ID')
            s.db.execute("UPDATE negotiation_personal_outbox SET status='pending' WHERE id=?", (item['id'],))
            n.delivered(item['id'], mid)
            return True
        except Exception as e:
            seconds = getattr(e, 'seconds', None)
            if type(e).__name__ == 'PeerFloodError':
                s.set_setting('lead_mode','paused')
                s.set_setting('negotiation_transport_cooldown',str(time.time()+86400))
                s.db.execute("UPDATE negotiation_personal_outbox SET status='failed' WHERE id=?",(item['id'],))
                n.pause(conversation['sid'],'Telegram сообщил об ограничении новых личных сообщений. Поиск/отправки приостановлены; аккаунты и прокси не меняю.')
                return False
            if isinstance(seconds, int) and seconds > 0:
                s.set_setting('negotiation_transport_cooldown', str(time.time() + seconds + 5))
                s.db.execute("UPDATE negotiation_personal_outbox SET status='pending' WHERE id=?", (item['id'],))
                n.owner_notice(conversation['sid'], 'Telegram ограничил отправку. Соблюдаю паузу; аккаунты/прокси не переключаю.')
            else:
                s.db.execute("UPDATE negotiation_personal_outbox SET status='uncertain' WHERE id=?", (item['id'],))
                n.pause(conversation['sid'], 'Исход личной отправки неизвестен. Проверь чат вручную; автоматического повтора не будет.')
            return False
    finally: s.db.close()


async def notify_sent():
    cfg=configuration()
    if not cfg:return
    s,n=open_store(cfg)
    try:
        row=s.db.execute("SELECT o.*,n.client,n.username FROM negotiation_personal_outbox o JOIN negotiations n ON n.sid=o.sid WHERE o.status='sent' AND o.audit_notified=0 AND o.created>=? ORDER BY o.created LIMIT 1",(float(s.setting('negotiation_audit_since','0')),)).fetchone()
        if not row:return
        def deliver():
            from tg_common import require
            import requests
            token,chat=require('NOTIFY_BOT_TOKEN','NOTIFY_CHAT_ID')
            title='📨 Отправлено клиенту '+('@'+row['username']+' · ' if row['username'] else '')+'ID '+str(row['client'])+'\n'
            text=row['text']
            for start in range(0,len(text),1700):
                response=requests.post('https://api.telegram.org/bot'+token+'/sendMessage',json={'chat_id':chat,'text':title+text[start:start+1700]},timeout=15).json()
                if not response.get('ok'):raise ValueError('Notification unavailable')
        await asyncio.to_thread(deliver)
        s.db.execute('UPDATE negotiation_personal_outbox SET audit_notified=1 WHERE id=?',(row['id'],))
    finally:s.db.close()


async def outbound_loop(client, policy):
    cfg=configuration()
    if cfg:
        try:
            me=await client.get_me()
            if me.id != int(cfg['owner']):
                logging.error('Negotiation personal account verification failed')
                return
            logging.warning('Negotiation personal account verified; scoped transport started')
        except Exception as e:
            logging.warning('Negotiation account check deferred: %s',type(e).__name__)
    last_error=0
    last_sources=0
    while True:
        try:
            await send_one(client, policy)
            await notify_sent()
            from leads_personal import folders
            from tg_common import notify
            if time.time()-last_sources>30:
                last_sources=time.time()
                from leads_personal import opened,setup
                sources,_=opened()
                if sources:
                    pending=sources.db.execute("SELECT 1 FROM lead_sources WHERE status='pending' LIMIT 1").fetchone();sources.db.close()
                    if pending:await setup(client,policy,notify)
            await folders(client,policy,notify)
        except asyncio.CancelledError: raise
        except Exception as e:
            if time.monotonic()-last_error>60:
                logging.error('Negotiation personal transport: %s',type(e).__name__)
                last_error=time.monotonic()
        await asyncio.sleep(5)
