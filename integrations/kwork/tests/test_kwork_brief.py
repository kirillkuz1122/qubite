import json
from pathlib import Path
import sys
from types import SimpleNamespace
import pytest
import kwork_bot
import kwork_brief as brief
from install_brief_hooks import patch_bot, patch_runner


@pytest.fixture
def setup(tmp_path, monkeypatch):
    root = tmp_path / 'bot'
    state = kwork_bot.State(root)
    cfg = {'enabled': True, 'bot_username': 'test_bot', 'bridge_python': '/fixed/python', 'bridge_script': '/fixed/bridge.py'}
    (root / 'brief-integration.json').write_text(json.dumps(cfg))
    monkeypatch.setattr(brief, 'ROOT', root)
    monkeypatch.setattr(kwork_bot, 'ROOT', root)
    # Functions default arguments reference the production ROOT; use explicit roots in fixtures.
    monkeypatch.setattr(brief, 'settings', lambda root=None: cfg)
    state.save({'id': '123', 'title': 'Магазин', 'description': 'Каталог и доставка'})
    state.sent('123', 42, True)
    return state, root, cfg


def cb(user=1, chat=1, mid=42):
    return {'data': 'brief:123', 'from': {'id': user}, 'message': {'message_id': mid, 'chat': {'id': chat}}}


def test_callback_owner_card_and_deduplication(setup):
    state, _, _ = setup
    assert 'владельцу' in brief.callback(state, cb(user=2), 1)
    assert 'владельцу' in brief.callback(state, cb(chat=2), 1)
    assert 'недоступна' in brief.callback(state, cb(mid=12), 1)
    assert brief.callback(state, dict(cb(), data='edit:123'), 1) is None
    assert 'Добавляем' in brief.callback(state, cb(), 1)
    assert 'очереди' in brief.callback(state, cb(), 1)
    with state.db() as c:
        assert c.execute("SELECT count(*) FROM jobs WHERE kind='brief'").fetchone()[0] == 1
    state.callback('del', '123', 42)
    assert 'недоступна' in brief.callback(state, cb(), 1)


def test_no_button_before_draft_and_full_copy(setup, monkeypatch):
    state, root, _ = setup
    original = {'inline_keyboard': [[{'text': 'Удалить', 'callback_data': 'del:123'}]]}
    assert brief.keyboard(original, '123', False, root) == original
    monkeypatch.setattr(kwork_bot, 'State', lambda *args: state)
    assert brief.keyboard(original, '123', True, root)['inline_keyboard'][1][0]['callback_data'] == 'brief:123'
    text = 'д'*2800 + '\n' + 'https://t.me/test_bot?start=' + 'a'*43
    with state.db() as c:
        c.execute('INSERT INTO brief_links VALUES(?,?,?,?,?,?)', ('123', 'b'*12, text.split('\n')[1], text, None, 1))
    markup = brief.keyboard(original, '123', True, root)
    pieces = [b['copy_text']['text'] for row in markup['inline_keyboard'] for b in row if b['text'].startswith('Отклик + Brief')]
    assert ''.join(pieces) == text
    assert all(len(row) <= 4 for row in markup['inline_keyboard'])


def test_process_retries_do_not_call_model_or_create_duplicates(setup, tmp_path, monkeypatch):
    state, root, cfg = setup
    data = tmp_path / 'parser'; (data / 'kwork_drafts').mkdir(parents=True)
    reply = 'Здравствуйте! Готов сделать каталог и доставку.'
    (data / 'kwork_drafts/123.json').write_text(json.dumps({'reply': reply, 'suggested_price': '1000', 'time_estimate': '3 дня'}))
    calls = []
    def create(settings, request):
        calls.append(request)
        return {'sid': 'b'*12, 'url': 'https://t.me/test_bot?start=' + 'a'*43}
    monkeypatch.setattr(brief, 'create_link', create)
    runner = SimpleNamespace(notification=lambda order, value: {'text': value['reply'], 'ready': True},
                             draft=lambda *a: pytest.fail('Paid generation is forbidden in Brief button'))
    def failed_api(*args):
        raise RuntimeError('Telegram unavailable')
    with pytest.raises(RuntimeError):
        brief.process(state, state.get('123'), 1, failed_api, runner, SimpleNamespace(DATA=data), lambda *a: {})
    sent = []
    brief.process(state, state.get('123'), 1, lambda m,p: sent.append(p), runner, SimpleNamespace(DATA=data), lambda *a: {})
    assert len(calls) == 1 and sent[0]['text'].startswith(reply)
    assert sent[0]['text'].count('https://t.me/') == 1
    assert calls[0]['title'] == 'Магазин' and 'Каталог и доставка' in calls[0]['focus']


def test_metadata_validation_and_request_augmentation(setup):
    item = brief.metadata({'id': '1', 'title': 'Title'}, {'brief': {'title': ['bad'], 'preset': 'evil', 'focus': None}})
    assert item['title'] == 'Title' and item['preset'] == 'general'
    def request(order):
        return {'messages': [{'content': 'Original owner prompt'}, {'content': order}], 'max_tokens': 1200}
    body = brief.draft_metadata(request)('Order A')
    assert body['messages'][0]['content'].startswith('Original owner prompt')
    assert 'brief:' in body['messages'][0]['content'] and body['messages'][1]['content'] == 'Order A'


def test_targeted_patcher_is_idempotent_and_retains_production_features():
    root = Path(__file__).resolve().parents[1]
    for file, patch in [('kwork_bot.py', patch_bot), ('kwork_runner.py', patch_runner)]:
        source = (root / file).read_text()
        assert patch(patch(source)) == patch(source)
    # Copies from the running instance, when present: no replacement of its richer implementation.
    for file, patch in [('bot', patch_bot), ('runner', patch_runner)]:
        path = Path('/tmp/qubite-kwork-' + file + '-live.py')
        if path.exists():
            source = path.read_text(); output = patch(source)
            assert patch(output) == output
            for feature in ('prompt_versions', 'transcribe', "job['kind']=='learn'") if file == 'bot' else ('google-vertex/global', 'attachments_text', 'base_reply'):
                assert feature in output


def test_untrusted_link_rejected(setup, monkeypatch):
    _, _, cfg = setup
    monkeypatch.setattr(brief.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0, stdout=json.dumps({'sid': 'b'*12, 'url': 'https://evil.example/?start=abc'})))
    with pytest.raises(ValueError, match='Invalid Brief link'):
        brief.create_link(cfg, {'oid': '123'})


def test_live_variant_insert_is_atomic_and_old_variants_retained(setup, tmp_path, monkeypatch):
    state, _, _ = setup
    with state.db() as c:
        c.execute('''CREATE TABLE variants(id INTEGER PRIMARY KEY, oid TEXT,n INTEGER,base_n INTEGER,
            instruction TEXT DEFAULT '',transcript TEXT DEFAULT '',reply TEXT,suggested_price TEXT,
            time_estimate TEXT,created REAL,UNIQUE(oid,n))''')
        c.execute("INSERT INTO variants(oid,n,reply,suggested_price,time_estimate,created) VALUES('123',1,'Первый отклик','1000','3 дня',1)")
    def variants(oid):
        with state.db() as c:
            return [dict(r) for r in c.execute('SELECT * FROM variants WHERE oid=? ORDER BY n', (oid,))]
    state.variants = variants
    created = []
    monkeypatch.setattr(brief, 'create_link', lambda *a: created.append(1) or {'sid': 'b'*12, 'url': 'https://t.me/test_bot?start=' + 'a'*43})
    runner = SimpleNamespace(notification=lambda order, values: {'text': values[-1]['reply']})
    data = tmp_path / 'parser'
    calls = []
    def failed(*args):
        raise RuntimeError('network')
    with pytest.raises(RuntimeError):
        brief.process(state, state.get('123'), 1, failed, runner, SimpleNamespace(DATA=data), lambda *a, **k: {})
    brief.process(state, state.get('123'), 1, lambda m,p: calls.append(p), runner, SimpleNamespace(DATA=data), lambda *a, **k: {})
    values = variants('123')
    assert len(values) == 2 and values[0]['reply'] == 'Первый отклик'
    assert values[1]['base_n'] == 1 and 'https://t.me/' in values[1]['reply']
    assert len(created) == 1


def test_long_card_shows_latest_without_losing_variants(setup, monkeypatch):
    state, _, _ = setup
    monkeypatch.setattr(kwork_bot, 'State', lambda *a: state)
    url = 'https://t.me/test_bot?start=' + 'a'*43
    with state.db() as c:
        c.execute('INSERT INTO brief_links VALUES(?,?,?,?,?,?)', ('123', 'b'*12, url, 'Reply', 2, 1))
    variants = [{'n': 1, 'reply': 'старый '*400}, {'n': 2, 'reply': 'новый '*250}]
    def card(order, values):
        raise ValueError('Notification too long')
    result = brief.notification(card)({'id': '123', 'title': '<Клиент>'}, variants)
    assert '<Клиент>' not in result['text'] and '&lt;Клиент&gt;' in result['text']
    assert len(result['text']) < 4096 and url in result['text']
    assert 'https://t.me/' not in variants[1]['reply']
