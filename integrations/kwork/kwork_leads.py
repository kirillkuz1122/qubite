"""Controls Telegram lead collection in the existing owner-only Kwork bot."""
import json
from pathlib import Path
import re
import subprocess
import time
import sqlite3
from concurrent.futures import ThreadPoolExecutor

_pending=None
_executor=None
_last=0


def helper(state,request,timeout=10):
    p=state.path.parent/'negotiation-integration.json'
    c=json.loads(p.read_text())
    if not c.get('enabled'):raise ValueError('Disabled')
    script=Path(c['script']).with_name('leads_cli.py')
    r=subprocess.run([c['python'],str(script)],input=json.dumps(request),text=True,capture_output=True,timeout=timeout)
    if r.returncode:raise ValueError('Lead helper unavailable')
    return json.loads(r.stdout)


def callback(state,cb,owner,api):
    data=cb.get('data','')
    if not data.startswith('lead:'):return None
    if cb.get('from',{}).get('id')!=owner or cb.get('message',{}).get('chat',{}).get('id')!=owner:return 'Только владелец'
    m=re.fullmatch(r'lead:(no|brief):(\d{1,10}):(not_order|not_service|bad_draft|open)',data)
    if not m:return 'Неизвестная кнопка'
    try:
        result=helper(state,{'action':'reject' if m[1]=='no' else 'brief','id':int(m[2]),'reason':m[3],
                      'uid':owner,'chat':owner,'proposal_mid':cb['message']['message_id']})
        return result['text']
    except Exception:return 'Карточка устарела или недоступна'


def message(state,msg,owner,api):
    if msg.get('from',{}).get('id')!=owner or msg.get('chat',{}).get('id')!=owner:return False
    text=(msg.get('text') or '').strip()
    request={'uid':owner,'chat':owner}
    if text=='/leads':request['action']='list'
    elif text in ('/leadpause','/leadtrain'):request.update(action='mode',mode='paused' if text=='/leadpause' else 'training')
    else:
        m=re.fullmatch(r'/lead(view|brief|no) (\d{1,10})(?: (not_order|not_service|bad_draft))?',text)
        if not m:return False
        request.update(action={'view':'view','brief':'brief','no':'reject'}[m[1]],id=int(m[2]),reason=m[3] or 'not_order')
    try:result=helper(state,request);answer=result['text']
    except Exception:answer='Не удалось обработать настройку Telegram-заявок.'
    api('sendMessage',{'chat_id':owner,'text':answer},10);return True


def tick(state,owner,api):
    global _pending,_executor,_last
    if _pending is not None:
        if not _pending.done():return
        try:_pending.result()
        except Exception as error:print('Telegram leads: '+type(error).__name__,flush=True)
        _pending=None
    if time.monotonic()-_last<2:return
    _last=time.monotonic()
    try:
        from kwork_negotiation import data_path
        path=data_path(state)
        if not path or not path.exists():return
        with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=.2) as c:
            mode=c.execute("SELECT value FROM settings WHERE key='lead_mode'").fetchone()
            if mode and mode[0]=='paused':return
            pending=c.execute("SELECT 1 FROM telegram_leads WHERE status='pending' LIMIT 1").fetchone()
            brief=c.execute("SELECT 1 FROM telegram_leads l JOIN sessions b ON b.id=l.brief_id JOIN sessions s ON s.id=l.sid WHERE b.status='done' AND s.status!='done' LIMIT 1").fetchone()
            if not pending and not brief:return
    except (OSError,ValueError,sqlite3.Error):return
    if _executor is None:_executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='telegram-leads')
    _pending=_executor.submit(helper,state,{'action':'tick'},100)
