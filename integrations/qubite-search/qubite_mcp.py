"""Hermes/Codex stdio MCP adapter. Credentials come from a private config file."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'skills/qubite-search/scripts'))
from qubite_api import search,fetch,history,verification,APIError
from mcp.server.fastmcp import FastMCP
mcp=FastMCP('Qubite Search')

async def invoke(fn,*args):
    try:return json.dumps(await asyncio.to_thread(fn,*args),ensure_ascii=False)
    except APIError as error:return json.dumps({'error':str(error)},ensure_ascii=False)

@mcp.tool()
async def qubite_search(query:str,mode:str='summary',limit:int=4,verify:bool | None=None)->str:
    """Search public sites. summary returns concise exact Markdown with sources; sources skips AI cost. Use narrow queries."""
    if mode not in ('summary','sources'):return 'Invalid mode'
    return await invoke(search,query,mode,max(1,min(5,limit)),verify)

@mcp.tool()
async def qubite_fetch(url:str,mode:str='markdown',verify:bool | None=None)->str:
    """Read ONE public page. markdown extracts without AI; summary compresses with AI; html returns bounded original HTML as data. No private networks."""
    if mode not in ('markdown','summary','html'):return 'Invalid mode'
    return await invoke(fetch,url,mode,verify)

@mcp.tool()
async def qubite_verify(verification_id:str,source:str='search')->str:
    """One paid Jev check of an existing answer, without a new search/generation. Requires same key, paid grant, and a live result (30 minutes). Already checked results are reused."""
    if source not in ('search','fetch'):return 'Invalid source'
    return await invoke(verification,verification_id,source)

@mcp.tool()
async def qubite_history(item_id:str='')->str:
    """Read authorized account's opt-in history. Empty id lists titles/searches; an id reads the selected item. Use only when relevant to user's request."""
    return await invoke(history,item_id or None)

if __name__=='__main__':mcp.run(transport='stdio')
