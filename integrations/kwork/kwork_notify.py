#!/home/kirill/.hermes/venvs/kwork-parser/bin/python3
"""Send a prepared Kwork notification to the owner's existing Telegram topic."""
import argparse
import json
from pathlib import Path
import sys
import time

from kwork_bot import State, config, api, keyboard
import requests

import kwork_parser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--order-id')
    group.add_argument('--order-ids',nargs='+')
    args = parser.parse_args()
    ids=args.order_ids or [args.order_id]
    if not 1<=len(ids)<=8 or any(not oid.isdigit() for oid in ids):
        parser.error('order-id must contain digits')
    payload = json.load(sys.stdin)
    text = payload.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 4096:
        raise ValueError('Telegram text must contain 1..4096 characters')
    if len(ids)!=1:raise ValueError('Send one order per card')
    state=State();row=state.get(ids[0])
    if not row:raise ValueError('Order must be saved before notification')
    if row['deleted'] or row['message_id']:
        message_id=row['message_id']
    else:
        outgoing={'chat_id':int(config()['owner_chat_id']),'text':text,
                  'reply_markup':keyboard(ids[0],bool(payload.get('ready')))}
        if payload.get('parse_mode') in ('Markdown','MarkdownV2','HTML'):
            outgoing['parse_mode']=payload['parse_mode']
        try:message_id=api('sendMessage',outgoing)['message_id']
        except RuntimeError:
            print(json.dumps({'ok':False,'error':'Telegram delivery failed; order not acknowledged'}));return 1
        state.sent(ids[0],message_id,bool(payload.get('ready')))
    with (kwork_parser.DATA / 'kwork_parser.lock').open('w') as lock:
        kwork_parser.fcntl.flock(lock, kwork_parser.fcntl.LOCK_EX)
        kwork_parser.acknowledge(ids)
    print(json.dumps({'ok': True, 'message_id': message_id, 'acknowledged': ids if args.order_ids else ids[0]}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
