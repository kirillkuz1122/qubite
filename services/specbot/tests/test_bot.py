import asyncio
import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store, PRESETS
from bot import Bot
from ai import AI, ModelError
from document import exports

@pytest.fixture
def setup(tmp_path):
    s=Store(tmp_path/'data'/'test.sqlite')
    c=SimpleNamespace(owner=1,data=tmp_path/'data',daily=.05,session=.05,key='fake',flex_timeout=.1,standard_timeout=.1,stt_python='',stt_script='',send_client=False)
    b=Bot(c,s,SimpleNamespace())
    b.username='test_bot'
    return b,s,c

def session(s,uid=2):
    sid,t=s.create('Тестовое ТЗ');s.claim(t,uid);s.update(sid,status='active')
    return sid,t

def test_invitation_claim_once_expiry_and_revoke(setup):
    b,s,c=setup;sid,t=s.create('Сайт')
    assert len(t)<=64
    assert s.claim(t,2)==sid
    with pytest.raises(ValueError):s.claim(t,3)
    b.admin_action('revoke',sid,1)
    with pytest.raises(ValueError):s.claim(t,2)
    sid,t=s.create('Истекло');s.db.execute('UPDATE sessions SET expires=0 WHERE id=?',(sid,))
    with pytest.raises(ValueError):s.claim(t,2)

def test_private_access_and_owner_only_export(setup):
    b,s,c=setup;sid,_=session(s)
    with pytest.raises(ValueError):b.authorize(sid,3)
    with pytest.raises(ValueError):b.admin_action('export',sid,2)
    with pytest.raises(ValueError):b.admin_action('take',sid,3)
    asyncio.run(b.handle({'message':{'chat':{'id':99,'type':'group'},'from':{'id':1},'text':'/new секрет'}}))
    assert len(s.listing())==1

def test_claim_inside_update_transaction(setup):
    b,s,c=setup;sid,t=s.create('Пример')
    s.db.execute('BEGIN IMMEDIATE')
    asyncio.run(b.handle({'message':{'chat':{'id':2,'type':'private'},'from':{'id':2},'text':'/start '+t}}))
    s.db.execute('COMMIT')
    assert s.get(sid)['status']=='consent'

def test_budget_reserve_uncertain_and_day(setup):
    b,s,c=setup;sid,_=session(s)
    id=s.reserve(sid,.03,'openai/flex',.05,.05)
    s.settle(id,.03,'uncertain')
    with pytest.raises(ValueError):s.reserve(sid,.03,'openai',.05,.05)
    assert s.stats()['today_usd']==.03

class Response:
    def __init__(self,status,data=None):self.status_code=status;self.data=data
    def json(self):return self.data
class Client:
    def __init__(self,responses):self.responses=iter(responses);self.calls=[]
    async def post(self,*args,**kw):self.calls.append(kw);return next(self.responses)
    async def aclose(self):pass

def interview():
    return {'message':'Для кого нужен сайт?','state':{'goal':'Сайт','confirmed':['Нужен сайт'],'assumptions':[],'open_questions':['Аудитория']},'ready':False,'progress':10}

def success():return Response(200,{'choices':[{'finish_reason':'stop','message':{'content':json.dumps(interview(),ensure_ascii=False)}}],'usage':{'cost':.0001}})

def test_fallback_only_two_explicit_providers(setup):
    b,s,c=setup;sid,_=session(s);cl=Client([Response(503),success()])
    result,provider=asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert provider=='openai'
    assert [r['json']['provider']['only'] for r in cl.calls]==[['openai/flex'],['openai']]
    assert all(not r['json']['provider']['allow_fallbacks'] for r in cl.calls)
    assert s.stats()['today_usd']==.0001
    assert result['message']

def test_no_fallback_on_key_budget_failure(setup):
    b,s,c=setup;sid,_=session(s);cl=Client([Response(402)])
    with pytest.raises(ModelError):asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert len(cl.calls)==1 and s.stats()['today_usd']==0

def test_timeout_keeps_reserve_before_fallback(setup):
    import httpx
    b,s,c=setup;sid,_=session(s)
    class TimeClient(Client):
        async def post(self,*args,**kw):
            self.calls.append(kw)
            if len(self.calls)==1:raise httpx.ReadTimeout('test')
            return success()
    cl=TimeClient([])
    asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert len(cl.calls)==2 and s.stats()['today_usd']>.0001
    assert s.db.execute("SELECT COUNT(*) FROM usage WHERE status='uncertain'").fetchone()[0]==1

def test_context_preserves_all_unsummarized_manual_messages(setup):
    b,s,c=setup;sid,_=session(s)
    for i in range(14):s.add_message(sid,'client',f'Требование {i}')
    history,cursor=s.context(sid)
    assert len(history)==14
    s.set_setting('cursor.'+sid,str(cursor))
    s.add_message(sid,'client','Новое требование')
    history,newcursor=s.context(sid)
    assert len(history)==4 and history[-1]['text']=='Новое требование'
    assert newcursor>cursor

def test_manual_takeover_discards_inflight_ai(setup):
    b,s,c=setup;sid,_=session(s);s.enqueue(sid,'interview')
    job=dict(s.db.execute('SELECT * FROM jobs').fetchone())
    class LateAI:
        async def generate(self,session,final=False):
            b.admin_action('take',sid,1)
            return interview(),'openai/flex'
    b.ai=LateAI()
    asyncio.run(b.work(job))
    assert s.get(sid)['status']=='manual'
    assert not any(m['role']=='assistant' for m in s.messages(sid))
    assert not s.get(sid)['state']

def test_input_busy_never_drops_accepted_text(setup):
    b,s,c=setup;sid,_=session(s)
    b.accepted(sid,'Первый ответ')
    with pytest.raises(ValueError):b.accepted(sid,'Второй')
    assert [m['text'] for m in s.messages(sid)]==['Первый ответ']
    b.admin_action('take',sid,1)
    b.accepted(sid,'Ручной ответ')
    assert s.messages(sid)[-1]['text']=='Ручной ответ'

def test_recovery_does_not_repeat_billed_job(setup):
    b,s,c=setup;sid,_=session(s);s.enqueue(sid,'interview')
    s.db.execute("UPDATE jobs SET status='running'")
    assert s.recover()=={sid}
    assert s.db.execute('SELECT status FROM jobs').fetchone()[0]=='failed'

def test_pdf_cyrillic_escape_multipage(setup):
    from pypdf import PdfReader
    b,s,c=setup
    d={'title':'Техническое задание: сайт','summary':'Кириллица <script> без выполнения',
       'sections':[{'title':'Требования','items':['Описание сценария '+('кириллица '*40) for _ in range(50)]}],
       'modules':[{'name':'Каталог','scope':'Поиск товаров','complexity':'средняя','reason':'Интеграция'}],
       'assumptions':['Нужны уточнения'],'open_questions':['Срок не задан'],'acceptance':['Пользователь ищет товар']}
    stem=exports(c.data/'documents','aabbccddeeff','Тест',d,1)
    reader=PdfReader(stem+'.pdf');text='\n'.join(p.extract_text() for p in reader.pages)
    assert len(reader.pages)>1 and 'Техническое задание' in text and 'Каталог' in text
    assert '<script>' in text and 'Срок не задан' in text
    assert Path(stem+'.pdf').stat().st_mode&0o777==0o600

def test_final_documents_delivered_to_owner_only(setup):
    b,s,c=setup;sid,_=session(s)
    s.update(sid,document='/tmp/mock',status='done');b.deliver(sid)
    rows=list(s.db.execute("SELECT chat FROM outbox WHERE method='document'"))
    assert len(rows)==2 and all(r['chat']==1 for r in rows)

def test_old_callbacks_after_revoke_are_rejected(setup):
    b,s,c=setup;sid,_=session(s);b.admin_action('revoke',sid,1)
    u={'callback_query':{'id':'x','from':{'id':2},'message':{'chat':{'id':2,'type':'private'}},'data':'approve:'+sid}}
    asyncio.run(b.handle(u))
    assert s.get(sid)['status']=='revoked'

def test_owner_can_test_interview_without_changing_client_security(setup):
    b,s,c=setup;b.owner_message('/test')
    sid=s.setting('active.1');assert s.get(sid)['client']==1
    s.db.execute("UPDATE jobs SET status='done'")
    b.owner_message('Нужен интернет-магазин')
    assert s.messages(sid)[-1]['text']=='Нужен интернет-магазин'
    b.owner_message('/stoptest');assert s.get(sid)['status']=='paused'
    assert s.setting('active.1')==''

def test_failed_voice_retry_is_voice_not_empty_model_call(setup):
    b,s,c=setup;sid,_=session(s)
    s.enqueue(sid,'voice',{'file_id':'voice'})
    jobid=s.db.execute('SELECT id FROM jobs').fetchone()[0]
    s.db.execute("UPDATE jobs SET status='failed'")
    u={'callback_query':{'id':'x','from':{'id':2},'message':{'chat':{'id':2,'type':'private'}},'data':'retryjob:'+str(jobid)}}
    asyncio.run(b.handle(u))
    rows=list(s.db.execute('SELECT kind,status,payload FROM jobs ORDER BY id'))
    assert rows[0]['status']=='retried' and rows[1]['kind']=='voice'
    assert json.loads(rows[1]['payload'])['file_id']=='voice'
    asyncio.run(b.handle(u))
    assert s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]==2

def test_delete_preserves_money_accounting(setup):
    b,s,c=setup;sid,_=session(s)
    id=s.reserve(sid,.01,'openai',.05,.05);s.settle(id,.01,'ok')
    b.admin_action('delete',sid,1)
    assert s.stats()['today_usd']==.01
    assert s.db.execute('SELECT COUNT(*) FROM messages').fetchone()[0]==0

def test_schema_forbids_untyped_budget_and_extra_properties():
    from ai import output_schema
    schema=output_schema(False)
    assert schema['additionalProperties'] is False
    state=schema['properties']['state']
    assert state['additionalProperties'] is False
    assert state['properties']['budget']['anyOf']==[{'type':'string'},{'type':'array','items':{'type':'string'}}]

def test_client_continue_keeps_manual_takeover(setup):
    b,s,c=setup;sid,_=session(s);b.admin_action('take',sid,1)
    def callback(action):return {'callback_query':{'id':'x','from':{'id':2},'message':{'chat':{'id':2,'type':'private'}},'data':action+':'+sid}}
    asyncio.run(b.handle(callback('pause')))
    assert s.get(sid)['status']=='paused'
    asyncio.run(b.handle(callback('continue')))
    assert s.get(sid)['status']=='manual'
    assert s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]==0

def test_full_client_interview_review_and_owner_delivery(setup):
    b,s,c=setup
    sid,token=s.create('Лендинг')
    def message(text):return {'message':{'chat':{'id':2,'type':'private'},'from':{'id':2},'text':text}}
    def cb(action):return {'callback_query':{'id':'x','from':{'id':2},'message':{'chat':{'id':2,'type':'private'}},'data':action+':'+sid}}
    final={'title':'ТЗ: лендинг','summary':'Страница мастерской','sections':[{'title':'Функции','items':['Форма заявки']}],
        'modules':[{'name':'Форма','scope':'Имя и контакт','complexity':'низкая','reason':'Один сценарий'}],
        'assumptions':[],'open_questions':['Срок'],'acceptance':['Заявка доставлена']}
    class FakeAI:
        async def generate(self,session,final=False):
            return (globals_for_test['final'] if final else interview()).copy(),'openai/flex'
    globals_for_test={'final':final};b.ai=FakeAI()
    async def scenario():
        await b.handle(message('/start '+token));assert s.get(sid)['status']=='consent'
        await b.handle(cb('consent'));assert s.get(sid)['status']=='active'
        async def run_pending():
            job=dict(s.db.execute("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT 1").fetchone())
            s.db.execute("UPDATE jobs SET status='running' WHERE id=?",(job['id'],))
            await b.work(job);s.db.execute("UPDATE jobs SET status='done' WHERE id=?",(job['id'],))
        await run_pending()
        await b.handle(message('Нужен лендинг для мастерской'));await run_pending()
        await b.handle(cb('finish'));await run_pending()
        assert s.get(sid)['status']=='review'
        await b.handle(cb('approve'));assert s.get(sid)['status']=='done'
        docs=list(s.db.execute("SELECT chat,payload FROM outbox WHERE method='document'"))
        assert len(docs)==3 and all(row['chat']==1 for row in docs)
        assert Path(s.get(sid)['document']+'.pdf').is_file()
    asyncio.run(scenario())

def test_owner_sees_invited_client_and_profile_link(setup):
    b,s,c=setup;sid,t=s.create('Новый сайт')
    m={'message':{'chat':{'id':2,'type':'private'},'from':{'id':2,'first_name':'Иван','last_name':'Петров','username':'ivan_petrov'},'text':'/start '+t}}
    asyncio.run(b.handle(m));b.card(sid)
    row=s.get(sid);assert row['client_name']=='Иван Петров' and row['client_username']=='ivan_petrov'
    owner=[json.loads(r['payload']) for r in s.db.execute('SELECT payload FROM outbox WHERE chat=1')]
    assert 'Иван Петров' in owner[0]['text'] and '@ivan_petrov' in owner[0]['text']
    assert owner[0]['reply_markup']['inline_keyboard'][0][0]['url']=='https://t.me/ivan_petrov'
    asyncio.run(b.handle(m))
    joins=[json.loads(r['payload']) for r in s.db.execute('SELECT payload FROM outbox WHERE chat=1') if 'По приглашению вошёл' in json.loads(r['payload'])['text']]
    assert len(joins)==1

def test_client_profile_requires_bound_id_and_username_is_not_url(setup):
    from bot import profile_button
    b,s,c=setup;sid,_=session(s)
    with pytest.raises(ValueError):s.profile(sid,{'id':3,'first_name':'Другой'})
    s.profile(sid,{'id':2,'first_name':'Иван','username':'evil/path?x=1'})
    assert s.get(sid)['client_username']==''
    assert profile_button(s.get(sid))[0][0]['url']=='tg://user?id=2'
