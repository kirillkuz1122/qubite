#!/usr/bin/env python3
"""Проверка реестра задач и связности документации без запуска приложения."""
import json
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATES = {'backlog', 'ready', 'in_progress', 'review/testing', 'done', 'blocked'}
REQUIRED = {'id', 'title', 'reason', 'module', 'priority', 'dependencies', 'files',
            'acceptance', 'tests', 'risks', 'rollback', 'status', 'commit', 'architecture_approved'}

def validate(tasks):
    ids = [t['id'] for t in tasks]
    assert len(ids) == len(set(ids)), 'Повтор ID'
    by_id = {t['id']: t for t in tasks}
    def visit(key, chain):
        assert key not in chain, f'Цикл: {chain + [key]}'
        for dep in by_id[key]['dependencies']:
            assert dep in by_id, f'{key}: неизвестная зависимость {dep}'
            visit(dep, chain + [key])
    for t in tasks:
        assert REQUIRED <= t.keys(), f"{t['id']}: неполная карточка"
        assert t['status'] in STATES
        assert t['acceptance'] and t['tests'] and t['files']
        if t['status'] == 'done':
            assert t['commit'] and t.get('verification'), f"{t['id']}: нет доказательств"
        if t['status'] == 'ready':
            assert t['architecture_approved'], f"{t['id']}: архитектура не согласована"
            assert all(by_id[d]['status'] == 'done' for d in t['dependencies'])
        visit(t['id'], [])
    return by_id

if __name__ == '__main__':
    tasks = json.loads((ROOT / 'docs/plan/tasks.json').read_text())
    by_id = validate(tasks)
    identity = ROOT / 'contracts/identity-v2.json'
    if identity.exists():
        contract = json.loads(identity.read_text())
        assert contract['status'] in {'specification', 'partial_implementation'}
        implemented = set(contract.get('implemented_tasks', []))
        assert contract['runtime_implemented'] == bool(implemented)
        assert (contract['status'] == 'specification') == (not implemented)
        assert implemented <= set(by_id)
        routes = [(r['method'], r['path']) for r in contract['routes']]
        assert len(routes) == len(set(routes)), 'Повтор identity route'
        for route in contract['routes']:
            assert route['task'] in by_id, 'Неизвестная identity задача'
            assert route['status'] == ('implemented' if route['task'] in implemented else 'planned'), 'Неверный runtime status identity route'
    legal_bundle = ROOT / 'docs/legal/BUNDLE.json'
    if legal_bundle.exists():
        manifest = json.loads(legal_bundle.read_text())
        source = ROOT / manifest['source']
        packet = json.loads(source.read_text())
        assert manifest['sha256'] == hashlib.sha256(source.read_bytes()).hexdigest(), 'Legal packet changed without evidence update'
        assert manifest['version'] == packet['bundle_version']
        assert manifest['publication_ready'] == packet['publication_ready']
        for doc in packet['documents']:
            markdown = (ROOT / ('docs/legal/' + doc['id'].upper() + '.md')).read_text()
            assert doc['title'] in markdown
            assert all(paragraph in markdown for section in doc['sections'] for paragraph in section['paragraphs']), 'Legal source/markdown diverged'
    trace = json.loads((ROOT / 'docs/product/source-trace.json').read_text())
    for source in ['QUBITE_MASTER_CONTEXT.md', 'QUBITE_ACCESS_AND_OWNER_CONSOLE.md']:
        expected = [(i, hashlib.sha256(line.encode()).hexdigest()) for i, line in enumerate((ROOT/source).read_text().splitlines(), 1) if line.strip()]
        actual = [(row['line'], row['sha256']) for row in trace if row['source'] == source]
        assert actual == expected, f'{source}: source trace устарела/неполная'
    ideas = set(re.findall(r'IDEA-(\d{2})', (ROOT / 'docs/product/REQUIREMENTS.md').read_text()))
    assert ideas == {f'{i:02}' for i in range(1, 49)}, 'Потеря идеи из 48'
    count = 0
    for directory in ['docs/product', 'docs/architecture', 'docs/migration', 'docs/design',
                      'docs/engineering', 'docs/plan', 'docs/project', 'docs/legacy-services', 'docs/legal']:
        for p in (ROOT / directory).rglob('*.md'):
            assert len(p.read_text().strip()) > 150, f'Пустой документ {p}'
            markdown = re.sub(r'`[^`\n]*`', '', p.read_text())
            for href in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', markdown):
                if '://' in href or href.startswith('#'):
                    continue
                assert (p.parent / href.split('#')[0]).exists(), f'{p}: ссылка {href}'
            count += 1
    print(f'OK: {len(tasks)} задач, {count} документов; зависимости и ссылки проверены')
    print('READY:', ', '.join(t['id'] for t in tasks if t['status'] == 'ready') or 'нет')
