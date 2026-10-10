"""Add hooks to the current listener/Kwork, preserve independent live changes."""
import ast


def listener(source):
    if 'from leads_personal import' in source:return source
    required=['from negotiation_personal import forward_event, outbound_loop',
              '    @client.on(events.NewMessage)','    async def handler(event):',
              '        await asyncio.gather(negotiation_sender,return_exceptions=True)']
    if any(source.count(x)!=1 for x in required):raise ValueError('Unsupported listener')
    source=source.replace(required[0],required[0]+'\nfrom leads_personal import setup as lead_setup, forward as lead_forward',1)
    source=source.replace('    @client.on(events.NewMessage)',
        '    lead_setup_task = asyncio.create_task(lead_setup(client,negotiation_policy,notify))\n\n    @client.on(events.MessageEdited)\n    @client.on(events.NewMessage)',1)
    source=source.replace('    async def handler(event):','    async def handler(event):\n        await lead_forward(event,negotiation_policy)',1)
    source=source.replace(required[-1],required[-1]+'\n        lead_setup_task.cancel()\n        await asyncio.gather(lead_setup_task,return_exceptions=True)',1)
    ast.parse(source);return source


def kwork(source):
    if 'import kwork_leads as leads_integration' in source:return source
    for anchor in ['import kwork_negotiation as negotiation_integration',
                   '    negotiation_result=negotiation_integration.callback(state,cb,owner,api)',
                   'negotiation_integration.message(state,',
                   '        negotiation_integration.tick(state,owner,api)']:
        if source.count(anchor)!=1:raise ValueError('Unsupported Kwork hook')
    source=source.replace('import kwork_negotiation as negotiation_integration','import kwork_negotiation as negotiation_integration\nimport kwork_leads as leads_integration',1)
    source=source.replace('    negotiation_result=negotiation_integration.callback(state,cb,owner,api)',
        '    lead_result=leads_integration.callback(state,cb,owner,api)\n    if lead_result is not None:return lead_result\n    negotiation_result=negotiation_integration.callback(state,cb,owner,api)',1)
    lines=source.splitlines(True)
    for i,line in enumerate(lines):
        if 'negotiation_integration.message(state,' in line:
            # Insert an owner command check using the same control flow as the existing hook.
            block=[line.replace('negotiation_integration.message','leads_integration.message')]
            if line.rstrip().endswith(':'):
                indent=len(line)-len(line.lstrip())
                for body in lines[i+1:]:
                    if body.strip() and len(body)-len(body.lstrip())<=indent:break
                    block.append(body)
            lines[i:i]=block;break
    source=''.join(lines).replace('        negotiation_integration.tick(state,owner,api)',
        '        leads_integration.tick(state,owner,api)\n        negotiation_integration.tick(state,owner,api)',1)
    ast.parse(source);return source
