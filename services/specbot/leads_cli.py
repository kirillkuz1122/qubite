"""Bounded local helper; no Telegram polling, session or credentials in output."""
import asyncio
import json
import os
from pathlib import Path
import sys
import time
from config import Config, load_env
from store import Store
from leads import Leads, configuration, process_one


async def execute(request):
    cfg=configuration()
    if not cfg:return {'text':'Telegram-заявки отключены'}
    root=Path(__file__).resolve().parent.parent
    load_env(root/'private.env');c=Config();s=Store(c.data/'specbot.sqlite');l=Leads(s,cfg)
    try:
        action=request.get('action')
        if action=='tick':
            # Interrupted paid work never silently repeats after restart.
            s.db.execute("UPDATE telegram_leads SET status='failed' WHERE status='processing' AND updated_at<?",(time.time()-180,))
            await process_one(l,c)
            return {'text':'tick'}
        if request.get('uid')!=c.owner or request.get('chat')!=c.owner:raise ValueError('Owner required')
        if action in ('reject','brief'):
            row=s.db.execute('SELECT * FROM telegram_leads WHERE id=?',(int(request['id']),)).fetchone()
            if not row:raise ValueError('Lead unavailable')
            if request.get('proposal_mid') is not None:
                p=s.db.execute('SELECT message_id FROM negotiation_proposals WHERE id=?',(row['proposal'],)).fetchone()
                if not p or p['message_id']!=request['proposal_mid']:raise ValueError('Stale card')
            if action=='reject':l.feedback(row['id'],request['reason']);return {'text':'Оценка сохранена; обращение не отправляется.'}
            bridge=json.loads((root/'kwork-bridge.json').read_text())
            sid=l.brief(row['id'],bridge['bot_username']);return {'text':'Создано интервью '+sid+'. Ссылка придёт в Brief-бот только тебе.'}
        if action=='mode':
            if request['mode'] not in ('paused','training'):raise ValueError('Mode')
            s.set_setting('lead_mode',request['mode'])
            if request['mode']=='paused':
                for row in list(s.db.execute("SELECT sid FROM telegram_leads WHERE sid IS NOT NULL AND first_sent=0")):
                    l.n.pause(row['sid'],'Telegram-поиск приостановлен владельцем')
            return {'text':'Режим: '+request['mode']}
        if action=='view':
            row=s.db.execute('SELECT * FROM telegram_leads WHERE id=?',(int(request['id']),)).fetchone()
            if not row:raise ValueError('Not found')
            return {'text':(str(row['id'])+' · '+row['status']+' · @'+row['source']+'\n'+row['link']+'\n\n'+row['text']+'\n\n/leadno '+str(row['id'])+' not_order|not_service|bad_draft')[:3800]}
        if action=='list':
            rows=list(s.db.execute('SELECT id,status,source,text FROM telegram_leads ORDER BY created_at DESC LIMIT 15'))
            count=s.db.execute('SELECT count(*) FROM telegram_leads WHERE feedback IS NOT NULL').fetchone()[0]
            sources=list(s.db.execute('SELECT username,status FROM lead_sources'))
            return {'text':('Telegram-поиск: '+s.setting('lead_mode','training')+' · оценок '+str(count)+'\nАвтоматические обращения доступны: '+str(l.auto_ready())+'\nПосле 48 ч и минимум 30 оценок (27 одобрений из последних 30), только явные запросы исполнителя, высокий результат Jev и свежесть до 2 минут. До 5 автоматических первых обращений за сутки; это наш предел, не гарантия Telegram.\n\nИсточники:\n'+'\n'.join('@'+r['username']+' · '+r['status'] for r in sources)+'\n\n'+'\n'.join(str(r['id'])+' · '+r['status']+' · '+r['text'][:70] for r in rows)+'\n/leadview ID · /leadno ID not_order|not_service|bad_draft · /leadbrief ID · /leadpause · /leadtrain')[:3800]}
        raise ValueError('Unknown action')
    finally:s.db.close()


if __name__=='__main__':
    os.umask(0o077)
    try:
        raw=sys.stdin.buffer.read(8193)
        if len(raw)>8192:raise ValueError('Request too large')
        print(json.dumps(asyncio.run(execute(json.loads(raw))),ensure_ascii=False))
    except Exception as error:
        print('Lead helper failed: '+type(error).__name__,file=sys.stderr);sys.exit(1)
