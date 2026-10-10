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
            if isinstance(seconds, int) and seconds > 0:
                s.set_setting('negotiation_transport_cooldown', str(time.time() + seconds + 5))
                s.db.execute("UPDATE negotiation_personal_outbox SET status='pending' WHERE id=?", (item['id'],))
                n.owner_notice(conversation['sid'], 'Telegram ограничил отправку. Соблюдаю паузу; аккаунты/прокси не переключаю.')
            else:
                s.db.execute("UPDATE negotiation_personal_outbox SET status='uncertain' WHERE id=?", (item['id'],))
                n.pause(conversation['sid'], 'Исход личной отправки неизвестен. Проверь чат вручную; автоматического повтора не будет.')
            return False
    finally: s.db.close()


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
    while True:
        try: await send_one(client, policy)
        except asyncio.CancelledError: raise
        except Exception as e:
            if time.monotonic()-last_error>60:
                logging.error('Negotiation personal transport: %s',type(e).__name__)
                last_error=time.monotonic()
        await asyncio.sleep(5)
