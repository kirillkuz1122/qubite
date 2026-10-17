import concurrent.futures
import json
from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from store import Store
from bridge import create_invitation, link_key


def request(oid='123'):
    return {'oid': oid, 'title': 'Бот для магазина', 'preset': 'development', 'focus': 'Уточнить каталог и доставку.'}


def test_repeated_creation_preserves_focus_and_one_notification(tmp_path):
    store = Store(tmp_path / 'data' / 'brief.sqlite')
    key = link_key(tmp_path / 'data')
    first = create_invitation(store, request(), key, 1, 'test_bot')
    store.update(first['sid'], focus='Изменён владельцем')
    second = create_invitation(store, dict(request(), focus='Перезаписать'), key, 1, 'test_bot')
    assert first['url'] == second['url'] and not second['created']
    assert store.get(first['sid'])['focus'] == 'Изменён владельцем'
    assert store.db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 1
    assert store.db.execute('SELECT count(*) FROM outbox').fetchone()[0] == 1
    token = first['url'].split('start=')[1]
    assert store.claim(token, 2) == first['sid']
    with pytest.raises(ValueError):
        store.claim(token, 3)
    assert token not in store.db.execute('SELECT token_hash FROM sessions').fetchone()[0]


@pytest.mark.parametrize('field,value', [('status', 'revoked'), ('expires', 0)])
def test_revoke_expiry_not_resurrected(tmp_path, field, value):
    store = Store(tmp_path / 'data' / 'brief.sqlite')
    first = create_invitation(store, request(), b'x'*32, 1, 'test_bot')
    store.db.execute('UPDATE sessions SET ' + field + '=? WHERE id=?', (value, first['sid']))
    with pytest.raises(ValueError, match='expired or revoked'):
        create_invitation(store, request(), b'x'*32, 1, 'test_bot')
    assert store.db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 1


def test_concurrent_workers_reuse_same_invite(tmp_path):
    path = tmp_path / 'data' / 'brief.sqlite'
    initial = Store(path); initial.db.close()
    def create(_):
        store = Store(path)
        try:
            return create_invitation(store, request(), b'x'*32, 1, 'test_bot')['url']
        finally:
            store.db.close()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        links = list(pool.map(create, range(8)))
    assert len(set(links)) == 1
    store = Store(path)
    assert store.db.execute('SELECT count(*) FROM outbox').fetchone()[0] == 1


def test_validation_and_key_replacement_do_not_change_session(tmp_path):
    store = Store(tmp_path / 'data' / 'brief.sqlite')
    with pytest.raises(ValueError):
        create_invitation(store, dict(request(), oid='../../'), b'x'*32, 1, 'test_bot')
    assert store.db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0
    first = create_invitation(store, request(), b'x'*32, 1, 'test_bot')
    with pytest.raises(ValueError, match='key changed'):
        create_invitation(store, request(), b'y'*32, 1, 'test_bot')
    assert store.get(first['sid'])['title'] == request()['title']


def test_deleted_session_allows_new_explicit_invitation(tmp_path):
    store = Store(tmp_path / 'data' / 'brief.sqlite')
    first = create_invitation(store, request(), b'x'*32, 1, 'test_bot')
    store.db.execute('DELETE FROM sessions WHERE id=?', (first['sid'],))
    second = create_invitation(store, request(), b'x'*32, 1, 'test_bot')
    assert first['sid'] != second['sid'] and first['url'] != second['url']
