import asyncio
import httpx
import pytest
from pydantic import ValidationError
import os
os.environ['DATA_DIR']='/tmp/qubite-search-tests-'+str(os.getpid())
os.environ['PROXY_SECRET']='test-proxy-secret'
os.environ['OPENROUTER_API_KEY']='unused-test-key'
os.environ['OWNER_USER']='kirill'
os.environ['QUBITE_INTERNAL_URL']=''
os.environ['SERVICES_INTERNAL_KEY']='test-internal-key'
import app
from search_engines import catalogue,measurements

def test_catalogue_excludes_paid_and_irrelevant_engines():
    rows=catalogue({'engines':[{'name':'yandex','categories':['general'],'enabled':True,'safesearch':False}, {'name':'yandex_api','categories':['general'],'enabled':True}, {'name':'currency','categories':['general'],'enabled':True}]})
    assert [r['name'] for r in rows]==['yandex'] and not rows[0]['safesearch']

def test_real_timings_and_merged_origins():
    rows=measurements('total;dur=98, total_0_google cse;dur=80.43, load_0_google cse;dur=60, total_1_yandex;dur=NaN',[{'engines':['google cse','yandex']}],[['yandex','captcha']],['google cse','yandex'])
    assert rows[0]==dict(engine='google cse',elapsed_ms=80.4,network_ms=60,results=1,error=None)
    assert rows[1]['elapsed_ms'] is None and rows[1]['error']=='captcha' and rows[1]['results']==1

@pytest.mark.parametrize('field,value',[('safesearch',3),('language','foo'),('time_range','decade'),('engines',['x']*26)])
def test_filters_are_bounded(field,value):
    with pytest.raises(ValidationError):app.SearchBody(query='test',**{field:value})

def setup_search(monkeypatch):
    rows=[dict(name=n,categories=['general'],enabled=True,safesearch=n!='yandex',time_range=True) for n in ['duckduckgo','yandex']]
    async def config():return rows
    monkeypatch.setattr(app,'engine_catalogue',config);monkeypatch.setattr(app,'spell',None)
    async def no_wiki(q):return None
    monkeypatch.setattr(app,'wikipedia',no_wiki)
    return rows

def test_selected_engines_do_not_add_category_defaults(monkeypatch):
    setup_search(monkeypatch);requests=[]
    def transport(request):
        requests.append(request)
        return httpx.Response(200,headers={'Server-Timing':'total_0_yandex;dur=12.4'},json={'results':[{'url':'https://example.com/a','title':'one','engines':['yandex','duckduckgo'],'engine':'yandex','length':'2:30'}]})
    original=httpx.AsyncClient
    monkeypatch.setattr(app.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(transport)))
    result=asyncio.run(app.perform_search('kirill',app.SearchBody(query='example',engines=['yandex'],language='ru-RU',time_range='week',safesearch=0),record=False))
    params=requests[0].url.params
    assert params['engines']=='yandex' and 'categories' not in params
    assert params['language']=='ru-RU' and params['time_range']=='week' and params['safesearch']=='0'
    assert result['results'][0]['engines']==['yandex','duckduckgo'] and result['results'][0]['duration']=='2:30'
    assert result['engine_timings'][0]['elapsed_ms']==12.4 and result['elapsed_ms']>=0

@pytest.mark.parametrize('engines',[[],['unknown'],['yandex']])
def test_empty_unknown_and_strict_unsupported_rejected(monkeypatch,engines):
    setup_search(monkeypatch)
    with pytest.raises(app.HTTPException) as error:asyncio.run(app.perform_search('kirill',app.SearchBody(query='test',engines=engines,safesearch=2),record=False))
    assert error.value.status_code==400

def test_strict_excludes_unsupported_without_silent_downgrade(monkeypatch):
    setup_search(monkeypatch);requests=[]
    original=httpx.AsyncClient
    def transport(request):requests.append(request);return httpx.Response(200,json={'results':[]})
    monkeypatch.setattr(app.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(transport)))
    result=asyncio.run(app.perform_search('kirill',app.SearchBody(query='test',safesearch=2),record=False))
    assert requests[0].url.params['engines']=='duckduckgo'
    assert any('исключён' in w for w in result['filter_warnings'])
