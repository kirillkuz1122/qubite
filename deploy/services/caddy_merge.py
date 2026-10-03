"""Merge Qubite web routes into the existing NaiveProxy master configuration."""
import re

def merge_master(original,main,app_port):
    # The legacy installer owns one main-site vhost through localhost:8080.
    host=re.escape(main)
    pattern=r'(?m)^https://'+host+r'(?P<extra>[^\n{]*)\s*\{\s*\n\s*reverse_proxy localhost:8080\s*\n\}'
    updated,count=re.subn(pattern,lambda m:'https://'+main+m.group('extra')+' {\n reverse_proxy 127.0.0.1:'+str(app_port)+'\n}',original)
    if count>1:raise ValueError('Ambiguous master site configuration')
    if not count and re.search(r'(?m)^(?:https://)?'+host+r'(?:[,\s]|\{)',original):
        raise ValueError('Main hostname already has a custom Caddy vhost: merge its upstream manually')
    return updated,bool(count)
