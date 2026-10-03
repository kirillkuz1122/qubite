from store import Store, LimitError
import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import pytest
os.environ['DATA_DIR']='/tmp/qubite-search-tests-'+str(os.getpid())
os.environ['PROXY_SECRET']='test-proxy-secret'
os.environ['OPENROUTER_API_KEY']='unused-test-key'
os.environ['OWNER_USER']='kirill'
os.environ['QUBITE_INTERNAL_URL']=''
os.environ['SERVICES_INTERNAL_KEY']='test-internal-key'
from fastapi.testclient import TestClient
import app
from store import Store,LimitError
from retrieval import translation_intent,pinned_url,Spelling

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(app,'store',Store(tmp_path))
    app.jobs.clear();app.searches.clear();app.reuse.clear();app.frames.clear();app.hits.clear()
    monkeypatch.setattr(app,'spell',None)
    with TestClient(app.app,headers={'x-qubite-proxy':'test-proxy-secret','x-qubite-user':'kirill'}) as c:
        yield c

def test_authentication_and_spoofing(client):
    assert client.get('/api/me',headers={'x-qubite-proxy':'wrong'}).status_code==401
    assert client.post('/api/search',json={'query':'hello'},headers={'origin':'https://evil.test'}).status_code==403
    assert client.get('/api/history',headers={'x-qubite-user':'friend'}).status_code==403
    assert len(client.get('/api/me',headers={'x-qubite-user':'friend'}).json()['models'])==1

def test_cookie_session_persists_and_logout_revokes(client):
    token=app.store.create_browser_session('kirill')
    headers={'x-qubite-user':'','cookie':app.SESSION_COOKIE+'='+token}
    assert client.get('/api/me',headers=headers).json()['owner'] is True
    response=client.post('/auth/logout',headers=headers)
    assert response.status_code==200 and 'Max-Age=0' in response.headers['set-cookie']
    assert client.get('/api/me',headers=headers).status_code==401

def test_login_redirect_preserves_browser_query_and_opensearch_is_public(client):
    response=client.get('/search?q=hello+world',headers={'x-qubite-user':''},follow_redirects=False)
    assert response.status_code==303 and 'next=' in response.headers['location'] and 'q%3Dhello' in response.headers['location']
    description=client.get('/opensearch.xml',headers={'x-qubite-user':''})
    assert description.status_code==200 and '/search?q={searchTerms}' in description.text

def test_cookie_token_is_not_stored_as_plaintext(tmp_path):
    s=Store(tmp_path);token=s.create_browser_session('friend')
    with s.connect() as c:
        row=c.execute('SELECT * FROM browser_sessions').fetchone()
    assert row['token_hash']!=token and s.browser_session_user(token)=='friend'

@pytest.mark.parametrize('value',['https://evil.test','//evil.test','/\\evil.test','/\r\nLocation:evil'])
def test_login_cannot_redirect_outside_site(value):
    assert app.local_next(value)=='/'

def test_guest_cannot_choose_paid_model(client):
    app.searches['s']={'user':'friend','query':'hello','created':time.time()}
    assert client.post('/api/answer',json={'search_id':'s','model':'deep'},headers={'x-qubite-user':'friend'}).status_code==403
    assert client.post('/api/answer',json={'search_id':'s','conversation':'owner-id'},headers={'x-qubite-user':'friend'}).status_code==403
    assert client.post('/api/answer',json={'search_id':'s'}).status_code==404

def test_atomic_budget(tmp_path):
    store=Store(tmp_path,budget=.01)
    def claim(_):
        try:return store.reserve('user','call',.004)
        except LimitError:return None
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims=list(pool.map(claim,range(8)))
    assert sum(c is not None for c in claims)==2
    assert store.usage()['reserved']==pytest.approx(.008)
    key=next(c for c in claims if c)
    store.settle(key,.001)
    assert store.usage()['remaining']==pytest.approx(.005)

def test_unknown_cost_stays_reserved(tmp_path):
    store=Store(tmp_path,budget=.01);key=store.reserve('u','call',.009)
    store.settle(key,None)
    with pytest.raises(LimitError):store.reserve('u','call',.002)

def test_guest_limit_persists_restart(tmp_path):
    s=Store(tmp_path)
    for _ in range(3):s.claim_guest('friend',10,3)
    with pytest.raises(LimitError):Store(tmp_path).claim_guest('friend',10,3)

def test_history_owner_isolation(tmp_path):
    s=Store(tmp_path);cid=s.save(None,'kirill','secret',{'answer_markdown':'private'})
    assert s.conversation(cid,'kirill')[0]['query']=='secret'
    with pytest.raises(PermissionError):s.conversation(cid,'friend')
    s.delete_history('kirill');assert s.history('kirill')==[]

def test_html_is_not_executable_in_main():
    text='<script>alert(1)</script> [1] [88] [bad](javascript:alert(2)) [made up](https://evil.test)'
    html=app.render_answer(text,[{'id':1,'url':'https://example.org'}])
    assert '<script>' not in html and 'href="javascript:' not in html and 'href="https://evil.test"' not in html
    assert '#source-1' in html and '#source-88' not in html

def test_visual_isolation():
    html=app.isolate_visual('<meta http-equiv="refresh" content="0;url=https://evil.test"><iframe src="https://evil.test"></iframe><script src="https://evil.test/x.js"></script><script>document.body.dataset.ok="yes"</script><img src="https://evil.test/a.png">')
    assert 'connect-src' in html and '<iframe' not in html and 'src="https://' not in html
    assert 'document.body.dataset.ok' in html

@pytest.mark.parametrize('url',['http://127.0.0.1/a','http://169.254.169.254/','http://[::1]/','file:///etc/passwd','http://localhost/a','https://user:pass@example.org/'])
def test_ssrf_denied(url):
    with pytest.raises((ValueError,OSError)):asyncio.run(pinned_url(url))

def test_translation_detection():
    assert translation_intent('hello world на русском')['target']=='ru'
    assert translation_intent('hello world на русском?')['text']=='hello world'
    assert translation_intent('добрый день на английском')['target']=='en'
    assert translation_intent('raspberry pi') is None

def test_real_spelling_preserves_models_and_corrects_capitalized_typo():
    spell=Spelling()
    assert spell.correct('Тилефон')=='Телефон'
    assert spell.correct('Глм 5.3 флеш')=='Глм 5.3 флеш'
    assert spell.correct('погода в маскве')=='погода в москве'

def test_reader_fallback_preserves_source_and_never_uses_private_url(monkeypatch):
    import retrieval
    retrieval.cache.clear();monkeypatch.setattr(retrieval,'reader_until',0)
    calls=[]
    async def pin(url):
        if '127.0.0.1' in url:raise ValueError('private')
        return None
    async def fetch(url):
        calls.append(url)
        if url.startswith('https://r.jina.ai/'):
            return ('Title: Public\nMarkdown Content:\n'+('Реальный текст страницы. '*20)).encode(),'text/plain',url
        raise ValueError('unread')
    monkeypatch.setattr(retrieval,'pinned_url',pin);monkeypatch.setattr(retrieval,'fetch_public',fetch)
    result=asyncio.run(retrieval.read_page({'url':'https://example.org','title':'Public'}))
    assert result['status']=='read' and result['via']=='jina-reader' and result['url']=='https://example.org'
    calls.clear()
    result=asyncio.run(retrieval.read_page({'url':'http://127.0.0.1','title':'Private'}))
    assert result['status']=='unread' and not any(x.startswith('https://r.jina.ai/') for x in calls)

def test_translation_has_separate_prompt_and_no_search_injection(tmp_path,monkeypatch):
    monkeypatch.setattr(app,'store',Store(tmp_path))
    async def classify(*args):return 'free',1,{}
    async def complete(user,mode,messages):
        assert messages[0]['content']==app.TRANSLATION_SYSTEM
        assert 'SOURCE DOCUMENTS' not in messages[1]['content']
        assert json.loads(messages[1]['content'])['text']=='hello world'
        return {'answer_markdown':'Привет, мир!','visuals':[],'model':'free','provider':'test','cost':0}
    import json
    monkeypatch.setattr(app,'classify',classify);monkeypatch.setattr(app,'complete',complete)
    search=make_search('hello world на русском')
    search['translation']=translation_intent(search['query'])
    app.jobs['translation']={'status':'running'}
    asyncio.run(app.build_answer('translation','kirill',app.AnswerBody(search_id='s'),search))
    assert app.jobs['translation']['result']['answer_markdown']=='Привет, мир!'

def make_search(query):
    return {'query':query,'candidate':{'title':'Марс','text':'Марс — четвёртая планета Солнечной системы.','url':'https://ru.wikipedia.org/wiki/Марс'},'results':[],'translation':None}

@pytest.mark.parametrize('query,expect_ai',[('Марс',False),('Марс?',True),('Марс?   ',True)])
def test_question_mark_forces_ai(tmp_path,monkeypatch,query,expect_ai):
    monkeypatch.setattr(app,'store',Store(tmp_path))
    calls=[]
    async def classify(*args):return 'free',.99,{'cost':0}
    async def complete(*args):
        calls.append(args[1])
        return {'answer_markdown':'Марс — четвёртая планета [1].','visuals':[],'image_indices':[],'model':'free','provider':'test','cost':0}
    monkeypatch.setattr(app,'classify',classify);monkeypatch.setattr(app,'complete',complete)
    jid='job-'+query;app.jobs[jid]={'status':'running'}
    asyncio.run(app.build_answer(jid,'kirill',app.AnswerBody(search_id='s'),make_search(query)))
    assert app.jobs[jid]['status']=='done'
    assert bool(calls)==expect_ai
    assert app.jobs[jid]['result']['kind']==('ai' if expect_ai else 'extract')

def test_guest_never_calls_jev_or_paid_and_never_saves(tmp_path,monkeypatch):
    s=Store(tmp_path);monkeypatch.setattr(app,'store',s)
    async def forbidden(*args):raise AssertionError('Jev called for guest')
    async def complete(user,mode,messages):
        assert mode=='free'
        return {'answer_markdown':'Ответ [1].','visuals':[],'image_indices':[],'model':'free','provider':'test','cost':0}
    monkeypatch.setattr(app,'classify',forbidden);monkeypatch.setattr(app,'complete',complete)
    app.jobs['guest']={'status':'running'}
    asyncio.run(app.build_answer('guest','friend',app.AnswerBody(search_id='s'),make_search('Марс')))
    assert app.jobs['guest']['status']=='done'
    assert s.history('friend')==[]
    assert 'conversation' not in app.jobs['guest']['result']

def test_glm_provider_order_and_no_arbitrary_fallback(monkeypatch):
    calls=[]
    async def router(user,path,body,*rates):
        calls.append(body)
        if len(calls)==1:raise app.UpstreamError('unavailable')
        return {'choices':[{'message':{'content':'{"answer_markdown":"OK","visuals":[]}'},'finish_reason':'stop'}],'usage':{'cost':.001}}
    monkeypatch.setattr(app,'openrouter',router)
    result=asyncio.run(app.complete('kirill','deep',[]))
    assert [c['provider']['only'] for c in calls]==[['deepinfra/fp4'],['novita/fp8']]
    assert all(c['provider']['allow_fallbacks'] is False for c in calls)
    assert result['provider']=='novita/fp8'

def test_limit_never_retries_paid_provider(monkeypatch):
    calls=[]
    async def router(*args):
        calls.append(1);raise LimitError('budget')
    monkeypatch.setattr(app,'openrouter',router)
    with pytest.raises(LimitError):asyncio.run(app.complete('kirill','deep',[]))
    assert len(calls)==1

def test_frame_access_and_csp(client):
    result={'visuals':[{'html':app.isolate_visual('<button id="a">Hi</button><script>document.getElementById("a").textContent="OK"</script>')}]}
    app.register_visuals(result,'kirill')
    vid=result['visuals'][0]['id']
    r=client.get('/api/visual/'+vid)
    assert r.status_code==200 and "'unsafe-inline'" in r.headers['content-security-policy']
    assert client.get('/api/visual/'+vid,headers={'x-qubite-user':'friend'}).status_code==404


def test_user_spending_caps_and_reservations(tmp_path):
    s=Store(tmp_path,budget=1)
    s.policies['qb:2']={'daily_usd':.03,'monthly_usd':.05,'lifetime_usd':.08}
    t=s.reserve('qb:2','model',.02)
    with pytest.raises(LimitError):s.reserve('qb:2','model',.02)
    s.settle(t,.01)
    s.reserve('qb:2','model',.02)
    s.reserve('qb:3','model',.1)


def test_encrypted_history_isolated_and_no_clear_text(tmp_path):
    s=Store(tmp_path)
    s.encrypted_put('qb:2','a'*32,'encrypted-payload')
    assert s.encrypted_list('qb:3')==[]
    with pytest.raises(PermissionError):s.encrypted_put('qb:3','a'*32,'other')
    s.encrypted_delete('qb:3','a'*32)
    assert len(s.encrypted_list('qb:2'))==1
    s.encrypted_delete('qb:2','a'*32)
    assert s.encrypted_list('qb:2')==[]

def test_internal_stats_require_both_secrets(client,monkeypatch):
    monkeypatch.setattr(app,'QUBITE_KEY','internal-secret')
    assert client.get('/internal/stats').status_code==403
    assert client.get('/internal/stats',headers={'x-qubite-service-key':'internal-secret','x-qubite-proxy':'wrong'}).status_code==401
    r=client.get('/internal/stats',headers={'x-qubite-service-key':'internal-secret'})
    assert r.status_code==200 and set(r.json())=={'spent','reserved','limit','remaining'}


def test_brief_owner_uses_paid_without_page_reads_or_jev(tmp_path,monkeypatch):
    import json
    monkeypatch.setattr(app,'store',Store(tmp_path))
    async def forbidden(*args):raise AssertionError('Slow route invoked for brief overview')
    async def complete(user,mode,messages,brief=False):
        assert mode=='fast' and brief is True and messages[0]['content']==app.BRIEF_SYSTEM
        sources=json.loads(messages[1]['content'])['SOURCE DOCUMENTS']
        assert sources[0]['status']=='unread' and 'ТОЛЬКО ПОИСКОВЫЙ ФРАГМЕНТ' in sources[0]['markdown']
        return {'answer_markdown':'Краткий ответ. [1]','model':'fast','provider':'test','cost':0}
    monkeypatch.setattr(app,'read_page',forbidden);monkeypatch.setattr(app,'classify',forbidden);monkeypatch.setattr(app,'complete',complete)
    search=make_search('пп');search['candidate']=None;search['results']=[{'url':'https://example.org','title':'Пример','content':'ПП означает правильное питание.'}]
    app.jobs['brief']={'status':'running'}
    asyncio.run(app.build_answer('brief','kirill',app.AnswerBody(search_id='s',detail=False),search))
    result=app.jobs['brief']['result'];assert result['detail'] is False and result['sources'][0]['status']=='unread'


def test_brief_guest_stays_free(tmp_path,monkeypatch):
    monkeypatch.setattr(app,'store',Store(tmp_path))
    async def complete(user,mode,messages,brief=False):
        assert mode=='free' and brief is True
        return {'answer_markdown':'Кратко.','model':'free','provider':'test','cost':0}
    monkeypatch.setattr(app,'complete',complete)
    app.jobs['brief-guest']={'status':'running'}
    asyncio.run(app.build_answer('brief-guest','friend',app.AnswerBody(search_id='s',detail=False),make_search('Марс')))
    assert app.jobs['brief-guest']['status']=='done'


def test_truncated_plain_answer_is_shown_with_notice(monkeypatch):
    async def router(*args):return {'choices':[{'message':{'content':'Законченная полезная фраза.'},'finish_reason':'length'}],'usage':{'cost':0}}
    monkeypatch.setattr(app,'openrouter',router)
    result=asyncio.run(app.complete('kirill','fast',[],brief=True))
    assert result['answer_markdown']=='Законченная полезная фраза.' and result['truncated'] is True


def test_broken_visual_json_recovers_only_complete_markdown(monkeypatch):
    async def router(*args):return {'choices':[{'message':{'content':'{"answer_markdown":"Полезный ответ.","visuals":[{"html":"<script'},'finish_reason':'length'}],'usage':{'cost':0}}
    monkeypatch.setattr(app,'openrouter',router)
    result=asyncio.run(app.complete('kirill','fast',[]))
    assert result['answer_markdown']=='Полезный ответ.' and result['visuals']==[] and result['truncated']

@pytest.mark.parametrize('prefix',['4.\n\n','Вот ответ:\n```json\n',''])
def test_model_envelope_with_preamble_does_not_leak_json(prefix):
    import json
    envelope={'answer_markdown':'Нормальный текст.','visuals':[{'title':'Таблица','html':'<table><tr><td>Данные</td></tr></table>','source_ids':[1]}],'image_indices':[]}
    parsed=app.parse_completion(prefix+json.dumps(envelope,ensure_ascii=False)+'\n```')
    assert parsed['answer_markdown']=='Нормальный текст.'
    assert parsed['visuals'][0]['title']=='Таблица'
    assert 'answer_markdown' not in app.render_answer(parsed['answer_markdown'],[])

def test_broken_envelope_with_preamble_recovers_text_without_html():
    parsed=app.parse_completion('4.\n{"answer_markdown":"Ответ.","visuals":[{"html":"<script')
    assert parsed['answer_markdown']=='Ответ.' and parsed['visuals']==[]
    with pytest.raises(app.UpstreamError):app.parse_completion('Вот JSON: {"answer_markdown":"Незавершённая строка')


def test_free_fallbacks_are_zero_price_and_explicit(monkeypatch):
    calls=[]
    async def router(user,path,body,*rates):
        calls.append(body)
        if len(calls)<3:raise app.UpstreamError('unavailable')
        return {'choices':[{'message':{'content':'Ответ.'},'finish_reason':'stop'}],'usage':{'cost':0}}
    monkeypatch.setattr(app,'openrouter',router)
    result=asyncio.run(app.complete('friend','free',[],brief=True))
    assert result['cost']==0 and len(calls)==3
    assert all(c['provider']['max_price']=={'prompt':0,'completion':0} and c['provider']['allow_fallbacks'] is False for c in calls)
    assert len({c['model'] for c in calls})==3


def test_no_request_caps_and_independent_hourly_cap(tmp_path):
    s=Store(tmp_path)
    for _ in range(12):s.claim_guest('unlimited',None,None)
    assert s.guest_remaining('unlimited',None) is None
    s.claim_guest('hourly',None,1)
    with pytest.raises(LimitError):s.claim_guest('hourly',None,1)
    s.claim_guest('daily',1,None)
    with pytest.raises(LimitError):s.claim_guest('daily',1,None)


def test_history_is_opt_in_and_shared_between_sessions(client):
    assert client.get('/api/history').json()['enabled'] is False
    cid='f'*32;body={'title':'Модели','turns':[{'query':'Что выбрать?','result':{'answer_markdown':'Ling.','answer_html':'<script>bad()</script>','sources':[]}}]}
    assert client.put('/api/history/'+cid,json=body).status_code==403
    assert client.put('/api/history/settings',json={'enabled':True}).status_code==200
    assert client.put('/api/history/'+cid,json=body).status_code==200
    token=app.store.create_browser_session('kirill')
    other={'x-qubite-user':'','cookie':app.SESSION_COOKIE+'='+token}
    assert client.get('/api/history',headers=other).json()['records'][0]['title']=='Модели'
    chat=client.get('/api/history/'+cid,headers=other).json()
    assert chat['turns'][0]['result']['answer_markdown']=='Ling.' and '<script>' not in chat['turns'][0]['result']['answer_html']
    assert client.get('/api/history/'+cid,headers={'x-qubite-user':'friend'}).status_code==403
    assert client.put('/api/history/settings',json={'enabled':False}).status_code==200
    assert client.get('/api/history/context/'+cid).status_code==403
    assert client.get('/api/history').json()['records']


def test_selected_context_never_crosses_accounts(tmp_path):
    s=Store(tmp_path);s.put_chat('one','e'*32,'Private',[{'query':'secret','result':{'answer_markdown':'confidential'}}])
    with pytest.raises(PermissionError):s.put_chat('two','e'*32,'Other',[])
    with pytest.raises(PermissionError):s.context('e'*32,'two')
    s.set_history_enabled('one',True);s.record_search('one',{'id':'id1','query':'private query','results':[]})
    assert not s.search_history('two')
    with pytest.raises(PermissionError):s.search_context('two','id1')


def test_model_requests_history_only_once(tmp_path,monkeypatch):
    monkeypatch.setattr(app,'store',Store(tmp_path))
    async def classify(*args):return 'economy',0,{}
    async def complete(*args):return {'answer_markdown':'','history_request':'Прошлый выбор модели','model':'test','cost':0}
    monkeypatch.setattr(app,'classify',classify);monkeypatch.setattr(app,'complete',complete)
    search=make_search('А что я выбирал раньше?');search['candidate']=None
    app.jobs['need-history']={'status':'running'}
    asyncio.run(app.build_answer('need-history','kirill',app.AnswerBody(search_id='s',history_available=True),search))
    assert app.jobs['need-history']['status']=='needs_history'
    app.jobs['history-done']={'status':'running'}
    asyncio.run(app.build_answer('history-done','kirill',app.AnswerBody(search_id='s',history_parent='need-history'),search))
    assert app.jobs['history-done']['status']=='done' and app.jobs['history-done']['result']['answer_markdown']


def test_history_selection_is_job_owned_and_cached(client,monkeypatch):
    app.jobs['wanted']={'user':'kirill','status':'needs_history','query':'Что я выбирал?','history_request':'Выбор модели'}
    captured=[]
    async def router(user,path,body,*rates):
        captured.append(body);return {'answers':{'chat':{'choice':'c1','probabilities':{'c1':.9}}}}
    monkeypatch.setattr(app,'openrouter',router)
    body={'job_id':'wanted','candidates':[{'id':'chat1','title':'Еда','description':'Питание'},{'id':'chat2','title':'Модели','description':'GLM или MiMo'}]}
    assert client.post('/api/history/select',json=body,headers={'x-qubite-user':'friend'}).status_code==403
    assert client.post('/api/history/select',json=body).json()=={'ids':['chat2']}
    assert client.post('/api/history/select',json=body).json()=={'ids':['chat2']} and len(captured)==1
    app.jobs['wanted']['resumed']=True
    assert client.post('/api/history/select',json=body).status_code==403


def test_fake_history_resume_cannot_bypass_request_limit(client):
    app.searches['s']={'user':'friend','query':'Hi','created':time.time()}
    assert client.post('/api/answer',json={'search_id':'s','history_parent':'fake'},headers={'x-qubite-user':'friend'}).status_code==403


def test_agent_api_requires_bearer_even_with_valid_browser_session(client):
    assert client.get('/api/v1/history').status_code==401
    assert client.post('/api/v1/search',json={'query':'hello'},headers={'authorization':'Bearer bad'}).status_code==401


def test_agent_api_identity_sources_no_ai_and_history_isolation(client,monkeypatch):
    import httpx,json
    monkeypatch.setattr(app,'QUBITE_URL','http://platform.test');monkeypatch.setattr(app,'QUBITE_KEY','internal-key')
    calls=[]
    async def transport(request):
        data=json.loads(request.content);calls.append(data)
        return httpx.Response(200,json={'user':'qb:2','login':'friend','owner':False,'key_id':'key-one','searchBudgetUsd':.05,'services':{'search':{'enabled':True,'paid':False,'history':True,'daily_requests':None,'hourly_requests':None,'daily_usd':None,'monthly_usd':None,'lifetime_usd':None}}})
    original=httpx.AsyncClient
    monkeypatch.setattr(app.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(transport)))
    async def search(user,body,record=True):
        assert user=='qb:2';return {'id':'s','results':[{'url':'https://example.org','title':'Example','content':'Text'}],'unresponsive_engines':[]}
    async def forbidden(*args,**kwargs):raise AssertionError('AI should not run for sources')
    monkeypatch.setattr(app,'perform_search',search);monkeypatch.setattr(app,'complete',forbidden)
    headers={'authorization':'Bearer qbs_'+'a'*43,'x-qubite-user':'kirill'}
    response=client.post('/api/v1/search',json={'query':'hello','mode':'sources'},headers=headers)
    assert response.status_code==200 and response.json()['sources'][0]['url']=='https://example.org'
    assert calls[0]['scope']=='search'
    assert client.get('/api/v1/history',headers=headers).status_code==403 # disabled by user
    app.store.set_history_enabled('qb:2',True);app.store.save(None,'kirill','owner secret',{'answer_markdown':'secret'})
    response=client.get('/api/v1/history',headers=headers);assert response.json()['chats']==[]
    app.jobs['foreign']={'user':'qb:2','key_id':'different-key','status':'done','result':{}}
    assert client.get('/api/v1/jobs/foreign',headers=headers).status_code==404
    assert calls[-1]['consume'] is False
