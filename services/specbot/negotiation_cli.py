"""Local JSON helper used by the Kwork worker; no Telegram bot polling here."""
import asyncio
import json
import os
from pathlib import Path
import re
import sys
import time
from ai import AI
from config import Config, load_env
from negotiation import Negotiations, generate_one
from store import Store


async def execute(request):
    root = Path(__file__).resolve().parent.parent
    cfg = json.loads((root / 'negotiation-config.json').read_text())
    if cfg.get('enabled') is not True: return {'enabled': False, 'events': []}
    load_env(root / 'private.env'); c = Config(); s = Store(c.data / 'specbot.sqlite')
    n = Negotiations(s, c.owner, cfg['profile_url']); action = request.get('action')
    try:
        if action == 'tick':
            n.discover(float(cfg['enabled_since']))
            ai = AI(c, s)
            try: await generate_one(n, ai)
            finally: await ai.client.aclose()
            return {'enabled':True,'events':[]}  # Notifications have a separate short path.
        elif action == 'notifications':
            pass
        elif action == 'ack':
            row = s.db.execute('SELECT * FROM negotiation_owner_outbox WHERE id=?', (int(request['id']),)).fetchone()
            if row:
                s.db.execute("UPDATE negotiation_owner_outbox SET status='sent' WHERE id=?", (row['id'],))
                if row['proposal']:
                    s.db.execute('UPDATE negotiation_proposals SET message_id=? WHERE id=? AND version=?',
                                 (int(request['message_id']), row['proposal'], row['version']))
        else:
            if request.get('uid') != c.owner or request.get('chat') != c.owner:
                raise ValueError('Owner required')
            if action == 'control':
                ident = request['proposal']; version = int(request['version']); mid = int(request['message_id'])
                p = s.db.execute('SELECT * FROM negotiation_proposals WHERE id=?', (ident,)).fetchone()
                if not p or p['version'] != version or p['message_id'] != mid:
                    raise ValueError('Старая карточка предложения')
                op = request['op']
                if op == 'send':
                    n.approve(ident, version, mid)
                    lead=n.lead(p['sid'])
                    if lead and not lead['first_sent']:
                        s.db.execute("UPDATE telegram_leads SET feedback=1,feedback_reason='owner_send',updated_at=? WHERE id=?",(time.time(),lead['id']))
                elif op == 'pause': n.pause(p['sid'])
                elif op == 'reject':
                    s.db.execute("UPDATE negotiation_proposals SET status='rejected' WHERE id=? AND status='draft'", (ident,))
                    lead=n.lead(p['sid'])
                    if lead and not lead['first_sent']:
                        s.db.execute("UPDATE telegram_leads SET feedback=-1,feedback_reason='owner_reject',updated_at=? WHERE id=?",(time.time(),lead['id']))
                elif op == 'edit': return {'edit': ident, 'version': version, 'kind': p['kind']}
                else: raise ValueError('Неизвестная операция')
            elif action == 'edit':
                p = s.db.execute('SELECT * FROM negotiation_proposals WHERE id=?', (request['proposal'],)).fetchone()
                if not p or p['version'] != int(request['version']) or p['status'] != 'draft': raise ValueError('Предложение устарело')
                if p['kind'] == 'offer':
                    parts = request['text'].split(';', 2)
                    if len(parts) != 3: raise ValueError('Формат: цена; дней; состав работ')
                    n.revise(p['id'], int(parts[0].strip()), int(parts[1].strip()), parts[2].strip())
                else:
                    text = str(request['text']).strip()
                    if not text or len(text) > 2500: raise ValueError('Ответ: до 2500 символов')
                    brief=s.get(p['sid'])
                    s.db.execute('UPDATE negotiation_proposals SET text=?,version=version+1,revision=?,brief_revision=?,brief_updated=?,message_id=NULL WHERE id=?',
                                 (text, n.get(p['sid'])['revision'], brief['revision'], brief['updated'], p['id']))
                    n.proposal_notice(p['id'])
            elif action in ('pause','resume','close'):
                getattr(n,action)(request['sid'])
            elif action == 'view':
                sid=request['sid']; conversation=n.get(sid)
                rows=list(s.db.execute('SELECT role,text FROM negotiation_messages WHERE sid=? ORDER BY id DESC LIMIT 10',(sid,)))
                return {'text':(s.get(sid)['title']+' · '+conversation['status']+'\n\n'+'\n\n'.join(r['role']+': '+r['text'] for r in reversed(rows)))[-3800:]}
            elif action == 'retry':
                sid = request['sid']; n.get(sid)
                s.db.execute("DELETE FROM negotiation_attempts WHERE sid=? AND status IN ('failed','running')", (sid,))
            elif action == 'list':
                rows = list(s.db.execute('SELECT n.sid,n.status,s.title FROM negotiations n JOIN sessions s ON s.id=n.sid ORDER BY n.updated DESC LIMIT 20'))
                return {'text': '\n'.join(r['sid'] + ' · ' + r['status'] + ' · ' + r['title'] for r in rows) or 'Переговоров пока нет.'}
            else: raise ValueError('Unknown helper action')
        events = [dict(r) for r in s.db.execute("SELECT * FROM negotiation_owner_outbox WHERE status='pending' ORDER BY id LIMIT 5")]
        for item in events: item['markup'] = json.loads(item['markup'])
        return {'enabled': True, 'events': events}
    finally: s.db.close()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384: raise ValueError('Too large')
        result = asyncio.run(execute(json.loads(raw)))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        # Fixed category only; user/model text and credentials never enter stderr.
        print('Negotiation helper failed: ' + type(e).__name__, file=sys.stderr)
        sys.exit(1)
