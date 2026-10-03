"""Portable Qubite search client: stdlib only, no credentials in CLI arguments."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import quote
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

class APIError(RuntimeError):pass

def settings():
    config={};path=os.environ.get('QUBITE_SEARCH_CONFIG')
    if path:
        p=Path(path).expanduser()
        if p.stat().st_mode&0o077:raise APIError('Credential file must have permissions 0600')
        config=json.loads(p.read_text())
    key=os.environ.get('QUBITE_SEARCH_API_KEY') or config.get('api_key','')
    base=os.environ.get('QUBITE_SEARCH_API_URL') or config.get('base_url','https://search.qubiteapp.online')
    if not key.startswith('qbs_'):raise APIError('Configure QUBITE_SEARCH_API_KEY or a private QUBITE_SEARCH_CONFIG file')
    if not base.startswith('https://') and not base.startswith(('http://127.0.0.1:','http://localhost:')):raise APIError('Use HTTPS (loopback HTTP is allowed)')
    host=os.environ.get('QUBITE_SEARCH_HOST_HEADER') or config.get('host_header')
    if host and any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:' for c in host):raise APIError('Invalid Host header')
    return base.rstrip('/'),key,host

def call(path,payload=None):
    base,key,host=settings();raw=json.dumps(payload,ensure_ascii=False).encode() if payload is not None else None
    headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','User-Agent':'QubiteAgentClient/1.0'}
    if host:headers['Host']=host
    request=Request(base+path,data=raw,headers=headers)
    try:
        with urlopen(request,timeout=40) as response:
            body=response.read(5_000_001)
            if len(body)>5_000_000:raise APIError('Response too large')
            return json.loads(body)
    except HTTPError as error:
        try:detail=json.loads(error.read(4096)).get('detail','Request failed')
        except Exception:detail='Request failed'
        raise APIError('HTTP '+str(error.code)+': '+str(detail)) from None
    except (URLError,TimeoutError):raise APIError('Qubite connection failed') from None

def search(query,mode='summary',limit=4):
    result=call('/api/v1/search',{'query':query,'mode':mode,'limit':limit})
    if result.get('job_id'):
        job_id=result['job_id'];deadline=time.monotonic()+100
        while time.monotonic()<deadline:
            time.sleep(1.2);job=call('/api/v1/jobs/'+quote(job_id,safe=''))
            if job['status']=='done':return job['result']
            if job['status']=='error':raise APIError(job.get('error','Search failed'))
        raise APIError('Job is still pending: '+job_id+'; query /api/v1/jobs/<id> later')
    return result

def fetch(url,mode='markdown'):return call('/api/v1/fetch',{'url':url,'mode':mode})
def history(item_id=None):return call('/api/v1/history'+('/'+quote(item_id,safe='') if item_id else ''))

def main():
    parser=argparse.ArgumentParser(description='Qubite search / source extraction / opt-in history')
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('search');p.add_argument('query');p.add_argument('--mode',choices=['summary','sources'],default='summary');p.add_argument('--limit',type=int,default=4)
    p=sub.add_parser('fetch');p.add_argument('url');p.add_argument('--mode',choices=['markdown','summary','html'],default='markdown')
    p=sub.add_parser('history');p.add_argument('id',nargs='?')
    args=parser.parse_args()
    try:
        result=search(args.query,args.mode,args.limit) if args.command=='search' else fetch(args.url,args.mode) if args.command=='fetch' else history(args.id)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except APIError as error:print(str(error),file=sys.stderr);return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
