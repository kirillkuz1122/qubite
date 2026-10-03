"""Hermes/Codex stdio MCP adapter. Credentials come from a private config file."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'skills/qubite-search/scripts'))
from qubite_api import search,fetch,history,APIError
from mcp.server.fastmcp import FastMCP
mcp=FastMCP('Qubite Search')

async def invoke(fn,*args):
    try:return json.dumps(await asyncio.to_thread(fn,*args),ensure_ascii=False)
    except APIError as error:return json.dumps({'error':str(error)},ensure_ascii=False)

@mcp.tool()
async def qubite_search(query:str,mode:str='summary',limit:int=4)->str:
    """Search public sites. summary returns concise exact Markdown with sources; sources skips AI cost. Use narrow queries."""
    if mode not in ('summary','sources'):return 'Invalid mode'
    return await invoke(search,query,mode,max(1,min(5,limit)))

@mcp.tool()
async def qubite_fetch(url:str,mode:str='markdown')->str:
    """Read ONE public page. markdown extracts without AI; summary compresses with AI; html returns bounded original HTML as data. No private networks."""
    if mode not in ('markdown','summary','html'):return 'Invalid mode'
    return await invoke(fetch,url,mode)

@mcp.tool()
async def qubite_history(item_id:str='')->str:
    """Read authorized account's opt-in history. Empty id lists titles/searches; an id reads the selected item. Use only when relevant to user's request."""
    return await invoke(history,item_id or None)

if __name__=='__main__':mcp.run(transport='stdio')
