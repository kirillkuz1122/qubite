import asyncio
import math
import pytest
from grounding import current_intent, page_dates, verify, utc_date

@pytest.mark.parametrize('query,expected',[
    ('лучшие LLM модели 2026 рейтинг цены',True),('какие сейчас модели топовые?',True),
    ('лучшие LLM модели апрель 2026',False),('цены моделей в 2025 году',False),
    ('что такое пп',False),('Gemini и GLM сравнение архитектуры',False),
])
def test_current_vs_historical(query,expected):
    assert current_intent(query,'2026-10-03') is expected

def test_dates_are_metadata_not_body_or_fetch_date():
    data=page_dates(b'<p>2026-10-03</p><meta property="article:published_time" content="2026-05-03T10:00:00Z"><script type="application/ld+json">{"dateModified":"2026-09-25"}</script>')
    assert data=={'published_at':'2026-05-03','modified_at':'2026-09-25'}
    assert page_dates(b'<p>2026-10-03</p>')=={}

DOC=[{'id':1,'title':'GPT test','url':'https://example.org','status':'read','markdown':'GPT-5.5: Terminal-Bench 2.0 82.7%.','published_at':utc_date()}]

def decision(status='supported',confidence=.95):
    return {'answers':{'grounding':{'choice':status,'confidence':confidence,'probabilities':{status:.99}},'relevant':{'noul':.99},'fresh':{'noul':.99}},'usage':{'cost':.00012}}

@pytest.mark.parametrize('status',['supported','uncertain','unsupported'])
def test_one_call_and_no_automatic_rewrite(status):
    calls=[]
    async def call(*args):calls.append(args);return decision(status)
    result=asyncio.run(verify('u','какие сейчас модели?', 'GPT-5.5: 82.7% [1]',DOC,paid=True,call=call))
    assert len(calls)==1 and result['status']==status and result['cost_usd']==.00012
    assert result['retry_recommended']==(status!='supported')
    assert calls[0][2]['state']['sources'][0]['markdown']==DOC[0]['markdown']
    if status!='supported':assert 'agent_instruction' in result

@pytest.mark.parametrize('fault',['missing_probability','nan','missing_confidence'])
def test_malformed_response_never_gets_green_badge(fault):
    data=decision()
    if fault=='missing_probability':data['answers']['grounding']['probabilities']={}
    if fault=='nan':data['answers']['grounding']['confidence']=math.nan
    if fault=='missing_confidence':del data['answers']['grounding']['confidence']
    async def call(*args):return data
    result=asyncio.run(verify('u','вопрос','Ответ [1]',DOC,paid=True,call=call))
    assert result['status']=='not_checked' and result['cost_usd']==.00012

def test_no_paid_call_for_free_guest():
    async def forbidden(*args):raise AssertionError('Paid request')
    result=asyncio.run(verify('friend','вопрос','Ответ [1]',DOC,paid=False,call=forbidden))
    assert result['status']=='not_checked' and result['cost_usd']==0

@pytest.mark.parametrize('condition',['stale','unknown_date','missing_citation','wrong_citation','truncated','cut'])
def test_incomplete_evidence_prevents_green(condition):
    docs=[dict(DOC[0])];answer='Ответ [1]';truncated=False
    if condition=='stale':docs[0]['published_at']='2026-01-01'
    if condition=='unknown_date':docs[0].pop('published_at')
    if condition=='missing_citation':answer='Ответ'
    if condition=='wrong_citation':answer='Ответ [9]'
    if condition=='truncated':truncated=True
    if condition=='cut':docs[0]['markdown']='x'*25000
    async def call(*args):return decision()
    result=asyncio.run(verify('u','сейчас модели',answer,docs,paid=True,call=call,truncated=truncated))
    assert result['status']=='uncertain' and result['warnings']

def test_failure_returns_existing_answer_warning_without_retry():
    calls=[]
    async def call(*args):calls.append(args);raise OSError('offline')
    result=asyncio.run(verify('u','вопрос','Ответ [1]',DOC,paid=True,call=call))
    assert len(calls)==1 and result['status']=='not_checked' and result['warnings']

def test_additive_ledger_migration_keeps_old_costs_and_labels_unknown(tmp_path):
    import sqlite3
    from store import Store, day
    path=tmp_path/'search.sqlite'
    with sqlite3.connect(path) as c:
        c.execute('CREATE TABLE ledger(id TEXT PRIMARY KEY,day TEXT,user TEXT,kind TEXT,reserved REAL,cost REAL,created REAL)')
        c.execute('INSERT INTO ledger VALUES (?,?,?,?,?,?,?)',('old',day(),'qb:1','old-call',0,.001,1))
    s=Store(tmp_path,budget=.05);key=s.reserve('qb:2','alpha/decisions',.002);s.annotate(key,'typesafe/jev-1.13');s.settle(key,.0001,provider='TypeSafe')
    failure=s.reserve('qb:2','v1/chat/completions',.002);s.annotate(failure,'test/model');s.settle(failure,0,status='error')
    stats=s.analytics(1)
    assert stats['totals']['calls']==3 and stats['totals']['cost_usd']==pytest.approx(.0011)
    assert stats['totals']['failed']==1 and stats['totals']['successful']==1
    assert any(m['model']=='legacy/unknown' and m['cost_usd']==.001 for m in stats['models'])
    own=s.analytics(1,'qb:2');assert len(own['users'])==1 and own['totals']['cost_usd']==.0001
    assert s.analytics(1,'qb:99')['totals']['calls']==0
    assert Store(tmp_path).analytics(1)['totals']['cost_usd']==pytest.approx(.0011) # idempotent startup
