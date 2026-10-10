"""Optional Brief integration; callbacks enqueue, only the worker creates links."""
import functools
import html
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(os.environ.get('KWORK_BOT_ROOT', str(Path.home() / 'services/kwork-bot')))
CTA = 'Чтобы точнее оценить объём и сроки, можно пройти короткое интервью по задаче: '
POLICY = '''
Дополнительно верни в том же JSON поле brief: {"title": "название проекта до 150 символов",
"preset": "development|design|marketing|general", "focus": "до 1200 символов"}.
focus: конкретные важные вопросы для интервью по этому заказу: что известно, что ещё надо выяснить,
объём, входные материалы, ограничения и критерии готовности. Не выдумывай требования.
Это внутренние настройки будущего интервью, не часть reply. Не придумывай URL и не обещай
скидок, оплаты вне площадки или автоматической переписки. Ссылку добавит программа по кнопке владельца.
'''


def settings(root=ROOT):
    try:
        data = json.loads((root / 'brief-integration.json').read_text())
    except (OSError, ValueError):
        return None
    return data if data.get('enabled') is True else None


def initialize(state):
    with state.db() as c:
        c.execute('''CREATE TABLE IF NOT EXISTS brief_links(
            oid TEXT PRIMARY KEY, sid TEXT NOT NULL, url TEXT NOT NULL,
            reply TEXT NOT NULL, variant_n INTEGER, created REAL NOT NULL)''')


def saved_link(state, oid):
    with state.db() as c:
        row = c.execute('SELECT * FROM brief_links WHERE oid=?', (str(oid),)).fetchone()
    return dict(row) if row else None


def keyboard(markup, oid, ready, root=ROOT):
    if not ready or not settings(root):
        return markup
    import kwork_bot
    state = kwork_bot.State(root)
    link = saved_link(state, oid)
    rows = list(markup['inline_keyboard'])
    if link:
        rows.insert(1, [{'text': 'Открыть Brief', 'url': link['url']},
                        {'text': 'Копировать ссылку Brief', 'copy_text': {'text': link['url']}}])
        # Older deployed keyboards cap text at eight 256-character fragments.
        # Keep the complete new draft copyable, including its invitation.
        text = link['reply']
        pieces = [text[i:i+256] for i in range(0, len(text), 256)]
        buttons = [{'text': 'Отклик + Brief · ' + str(i+1) + '/' + str(len(pieces)),
                    'copy_text': {'text': part}} for i, part in enumerate(pieces)]
        for offset in range(0, len(buttons), 4):
            rows.insert(2 + offset//4, buttons[offset:offset+4])
    else:
        rows.insert(1, [{'text': 'Добавить Brief', 'callback_data': 'brief:' + str(oid)}])
    return {'inline_keyboard': rows}


def callback(state, cb, owner):
    data = cb.get('data', '')
    if not data.startswith('brief:'):
        return None
    msg = cb.get('message', {})
    if cb.get('from', {}).get('id') != owner or msg.get('chat', {}).get('id') != owner:
        return 'Этот бот доступен только владельцу'
    if not re.fullmatch(r'brief:\d{1,20}', data) or not settings(state.path.parent):
        return 'Интеграция Brief недоступна'
    oid = data.split(':')[1]
    with state.db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT * FROM orders WHERE id=? AND message_id=?', (oid, msg.get('message_id'))).fetchone()
        if not row or row['deleted']:
            return 'Карточка недоступна'
        if not row['ready']:
            return 'Сначала подготовь отклик'
        # Completed links may be redelivered after a failed Telegram edit, without a new interview.
        added = c.execute("""INSERT INTO jobs(oid,kind) VALUES(?,'brief')
            ON CONFLICT(oid,kind) DO UPDATE SET status='pending',attempts=0,due=0
            WHERE jobs.status IN ('failed','done')""", (oid,))
        return 'Добавляем интервью Brief' if added.rowcount else 'Brief уже в очереди'


def draft_metadata(fn):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        body = fn(*args, **kwargs)
        if settings():
            body['messages'][0]['content'] += POLICY
            body['max_tokens'] = max(body.get('max_tokens', 0), 1600)
        return body
    return wrapped


def attached(reply, url):
    if url in reply:
        return reply
    return reply.rstrip() + '\n\n' + CTA + url


def notification(fn):
    @functools.wraps(fn)
    def wrapped(order, result=None):
        if not result or not settings():
            return fn(order, result)
        import kwork_bot
        link = saved_link(kwork_bot.State(), order['id'])
        if not link:
            return fn(order, result)
        if isinstance(result, list):
            values = [dict(v) for v in result]
            values[-1]['reply'] = attached(values[-1]['reply'], link['url'])
        else:
            values = dict(result)
            values['reply'] = attached(values['reply'], link['url'])
        try:
            return fn(order, values)
        except ValueError as e:
            if 'Notification too long' not in str(e):
                raise
            # Full variants remain in SQLite and their copy buttons; card shows the latest one.
            latest = values[-1] if isinstance(values, list) else values
            text = '<b>' + html.escape(str(order.get('title', ''))[:150]) + '</b>\n\n<pre>' + html.escape(latest['reply']) + '</pre>'
            if len(text) > 4096:
                raise ValueError('Brief draft too long; shorten the draft first') from None
            return {'text': text, 'parse_mode': 'HTML', 'ready': True}
    return wrapped


def metadata(order, cached):
    item = cached.get('brief') if isinstance(cached, dict) else None
    if not isinstance(item, dict):
        item = {}
    title = item.get('title')
    if not isinstance(title, str) or not title.strip():
        title = str(order.get('title') or 'Проект Kwork')
    focus = item.get('focus')
    if not isinstance(focus, str) or not focus.strip():
        focus = ('Исходное описание заказа:\n' + str(order.get('description') or '')[:2800] +
                 '\nУточни существенные пробелы: результат, объём, исходные материалы, ограничения, сроки и критерии приёмки. '
                 'Не спрашивай заново явно указанные сведения; не навязывай техническое решение.')
    preset = item.get('preset', 'general')
    if preset not in ('development', 'design', 'marketing', 'general'):
        preset = 'general'
    return {'oid': str(order['id']), 'title': title.strip()[:150], 'preset': preset, 'focus': focus.strip()[:4000]}


def create_link(cfg, request):
    p = subprocess.run([cfg['bridge_python'], cfg['bridge_script']],
                       cwd=str(Path(cfg['bridge_script']).parent),
                       input=json.dumps(request, ensure_ascii=False), capture_output=True, text=True, timeout=20)
    if p.returncode or len(p.stdout) > 2000:
        raise RuntimeError('Brief bridge unavailable; no AI request was made')
    result = json.loads(p.stdout)
    url = result.get('url', '')
    expected = 'https://t.me/' + cfg['bot_username'] + '?start='
    if not isinstance(url, str) or not url.startswith(expected) or not re.fullmatch(r'[A-Za-z0-9_-]{25,64}', url[len(expected):]):
        raise ValueError('Invalid Brief link')
    if not re.fullmatch(r'[a-f0-9]{12}', result.get('sid', '')):
        raise ValueError('Invalid Brief session')
    return result


def process(state, row, owner, api, runner, parser, make_keyboard):
    if not row or row['deleted'] or not row['ready']:
        return
    cfg = settings(state.path.parent)
    if not cfg:
        raise RuntimeError('Brief integration disabled')
    oid = str(row['id'])
    order = json.loads(row['data'])
    variants = state.variants(oid) if hasattr(state, 'variants') else None
    try:
        cached = json.loads((parser.DATA / 'kwork_drafts' / (oid + '.json')).read_text())
    except (FileNotFoundError, ValueError):
        cached = {}
    base = variants[-1] if variants else cached
    if not isinstance(base.get('reply'), str) or not base['reply'].strip():
        raise ValueError('Draft missing; no paid regeneration attempted')
    link = saved_link(state, oid)
    if not link:
        invitation = create_link(cfg, metadata(order, cached))
        reply = attached(base['reply'], invitation['url'])
        if len(reply) > 3500:
            raise ValueError('Brief draft too long; shorten the draft first')
        with state.db() as c:
            c.execute('BEGIN IMMEDIATE')
            current = c.execute('SELECT deleted FROM orders WHERE id=?', (oid,)).fetchone()
            if not current or current['deleted']:
                return
            link = c.execute('SELECT * FROM brief_links WHERE oid=?', (oid,)).fetchone()
            if not link:
                n = None
                if variants is not None:
                    n = c.execute('SELECT coalesce(max(n),0)+1 FROM variants WHERE oid=?', (oid,)).fetchone()[0]
                    c.execute('''INSERT INTO variants(oid,n,base_n,instruction,reply,suggested_price,time_estimate,created)
                        VALUES(?,?,?,?,?,?,?,?)''', (oid, n, base.get('n'), 'Добавлено интервью Brief', reply,
                                                   base.get('suggested_price', ''), base.get('time_estimate', ''), time.time()))
                c.execute('INSERT INTO brief_links VALUES(?,?,?,?,?,?)',
                          (oid, invitation['sid'], invitation['url'], reply, n, time.time()))
        link = saved_link(state, oid)
    current = state.get(oid)
    if not current or current['deleted']:
        return
    if variants is not None:
        values = state.variants(oid)
        card = runner.notification(order, values)
        markup = make_keyboard(oid, True, order=order, variants=values)
    else:
        values = dict(base, reply=link['reply'])
        card = runner.notification(order, values)
        markup = make_keyboard(oid, True)
    card.update(chat_id=owner, message_id=current['message_id'], reply_markup=markup)
    try:
        api('editMessageText', card)
    except RuntimeError as e:
        if 'message is not modified' not in str(e):
            raise
    state.sent(oid, current['message_id'], True)
