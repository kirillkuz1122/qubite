import json
from types import SimpleNamespace
import pytest
import kwork_runner as runner

def order(oid):
    return {'id':oid,'title':'Сайт '+oid,'description':'Нужен сайт '+oid,'desired_price':8000,'detail_complete':True}

def result():
    return {'reply':'Здравствуйте! '+('Конкретное решение задачи и вопросы заказчику. '*15),'suggested_price':'8000 ₽','time_estimate':'5 дней'}

def test_isolated_requests_and_anthropic_only():
    a,b=runner.request_body(order('1')),runner.request_body(order('2'))
    assert len(a['messages'])==len(b['messages'])==2
    assert 'Сайт 1' not in b['messages'][1]['content']
    assert b['provider']['only']==['anthropic'] and b['provider']['allow_fallbacks'] is False
    assert b['model']=='anthropic/claude-haiku-5.5'
    assert b['prompt_cache_options']=={'mode':'explicit'}

def test_cached_draft_avoids_second_charge(tmp_path,monkeypatch):
    calls=[]
    def post(*args,**kwargs):
        calls.append(kwargs['json'])
        return SimpleNamespace(status_code=200,json=lambda:{'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result())}}],'usage':{'cost':.0001}})
    monkeypatch.setattr(runner.requests,'post',post)
    first=runner.draft(order('1'),{'OPENROUTER_API_KEY':'test'},tmp_path)
    second=runner.draft(order('1'),{'OPENROUTER_API_KEY':'test'},tmp_path)
    assert first==second and len(calls)==1
    changed=order('1');changed['description']='Другое описание'
    runner.draft(changed,{'OPENROUTER_API_KEY':'test'},tmp_path)
    assert len(calls)==2

def test_upstream_failure_not_cached_or_retried(tmp_path,monkeypatch):
    calls=[]
    def post(*args,**kwargs):
        calls.append(1);return SimpleNamespace(status_code=503)
    monkeypatch.setattr(runner.requests,'post',post)
    with pytest.raises(RuntimeError):runner.draft(order('1'),{'OPENROUTER_API_KEY':'test'},tmp_path)
    assert len(calls)==1 and not list(tmp_path.iterdir())

def test_http_200_with_provider_error_is_not_a_success(tmp_path,monkeypatch):
    monkeypatch.setattr(runner.requests,'post',lambda *a,**kw:SimpleNamespace(status_code=200,json=lambda:{'error':{'code':503}}))
    with pytest.raises(RuntimeError,match='не вернула результат'):
        runner.draft(order('1'),{'OPENROUTER_API_KEY':'test'},tmp_path)
    assert not list(tmp_path.iterdir())

def test_delivery_failure_never_acknowledges(monkeypatch):
    monkeypatch.setattr(runner.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=1,stdout=''))
    def fail(*args):raise AssertionError('Order acknowledged on failure')
    monkeypatch.setattr(runner.parser,'acknowledge',fail)
    with pytest.raises(RuntimeError):runner.deliver(order('1'),result())

def test_customer_markup_is_escaped():
    o=order('1');o['title']='<a href="https://evil.example">Click</a>'
    message=runner.notification(o,result())
    assert '<a href=' not in message['text'] and '&lt;a' in message['text']
    assert len(message['text'])<=4096

def test_reviews_are_grouped_with_bounded_size():
    batches=list(runner.review_batches([order(str(i)) for i in range(30)]))
    assert len(batches)==5
    assert all(len('\n\n────\n\n'.join(t for _,t in batch))<4096 for batch in batches)
    assert [o['id'] for batch in batches for o,_ in batch]==[str(i) for i in range(30)]

def test_review_ack_requires_entire_batch(monkeypatch):
    batch=next(runner.review_batches([order('1'),order('2')]))
    monkeypatch.setattr(runner.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=0,stdout=json.dumps({'ok':True,'acknowledged':['1']})))
    with pytest.raises(RuntimeError):runner.deliver_reviews(batch)
