#!/usr/bin/env python3
"""Private stdio bridge to native MCP; no credentials or destructive tools are exposed."""
import argparse
import asyncio
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.server.models import InitializationOptions
from mcp.server import NotificationOptions
from mcp import types

ALLOWED={
 'memos':{'memo_list_memos','memo_get_memo','memo_create_memo','memo_update_memo','space_list_spaces','space_get_space','memo_list_memo_comments'},
 'vikunja':{'tasks_list','tasks_read','tasks_create','tasks_update','projects_list','projects_read','projects_create','projects_update'},
}
URLS={'memos':'http://127.0.0.1:5230/mcp','vikunja':'http://127.0.0.1:3456/api/v2/mcp'}

class NativeClient:
 def __init__(self,name,token):
  self.url=URLS[name];self.headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream'};self.lock=threading.Lock();self.sequence=0;self.initialized=False
 def request(self,method,params):
  self.sequence+=1
  q=urllib.request.Request(self.url,json.dumps({'jsonrpc':'2.0','id':self.sequence,'method':method,'params':params}).encode(),self.headers)
  with urllib.request.urlopen(q,timeout=35) as r:
   sid=r.headers.get('Mcp-Session-Id')
   if sid:self.headers['Mcp-Session-Id']=sid
   raw=r.read(262145)
   if len(raw)>262144:raise RuntimeError('Ответ слишком большой; уточни запрос или пагинацию.')
   text=raw.decode()
   if text.startswith(('event:','data:')):text=next(line[6:] for line in text.splitlines() if line.startswith('data: '))
   return json.loads(text)
 def call(self,name,args):
  with self.lock:
   if not self.initialized:
    init=self.request('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'Qubite knowledge bridge','version':'1'}})
    if 'error' in init:raise RuntimeError('MCP не инициализирован.')
    self.initialized=True
   return self.request('tools/call',{'name':name,'arguments':args})

def definitions(directory):
 result={}
 for service,names in ALLOWED.items():
  tools=json.loads((Path(directory)/(service+'-tools.json')).read_text())
  for t in tools:
   if t['name'] in names:result[service+'_'+t['name']]=(service,t)
 return result

async def main():
 parser=argparse.ArgumentParser();parser.add_argument('--credentials-file',required=True);parser.add_argument('--schemas',required=True);args=parser.parse_args()
 credentials=json.loads(Path(args.credentials_file).read_text());tools=definitions(args.schemas)
 clients={k:NativeClient(k,credentials[k]) for k in ALLOWED}
 server=Server('qubite-knowledge')
 @server.list_tools()
 async def list_tools():
  return [types.Tool(name=name,description=t.get('description','')[:900],inputSchema=t['inputSchema']) for name,(_,t) in tools.items()]
 @server.call_tool()
 async def call_tool(name,arguments):
  if name not in tools:return types.CallToolResult(content=[types.TextContent(type='text',text='Операция запрещена.')],isError=True)
  service,t=tools[name]
  try:
   response=await asyncio.to_thread(clients[service].call,t['name'],arguments or {})
   if 'error' in response:raise RuntimeError('MCP отклонил запрос. Проверь аргументы по схеме инструмента.')
   result=response.get('result',{});content=[]
   for item in result.get('content',[]):
    if item.get('type')=='text':content.append(types.TextContent(type='text',text=item.get('text','')))
   return types.CallToolResult(content=content,isError=bool(result.get('isError',False)))
  except Exception:
   return types.CallToolResult(content=[types.TextContent(type='text',text='Сервис недоступен либо отклонил запрос. Проверь, включён ли он, и аргументы. Секреты скрыты.')],isError=True)
 async with stdio_server() as (reader,writer):
  await server.run(reader,writer,InitializationOptions(server_name='qubite-knowledge',server_version='1',capabilities=server.get_capabilities(notification_options=NotificationOptions(),experimental_capabilities={})))

if __name__=='__main__':asyncio.run(main())
