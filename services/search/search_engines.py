"""Public engine catalogue and real SearXNG Server-Timing measurements."""
import math
import re
from collections import Counter

CATEGORIES = ('general', 'images', 'videos', 'news')
ALLOWED = {
 'general': {'google', 'google cse', 'bing', 'duckduckgo', 'yandex', 'yahoo', 'brave', 'startpage', 'qwant', 'mojeek', 'wikipedia', 'wikidata'},
 'images': {'bing images', 'duckduckgo images', 'google images', 'google cse images', 'yandex images', 'brave.images', 'wikicommons.images', 'pinterest'},
 'videos': {'bing videos', 'duckduckgo videos', 'google videos', 'youtube', 'vimeo', 'dailymotion', 'sepiasearch', 'wikicommons.videos', 'brave.videos'},
 'news': {'bing news', 'duckduckgo news', 'google news', 'reuters', 'wikinews', 'brave.news', 'yahoo news'},
}

def catalogue(data):
    rows=[]
    for e in data.get('engines', []):
        name=e.get('name')
        categories=[c for c in CATEGORIES if c in e.get('categories',[]) and name in ALLOWED[c]]
        if categories:
            rows.append(dict(name=name,categories=categories,enabled=bool(e.get('enabled')),safesearch=bool(e.get('safesearch')),time_range=bool(e.get('time_range_support'))))
    return rows

def measurements(header, results, errors, selected):
    rows={name:dict(engine=name,elapsed_ms=None,network_ms=None,results=0,error=None) for name in selected}
    for value in str(header or '')[:16000].split(','):
        m=re.fullmatch(r'\s*(total|load)_\d+_(.+?);dur=([\d.]+)\s*',value)
        if not m:continue
        kind,name,raw=m.groups()
        try:duration=float(raw)
        except ValueError:continue
        if not math.isfinite(duration) or duration<0:continue
        row=rows.setdefault(name,dict(engine=name,elapsed_ms=None,network_ms=None,results=0,error=None))
        row['elapsed_ms' if kind=='total' else 'network_ms']=round(duration,1)
    counts=Counter(e for x in results for e in x['engines'])
    for name,count in counts.items():
        rows.setdefault(name,dict(engine=name,elapsed_ms=None,network_ms=None,results=0,error=None))['results']=count
    for name,error in errors:
        rows.setdefault(name,dict(engine=name,elapsed_ms=None,network_ms=None,results=0,error=None))['error']=error
    return list(rows.values())
