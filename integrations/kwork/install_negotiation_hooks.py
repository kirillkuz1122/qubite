#!/usr/bin/env python3
"""Add proposal controls and a worker tick without replacing deployed Kwork features."""
import ast
from pathlib import Path
import sys
from install_brief_hooks import modify_function


def patch(text):
    if 'import kwork_negotiation as negotiation_integration' in text: return text
    text = text.replace('import requests\n', 'import requests\nimport kwork_negotiation as negotiation_integration\n', 1)
    text = modify_function(text, 'handle_callback', lambda f: f.replace('    brief_result=',
        '    negotiation_result=negotiation_integration.callback(state,cb,owner,api)\n    if negotiation_result is not None:return negotiation_result\n    brief_result=', 1))
    if any(isinstance(n, ast.FunctionDef) and n.name == 'handle_message' for n in ast.parse(text).body):
        text = modify_function(text, 'handle_message', lambda f: f.replace('\n',
            "\n    if negotiation_integration.message(state,msg,int(config()['owner_chat_id']),api):return\n", 1))
    else:
        text = text.replace("                elif update.get('message',{}).get('chat',{}).get('id')==owner:\n",
            "                elif update.get('message',{}).get('chat',{}).get('id')==owner:\n                    if negotiation_integration.message(state,update['message'],owner,api):\n                        state.offset(update['update_id']+1);continue\n", 1)
    text = modify_function(text, 'work', lambda f: f.replace('        job=state.claim()',
        '        negotiation_integration.tick(state,owner,api)\n        job=state.claim()', 1))
    ast.parse(text)
    for hook in ('callback','message','tick'):
        if text.count('negotiation_integration.'+hook+'(')!=1:
            raise ValueError('Unsupported Kwork code: hook '+hook+' was not installed exactly once')
    return text


if __name__ == '__main__':
    path = Path(sys.argv[1]); output = patch(path.read_text()); path.write_text(output)
    print('Negotiation hooks installed')
