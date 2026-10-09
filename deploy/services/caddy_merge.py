"""Merge Qubite web routes into the existing NaiveProxy master configuration."""
import re

def portal_routes(app_port,auth_port,expected_host=None):
    content=f''' @auth path /service-enroll /knowledge-enroll.js /privacy.html /terms.html /acceptable-use.html /security.html /auth /auth/* /services/return /service-invite /api/auth/* /api/public/config /api/status /internal/services/* /api/services/* /api/owner/services/* /writing /writing-assets/* /api/writing/* /front/* /design-system
 handle @auth {{
  reverse_proxy 127.0.0.1:{auth_port}
 }}
 handle {{
  reverse_proxy 127.0.0.1:{app_port}
 }}
 handle_errors {{
  @home path / /index.html
  redir @home /auth 302
  respond "Основной сайт временно выключен. Qubite Auth и другие сервисы доступны." 503
 }}'''


    if expected_host:
        routes, errors = content.split(' handle_errors', 1)
        content = f' @wrongHost not host {expected_host}\n route {{\n respond @wrongHost "Unknown host" 404\n'+routes+'\n }\n handle_errors'+errors
    return content

def knowledge_route(host, service, auth_port, native_port, key):
    if service not in ('memos','vikunja'):raise ValueError('Unknown knowledge service')
    login='/api/v1/auth/signin' if service=='memos' else '/api/v1/login'
    info='/api/v1/instance/profile' if service=='memos' else '/api/v1/info /api/v2/info'
    refresh=f'''
  handle @nativeRefresh {{
   rewrite * /internal/services/knowledge-refresh?service={service}
   reverse_proxy 127.0.0.1:{auth_port} {{
    header_up X-Qubite-Service-Key {key}
   }}
  }}''' if service=='memos' else ''
    return f''' @wrongHost not host {host}
 @nativeInfo {{
  method GET
  path {info}
 }}
 @nativeLogin {{
  method POST
  path {login}
 }}
 @nativeRefresh {{
  method POST
  path /api/v1/auth/refresh
 }}
 @nativeApi path /api/*
 route {{
  respond @wrongHost "Unknown host" 404
  handle @nativeInfo {{
   reverse_proxy 127.0.0.1:{native_port}
  }}
  handle @nativeLogin {{
   rewrite * /internal/services/knowledge-login?service={service}
   reverse_proxy 127.0.0.1:{auth_port} {{
    header_up X-Qubite-Service-Key {key}
   }}
  }}{refresh}
  handle @nativeApi {{
   forward_auth 127.0.0.1:{auth_port} {{
    uri /internal/services/knowledge-api?service={service}
    header_up X-Qubite-Service-Key {key}
   }}
   reverse_proxy 127.0.0.1:{native_port} {{
    header_up X-Forwarded-Proto https
   }}
  }}
  handle {{
   forward_auth 127.0.0.1:{auth_port} {{
    uri /internal/services/browser-access?service={service}
    header_up X-Qubite-Service-Key {key}
   }}
   reverse_proxy 127.0.0.1:{native_port} {{
    header_up X-Forwarded-Proto https
   }}
  }}
 }}'''

def merge_master(original,main,app_port,auth_port=None):
    # The legacy installer owns one main-site vhost through localhost:8080.
    host=re.escape(main)
    pattern=r'(?m)^https://'+host+r'(?P<extra>[^\n{]*)\s*\{\s*\n\s*reverse_proxy localhost:8080\s*\n\}'
    route=portal_routes(app_port,auth_port) if auth_port else ' reverse_proxy 127.0.0.1:'+str(app_port)
    updated,count=re.subn(pattern,lambda m:'https://'+main+m.group('extra')+' {\n'+route+'\n}',original)
    if count>1:raise ValueError('Ambiguous master site configuration')
    if not count and re.search(r'(?m)^(?:https://)?'+host+r'(?:[,\s]|\{)',original):
        raise ValueError('Main hostname already has a custom Caddy vhost: merge its upstream manually')
    return updated,bool(count)
