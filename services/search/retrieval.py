"""Bounded web retrieval with public-IP pinning and readable Markdown extraction."""
import asyncio
import ipaddress
import re
import socket
import shutil
import subprocess
import time
from urllib.parse import urlparse, urljoin, quote

import httpx
import trafilatura
from bs4 import BeautifulSoup
from spellchecker import SpellChecker

UA = 'QubiteSearch/1.0 (personal research; compatible; +https://search.qubiteapp.online)'
LIMIT = 1500000
semaphore = asyncio.Semaphore(3)
cache = {}
reader_until = 0


def validate_url(url):
    p = urlparse(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Нужен публичный HTTP(S)-адрес.')
    if p.port not in (None, 80, 443):
        raise ValueError('Нестандартный порт запрещён.')
    return p


async def pinned_url(url):
    p = validate_url(url)
    addresses = await asyncio.get_running_loop().getaddrinfo(p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    ips = {item[4][0] for item in addresses}
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError('Локальные и служебные адреса запрещены.')
    ip = sorted(ips, key=lambda x: ':' in x)[0]
    host = '['+ip+']' if ':' in ip else ip
    target = httpx.URL(url).copy_with(host=ip)
    return target, p.hostname, p.netloc


async def fetch_public(url, image=False):
    async with semaphore:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12, connect=5), follow_redirects=False, trust_env=False) as client:
            for _ in range(5):
                target, hostname, host_header = await pinned_url(url)
                async with client.stream('GET', target, headers={'Host': host_header, 'User-Agent': UA}, extensions={'sni_hostname': hostname}) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        url = urljoin(url, r.headers.get('location', ''))
                        continue
                    r.raise_for_status()
                    ct = r.headers.get('content-type', '').split(';')[0].lower()
                    allowed = {'image/jpeg','image/png','image/webp','image/gif','image/avif'} if image else {'text/html','application/xhtml+xml','text/plain','text/markdown'}
                    if ct not in allowed:
                        raise ValueError('Формат страницы не поддерживается.')
                    if int(r.headers.get('content-length', '0')) > LIMIT:
                        raise ValueError('Страница слишком большая.')
                    body = bytearray()
                    async for chunk in r.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > LIMIT:
                            raise ValueError('Страница слишком большая.')
                    return bytes(body), ct, str(url)
            raise ValueError('Слишком много переадресаций.')


async def read_page(item):
    global reader_until
    url = item['url']
    hit = cache.get(url)
    if hit and time.time()-hit[0] < (900 if hit[1]['status']=='read' else 60):
        return hit[1].copy()
    result = {'url': url, 'title': item.get('title', url), 'status': 'unread', 'text': '', 'snippet': item.get('content', '')[:900]}
    try:
        body, ct, final = await fetch_public(url)
        if ct in ('text/plain','text/markdown'):
            text = body.decode('utf-8', 'replace')
        else:
            text = await asyncio.to_thread(trafilatura.extract, body, output_format='markdown', include_links=True, include_images=False, include_tables=True, favor_precision=True)
        if not text or len(text.strip()) < 100:
            raise ValueError('Основной текст не удалось извлечь.')
        if re.search(r'(?i)(verify you are human|just a moment|enable javascript and cookies|проверка браузера)', text[:600]):
            raise ValueError('Сайт требует проверку браузера.')
        result.update(text=text[:16000], status='read', final_url=final)
    except (httpx.HTTPError, ValueError, OSError):
        result['reason'] = 'Страница недоступна или требует проверку. Есть только поисковый фрагмент.'
        # Anonymous public reader as an optional free path; never forward private URLs.
        if time.time()>=reader_until:
            try:
                await pinned_url(url)
                body,ct,_=await fetch_public('https://r.jina.ai/'+url)
                text=body.decode('utf-8','replace')
                if 'Markdown Content:' not in text:
                    raise ValueError('Reader did not return a document')
                text=text.split('Markdown Content:',1)[1].strip()
                if len(text)<100 or re.search(r'(?i)(verify you are human|just a moment|checking your browser|проверка браузера)',text[:900]):
                    raise ValueError('Reader returned a challenge')
                result.update(text=text[:16000],status='read',via='jina-reader')
                result.pop('reason',None)
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (401,402,429):reader_until=time.time()+300
            except (httpx.HTTPError,ValueError,OSError):
                pass
    cache[url] = (time.time(), result.copy())
    if len(cache) > 200:
        cache.pop(next(iter(cache)))
    return result


async def wikipedia(query):
    """A genuine short encyclopedic extract, not an LLM-written substitute."""
    query = re.sub(r'^(что такое|кто такой|кто такая|что значит|что означает)\s+', '', query, flags=re.I).rstrip('?').strip()
    if not query or len(query) > 150:
        return None
    lang = 'ru' if re.search('[а-яё]', query, re.I) else 'en'
    try:
        async with httpx.AsyncClient(timeout=4, headers={'User-Agent': UA}) as client:
            r = await client.get(f'https://{lang}.wikipedia.org/w/api.php', params={'action':'query','format':'json','generator':'search','gsrsearch':query,'gsrlimit':1,'prop':'extracts|info|pageimages','exintro':1,'explaintext':1,'exsentences':3,'inprop':'url','pithumbsize':600})
            r.raise_for_status()
            pages = r.json().get('query',{}).get('pages',{})
            p = next(iter(pages.values()), {})
            text = p.get('extract', '').strip()
            if not text:
                return None
            return {'title':p['title'],'text':text[:1400],'url':p.get('fullurl') or f'https://{lang}.wikipedia.org/wiki/'+quote(p['title']),'image':p.get('thumbnail',{}).get('source'),'kind':'wikipedia'}
    except (httpx.HTTPError, ValueError):
        return None


def translation_intent(query):
    m = re.match(r'^(.{1,700}?)\s+(?:на\s+|по[- ])(русском|русский|английском|английский|русски|английски)\s*[?!.]*$', query, re.I)
    if not m:
        m = re.match(r'^(?:переведи|перевод)\s+(.{1,700}?)\s+(?:на\s+)?(русский|английский)\s*[?!.]*$', query, re.I)
    if m:
        text, lang = m.groups()
        if 'рус' in lang and re.search('[a-z]', text, re.I) or 'англ' in lang and re.search('[а-яё]', text, re.I):
            return {'text':text,'target':'ru' if 'рус' in lang else 'en','source':'en' if 'рус' in lang else 'ru'}
    return None


class Spelling:
    def __init__(self):
        self.hunspell = shutil.which('hunspell')
        self.ru = SpellChecker(language='ru', distance=1)
        self.en = SpellChecker(language='en', distance=1)
        self.keep = {'searxng','qubite','qubiteapp','tailscale','aliasvault','hermes','omniroute','openrouter','deepinfra','novita','glm','глм','джев','мимо','jev','xiaomi','mimo','gmicloud','fp4','fp8','bf16','sing','raspberry','linux','javascript','typescript','python','chatgpt','nemo'}
        self.layout = str.maketrans("qwertyuiop[]asdfghjkl;'zxcvbnm,.", 'йцукенгшщзхъфывапролджэячсмитьбю')
        self.names = {'москва','москве','москвы','москву','петербург','петербурге','екатеринбург','екатеринбурге','россия','россии','казань','казани','нейросеть','нейросети','нейронка','опенроутер','теилскеил','тэилскеил','разбери','ксиоми','флеш','кворк'}

    @staticmethod
    def near(a,b):
        if abs(len(a)-len(b))>1:
            return False
        if len(a)==len(b):
            return sum(x!=y for x,y in zip(a,b))==1
        if len(a)>len(b):
            a,b=b,a
        return any(b[:i]+b[i+1:]==a for i in range(len(b)))

    def correct(self, query):
        if translation_intent(query) or 'http' in query or 'site:' in query:
            return query
        # Fix an accidentally selected keyboard layout only with strong dictionary evidence.
        tokens = re.findall(r'[a-z]+', query.lower())
        if tokens and not re.search('[а-яё]', query, re.I) and all(len(t) >= 3 for t in tokens):
            converted = [t.translate(self.layout) for t in tokens]
            if sum(t in self.en for t in tokens)==0 and sum(t in self.ru for t in converted) >= max(1, len(tokens)*.8):
                query = query.lower().translate(self.layout)
        def fix(m):
            token=m.group(); lower=token.lower()
            if len(token)<4 or lower in self.keep or lower in self.names or token.isupper() or any(ch.isdigit() for ch in token):
                return token
            case=lambda word:word.capitalize() if token[0].isupper() else word
            nearby=[x for x in self.names if self.near(lower,x)]
            if len(nearby)==1:
                return case(nearby[0])
            if self.hunspell:
                try:
                    p = subprocess.run([self.hunspell,'-a','-i','UTF-8','-d','ru_RU,en_US'],input=lower+'\n',capture_output=True,text=True,timeout=2)
                    line = next((x for x in p.stdout.splitlines() if x.startswith('& ')), '')
                    if p.returncode==0:
                        if any(x.startswith(('*','+','-')) for x in p.stdout.splitlines()):
                            return token
                        candidate = line.split(': ',1)[-1].split(', ')[0] if line else ''
                        if candidate.isalpha() and abs(len(candidate)-len(token))<=1:
                            return case(candidate)
                except (OSError,subprocess.TimeoutExpired):
                    pass
            dictionary=self.ru if re.search('[а-яё]',lower) else self.en
            if lower in dictionary:
                return token
            choices=dictionary.candidates(lower) or set()
            best=max(choices,key=lambda x:dictionary.word_usage_frequency(x),default=lower)
            # Avoid turning obscure names into unrelated common words.
            if best != lower and dictionary.word_usage_frequency(best) >= .00002:
                return case(best)
            return token
        return re.sub(r'[a-zа-яё]+',fix,query,flags=re.I)


def plain(value):
    return BeautifulSoup(str(value or ''), 'html.parser').get_text(' ', strip=True)
