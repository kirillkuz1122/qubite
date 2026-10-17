#!/usr/bin/env python3
"""Patch the existing voice listener; keep its client, session, blocklist and Hermes STT."""
import ast
from pathlib import Path
import sys


def patch(source):
    if 'from negotiation_personal import' in source: return source
    required = ['    work_lock = asyncio.Lock()', '    async def handler(event):',
                '    await client.run_until_disconnected()', '        kind = "🎙 Голосовое"']
    if any(source.count(x)!=1 for x in required): raise ValueError('Unsupported listener; inspect live code first')
    source = source.replace('import tempfile\n', 'import tempfile\nimport sys\nfrom pathlib import Path\n\nsys.path.insert(0,str(Path.home()/"services/qubite-specbot/app"))\nfrom negotiation_personal import forward_event, outbound_loop\n',1)
    source = source.replace('    work_lock = asyncio.Lock()',
        '    work_lock = asyncio.Lock()\n    negotiation_policy = lambda uid, username: not is_blocked(uid,username)\n    negotiation_sender = asyncio.create_task(outbound_loop(client,negotiation_policy))',1)
    source = source.replace('    async def handler(event):',
        '    async def handler(event):\n        if not (event.message.voice or event.message.audio or event.message.video_note):\n            await forward_event(event,negotiation_policy)\n            return',1)
    source = source.replace('        kind = "🎙 Голосовое"',
        '        if text and not text.startswith("(ошибка") and text != "(не расслышал)":\n            await forward_event(event,negotiation_policy,text)\n\n        kind = "🎙 Голосовое"',1)
    source = source.replace('    await client.run_until_disconnected()',
        '    try:\n        await client.run_until_disconnected()\n    finally:\n        negotiation_sender.cancel()\n        await asyncio.gather(negotiation_sender,return_exceptions=True)',1)
    ast.parse(source)
    return source


if __name__=='__main__':
    path=Path(sys.argv[1]); output=patch(path.read_text());path.write_text(output)
    print('Existing personal listener patched; no second Telegram session')
