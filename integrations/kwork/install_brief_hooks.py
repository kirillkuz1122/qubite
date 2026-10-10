#!/usr/bin/env python3
"""Apply only integration hooks, retaining all independently deployed Kwork features."""
import ast
from pathlib import Path
import sys


def modify_function(text, name, transform):
    node = next(n for n in ast.parse(text).body if isinstance(n, ast.FunctionDef) and n.name == name)
    lines = text.splitlines(keepends=True)
    original = ''.join(lines[node.lineno - 1:node.end_lineno])
    replacement = transform(original)
    if replacement == original:
        raise ValueError('Unsupported hook target: ' + name)
    return ''.join(lines[:node.lineno - 1]) + replacement + ''.join(lines[node.end_lineno:])


def patch_bot(text):
    if 'import kwork_brief as brief_integration' in text:
        return text
    text = text.replace('import requests\n', 'import requests\nimport kwork_brief as brief_integration\n', 1)
    needle = '        os.chmod(self.path,0o600)'
    if text.count(needle) != 1:
        raise ValueError('Unsupported State initialization')
    text = text.replace(needle, needle + '\n        brief_integration.initialize(self)', 1)
    text = modify_function(text, 'keyboard', lambda f: f.replace("return {'inline_keyboard':rows}",
        "return brief_integration.keyboard({'inline_keyboard':rows},oid,ready,ROOT)", 1))
    text = modify_function(text, 'handle_callback', lambda f: f.replace('    if cb.get(',
        "    brief_result=brief_integration.callback(state,cb,owner)\n    if brief_result is not None:return brief_result\n    if cb.get(", 1))
    text = modify_function(text, 'work', lambda f: f.replace("            elif row and not row['deleted']:",
        "            elif job['kind']=='brief':\n                brief_integration.process(state,row,owner,api,runner,parser,keyboard)\n            elif row and not row['deleted']:", 1))
    needle = "            if job['attempts']>=4 and row and not row['deleted']:\n"
    if text.count(needle) != 1:
        raise ValueError('Unsupported worker error handler')
    text = text.replace(needle, needle + "                if job['kind']=='brief':\n" +
        "                    try:api('sendMessage',{'chat_id':owner,'text':'Не удалось добавить Brief для заказа '+job['oid']+'. Отклик сохранён. Можно повторить кнопку; платной генерации не было.'})\n" +
        "                    except RuntimeError:pass\n                    continue\n", 1)
    ast.parse(text)
    return text


def patch_runner(text):
    if 'import kwork_brief as brief_integration' in text:
        return text
    text = text.replace('import requests\n', 'import requests\nimport kwork_brief as brief_integration\n', 1)
    text = text.replace('\ndef request_body(', '\n@brief_integration.draft_metadata\ndef request_body(', 1)
    text = text.replace('\ndef notification(', '\n@brief_integration.notification\ndef notification(', 1)
    if '@brief_integration.draft_metadata' not in text or '@brief_integration.notification' not in text:
        raise ValueError('Unsupported runner hooks')
    ast.parse(text)
    return text


def main():
    root = Path(sys.argv[1])
    # Validate both before writing either file. Back up on deployment before invoking.
    changes = [(root / 'kwork_bot.py', patch_bot((root / 'kwork_bot.py').read_text())),
               (root / 'kwork_runner.py', patch_runner((root / 'kwork_runner.py').read_text()))]
    for path, text in changes:
        path.write_text(text)
    print('Brief hooks installed; existing Kwork features preserved')


if __name__ == '__main__':
    main()
