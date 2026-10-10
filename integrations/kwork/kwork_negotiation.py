"""Owner proposal UI in Kwork bot; worker owns model calls and queued notifications."""
import json
from pathlib import Path
import re
import subprocess
import time
import sqlite3
from concurrent.futures import ThreadPoolExecutor

_last_tick = 0
_pending = None
_executor = None
_last_notice = 0


def data_path(state):
    settings=cfg(state)
    if not settings:return None
    root=Path(settings['script']).parent.parent
    c=json.loads((root/'negotiation-config.json').read_text())
    return Path(c['data_dir'])/'specbot.sqlite'


def notification_tick(state,owner,api):
    global _last_notice
    if time.monotonic()-_last_notice<1:return
    _last_notice=time.monotonic()
    try:
        path=data_path(state)
        if not path or not path.exists():return
        with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=.2) as c:
            if not c.execute("SELECT 1 FROM negotiation_owner_outbox WHERE status='pending' LIMIT 1").fetchone():return
        result=helper(state,{'action':'notifications'})
        for item in result.get('events',[]):
            payload={'chat_id':owner,'text':item['text'],'reply_markup':item['markup']}
            if item.get('card_mid'):
                payload['message_id']=int(item['card_mid'])
                try:sent=api('editMessageText',payload,10)
                except Exception as error:
                    if type(error).__name__!='MessageGone':raise
                    payload.pop('message_id');sent=api('sendMessage',payload,10)
            else:sent=api('sendMessage',payload,10)
            helper(state,{'action':'ack','id':item['id'],'message_id':sent['message_id']})
    except Exception as error:print('Negotiation notifications: '+type(error).__name__,flush=True)


def cfg(state):
    p = state.path.parent / 'negotiation-integration.json'
    try: data = json.loads(p.read_text())
    except (OSError, ValueError): return None
    return data if data.get('enabled') is True else None


def helper(state, request, timeout=10):
    settings = cfg(state)
    if not settings: raise ValueError('Переговоры ещё не включены')
    request=dict(request,channel='leads' if state.path.name=='lead-bot.sqlite' else 'kwork')
    result = subprocess.run([settings['python'], settings['script']], cwd=str(Path(settings['script']).parent),
                            input=json.dumps(request, ensure_ascii=False), capture_output=True, text=True, timeout=timeout)
    if result.returncode: raise RuntimeError('Локальный агент переговоров недоступен')
    return json.loads(result.stdout)


def callback(state, cb, owner, api):
    data = cb.get('data', '')
    if not data.startswith('nego:'): return None
    if cb.get('from', {}).get('id') != owner or cb.get('message', {}).get('chat', {}).get('id') != owner:
        return 'Этот бот доступен только владельцу'
    m = re.fullmatch(r'nego:(send|edit|reject|pause):([a-f0-9]{12}):(\d{1,6})', data)
    if not m: return 'Неизвестная кнопка'
    # Short helper has no AI or Telegram IO in control mode.
    try:
        result = helper(state, {'action': 'control', 'uid': owner, 'chat': owner, 'message_id': cb['message']['message_id'],
                                'op': m[1], 'proposal': m[2], 'version': int(m[3])})
        if result.get('edit'):
            text = ('Пришли цену в рублях; срок в днях; состав работ. Например: 15000; 7; Бот с каталогом и заявками. '
                    'Новую версию покажу перед отправкой.') if result['kind'] == 'offer' else 'Пришли новый текст ответа. Покажу его перед отправкой.'
            sent = api('sendMessage', {'chat_id': owner, 'text': text, 'reply_markup': {'force_reply': True, 'selective': True}}, 10)
            with state.db() as c:
                c.execute("INSERT INTO meta VALUES('nego_edit',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                          (json.dumps({'id': result['edit'], 'version': result['version'], 'prompt_mid': sent['message_id']}),))
            return 'Жду правку'
        return {'send': 'Подтверждено: отправка из личного Telegram в очереди', 'reject': 'Не отправляю', 'pause': 'Переговоры на паузе'}[m[1]]
    except (ValueError, RuntimeError, subprocess.TimeoutExpired): return 'Не обработано: карточка устарела или агент недоступен'


def message(state, msg, owner, api):
    if msg.get('from', {}).get('id') != owner or msg.get('chat', {}).get('id') != owner: return False
    if not cfg(state): return False
    text = str(msg.get('text') or '')
    if text.startswith('/negotiations'):
        result = helper(state, {'action': 'list', 'uid': owner, 'chat': owner})
        api('sendMessage', {'chat_id': owner, 'text': result['text']}, 10); return True
    command=re.fullmatch(r'/nego(pause|resume|close|view) ([a-f0-9]{12})',text.strip())
    if command:
        try:
            result=helper(state,{'action':command[1],'sid':command[2],'uid':owner,'chat':owner})
            api('sendMessage',{'chat_id':owner,'text':result.get('text','Настройка переговоров изменена.')},10)
        except (ValueError,RuntimeError,subprocess.TimeoutExpired):
            api('sendMessage',{'chat_id':owner,'text':'Не удалось изменить переговоры. Проверь ID и режим Brief.'},10)
        return True
    if text.startswith('/negoretry '):
        sid = text.split(maxsplit=1)[1].strip()
        if not re.fullmatch(r'[a-f0-9]{12}', sid): return False
        helper(state, {'action': 'retry', 'sid': sid, 'uid': owner, 'chat': owner})
        api('sendMessage', {'chat_id': owner, 'text': 'Повтор обработки разрешён. Отправка условий всё равно требует подтверждения.'}, 10); return True
    with state.db() as c:
        row = c.execute("SELECT v FROM meta WHERE k='nego_edit'").fetchone()
    if not row: return False
    pending = json.loads(row[0])
    if text == '/cancel':
        with state.db() as c: c.execute("DELETE FROM meta WHERE k='nego_edit'")
        api('sendMessage', {'chat_id': owner, 'text': 'Правка отменена.'}, 10); return True
    if msg.get('reply_to_message', {}).get('message_id') != pending['prompt_mid']: return False
    try:
        helper(state, {'action': 'edit', 'uid': owner, 'chat': owner, 'proposal': pending['id'], 'version': pending['version'], 'text': text})
    except (ValueError, RuntimeError, subprocess.TimeoutExpired):
        api('sendMessage', {'chat_id': owner, 'text': 'Правка не принята. Проверь формат или открой свежую карточку.'}, 10); return True
    with state.db() as c: c.execute("DELETE FROM meta WHERE k='nego_edit'")
    return True


def tick(state, owner, api):
    global _last_tick,_pending,_executor
    if not cfg(state): return
    notification_tick(state,owner,api)
    if _pending is not None:
        if not _pending.done():return
        try:
            result = _pending.result()
            for item in result.get('events', []):
                sent = api('sendMessage', {'chat_id': owner, 'text': item['text'], 'reply_markup': item['markup']})
                helper(state, {'action': 'ack', 'id': item['id'], 'message_id': sent['message_id']})
        except Exception as e:
            # No user text or secret-bearing subprocess output in logs.
            print('Negotiation tick: ' + type(e).__name__, flush=True)
        finally:_pending=None
        return
    if time.monotonic() - _last_tick < 60:return
    _last_tick=time.monotonic()
    if _executor is None:_executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='brief-helper')
    # Model IO never occupies the Kwork job queue or the callback poll process.
    _pending=_executor.submit(helper,state,{'action':'tick'},100)
