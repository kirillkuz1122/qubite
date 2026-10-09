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
    c=SimpleNamespace(owner=1,data=tmp_path/'data',daily=.05,session=.05,key='fake',primary_timeout=.1,standard_timeout=.1,stt_python='',stt_script='',send_client=False)
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
    id=s.reserve(sid,.03,'anthropic',.05,.05)
    s.settle(id,.03,'uncertain')
    with pytest.raises(ValueError):s.reserve(sid,.03,'google-vertex/global',.05,.05)
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
    assert provider=='google-vertex/global'
    assert [r['json']['provider']['only'] for r in cl.calls]==[['anthropic'],['google-vertex/global']]
    assert all(not r['json']['provider']['allow_fallbacks'] for r in cl.calls)
    assert s.stats()['today_usd']==.0001
    assert result['message']

def test_no_fallback_on_key_budget_failure(setup):
    b,s,c=setup;sid,_=session(s);cl=Client([Response(402)])
    with pytest.raises(ModelError):asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert len(cl.calls)==1 and s.stats()['today_usd']==0

def test_http_200_upstream_error_uses_standard_route_and_keeps_unknown_cost(setup,caplog):
    b,s,c=setup;sid,_=session(s)
    cl=Client([Response(200,{'error':{'code':503,'message':'PRIVATE CLIENT TEXT'}}),success()])
    result,provider=asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert provider=='google-vertex/global' and result['message']
    assert len(cl.calls)==2
    rows=list(s.db.execute('SELECT cost,status FROM usage ORDER BY id'))
    assert rows[0]['status']=='uncertain' and rows[0]['cost']>0
    assert rows[1]['status']=='ok'
    assert 'PRIVATE CLIENT TEXT' not in caplog.text

def test_http_200_credit_error_never_falls_back(setup):
    b,s,c=setup;sid,_=session(s)
    cl=Client([Response(200,{'error':{'code':402},'usage':{'cost':0}})])
    with pytest.raises(ModelError,match='402'):asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert len(cl.calls)==1 and s.stats()['today_usd']==0

def test_http_200_finish_error_falls_back_without_parsing_partial_answer(setup):
    b,s,c=setup;sid,_=session(s)
    cl=Client([Response(200,{'choices':[{'finish_reason':'error','message':{'content':'partial'}}],'usage':{'cost':.00001}}),success()])
    _,provider=asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert provider=='google-vertex/global' and s.stats()['today_usd']==pytest.approx(.00011)

@pytest.mark.parametrize('data',[{'usage':None,'choices':None},{'usage':[], 'choices':[None]}, {'choices':[{'message':None}]}])
def test_malformed_envelope_is_safe_and_does_not_automatically_spend_again(setup,data):
    b,s,c=setup;sid,_=session(s);cl=Client([Response(200,data)])
    with pytest.raises(ModelError,match='формат'):asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert len(cl.calls)==1

def test_format_diagnostics_name_field_and_request_without_customer_content(setup,caplog):
    b,s,c=setup;sid,_=session(s);bad=interview();bad['state']['budget']={'secret':'PRIVATE CUSTOMER TEXT'}
    cl=Client([Response(200,{'id':'gen-safe123','choices':[{'message':{'content':json.dumps(bad)}}],'usage':{'cost':.0001}})])
    with pytest.raises(ModelError):asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert 'request=gen-safe123' in caplog.text and 'detail=state.budget.text_type' in caplog.text
    assert 'PRIVATE CUSTOMER TEXT' not in caplog.text

def test_unknown_field_or_unsafe_request_id_does_not_leak_into_diagnostics(setup,caplog):
    b,s,c=setup;sid,_=session(s);bad=interview();bad['state']['PRIVATE CUSTOMER TEXT']='secret'
    cl=Client([Response(200,{'id':'PRIVATE CUSTOMER TEXT','choices':[{'message':{'content':json.dumps(bad)}}]})])
    with pytest.raises(ModelError):asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    assert 'request=unknown' in caplog.text and 'state.unknown_fields' in caplog.text
    assert 'PRIVATE CUSTOMER TEXT' not in caplog.text

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
            return interview(),'anthropic'
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
    id=s.reserve(sid,.01,'google-vertex/global',.05,.05);s.settle(id,.01,'ok')
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
            return (globals_for_test['final'] if final else interview()).copy(),'anthropic'
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

def next_job(s,sid,kind='interview',payload=None):
    s.enqueue(sid,kind,payload)
    return dict(s.db.execute('SELECT * FROM jobs ORDER BY id DESC LIMIT 1').fetchone())

def test_single_question_hint_consumed_once_but_focus_persists(setup):
    b,s,c=setup;sid,_=session(s)
    s.update(sid,focus='Постоянно выясняй условия интеграций',steering='Уточни роли пользователей')
    cl=Client([success(),success()]);b.ai=AI(c,s,cl)
    async def scenario():
        await b.work(next_job(s,sid))
        assert s.get(sid)['steering']=='' and s.get(sid)['focus']
        await b.work(next_job(s,sid))
    asyncio.run(scenario())
    inputs=['\n'.join(m['content'] for m in call['json']['messages'] if m['role']=='system') for call in cl.calls]
    assert 'Уточни роли пользователей' in inputs[0] and 'Уточни роли пользователей' not in inputs[1]
    assert all('Постоянно выясняй условия интеграций' in x for x in inputs)

def test_failed_generation_keeps_single_question_hint(setup):
    b,s,c=setup;sid,_=session(s);s.update(sid,steering='Уточнить источники')
    b.ai=AI(c,s,Client([Response(200,{'choices':[]})]))
    with pytest.raises(ModelError):asyncio.run(b.work(next_job(s,sid)))
    assert s.get(sid)['steering']=='Уточнить источники'
    assert not s.messages(sid)

def test_new_identical_hint_during_generation_not_consumed_by_old_question(setup):
    b,s,c=setup;sid,_=session(s);b.owner_text('steer',sid,'Уточнить источники')
    version=s.get(sid)['steering_version']
    class ReplacingAI:
        async def generate(self,session,final=False):
            b.owner_text('steer',sid,'Уточнить источники')
            return interview(),'anthropic'
    b.ai=ReplacingAI();asyncio.run(b.work(next_job(s,sid)))
    assert s.get(sid)['steering']=='Уточнить источники'
    assert s.get(sid)['steering_version']==version+1

def test_question_commit_rolls_back_hint_and_state_if_delivery_queue_fails(setup,monkeypatch):
    b,s,c=setup;sid,_=session(s);s.update(sid,steering='Уточнить источники')
    b.ai=AI(c,s,Client([success()]))
    def fail(*args,**kw):raise RuntimeError('mock disk failure')
    monkeypatch.setattr(s,'send',fail)
    with pytest.raises(RuntimeError):asyncio.run(b.work(next_job(s,sid)))
    assert s.get(sid)['steering']=='Уточнить источники' and s.get(sid)['state']=={}
    assert not s.messages(sid)
    assert not s.setting('cursor.'+sid)

def test_final_prompt_includes_focus_but_not_single_question_hint(setup):
    b,s,c=setup;sid,_=session(s);s.update(sid,focus='Критерии измеримого результата',steering='Только следующий вопрос')
    final={'title':'ТЗ','summary':'Цель','sections':[{'title':'Требования','items':['Сайт']}],
           'modules':[],'assumptions':[],'open_questions':[],'acceptance':[]}
    cl=Client([Response(200,{'choices':[{'message':{'content':json.dumps(final)}}],'usage':{'cost':.0001}})])
    asyncio.run(AI(c,s,cl).generate(s.get(sid),final=True))
    text='\n'.join(m['content'] for m in cl.calls[0]['json']['messages'])
    assert 'Критерии измеримого результата' in text and 'Только следующий вопрос' not in text
    assert 'recent_questions' not in json.loads(cl.calls[0]['json']['messages'][-1]['content'])
    assert s.get(sid)['steering']=='Только следующий вопрос'

def test_manual_summary_does_not_spend_hint_without_asking_question(setup):
    b,s,c=setup;sid,_=session(s);s.mode(sid,'manual');s.update(sid,steering='Только следующий вопрос')
    cl=Client([success()]);b.ai=AI(c,s,cl)
    b.finish(sid,c.owner)
    job=dict(s.db.execute("SELECT * FROM jobs WHERE status='pending'").fetchone())
    asyncio.run(b.work(job))
    assert s.get(sid)['steering']=='Только следующий вопрос'
    assert 'Только следующий вопрос' not in '\n'.join(m['content'] for m in cl.calls[0]['json']['messages'])
    assert s.db.execute("SELECT COUNT(*) FROM jobs WHERE kind='final' AND status='pending'").fetchone()[0]==1

def test_new_invitation_asks_local_focus_after_project_title(setup):
    b,s,c=setup;b.wizard('new',preset='development')
    b.owner_message('Бот для заявок')
    assert not s.listing()
    w=json.loads(s.setting('wizard'));assert w['action']=='newfocus' and w['title']=='Бот для заявок'
    b.owner_message('Важно узнать интеграции, роли и бюджет')
    row=s.get(s.listing()[0]['id'])
    assert row['focus']=='Важно узнать интеграции, роли и бюджет' and row['steering']==''
    assert s.setting('wizard')==''

def test_focus_can_be_skipped_once_and_only_by_owner(setup):
    b,s,c=setup;b.owner_message('/new разработка Проект')
    w=json.loads(s.setting('wizard'))
    def cb(uid):return {'callback_query':{'id':'x','from':{'id':uid},'message':{'chat':{'id':uid,'type':'private'}},'data':'newskip:'+w['ticket']}}
    asyncio.run(b.handle(cb(2)));assert not s.listing()
    asyncio.run(b.handle(cb(1)));assert len(s.listing())==1
    assert s.get(s.listing()[0]['id'])['focus']==''
    asyncio.run(b.handle(cb(1)));assert len(s.listing())==1

def test_expired_focus_skip_does_not_create_invitation(setup):
    b,s,c=setup;b.owner_message('/new Проект')
    w=json.loads(s.setting('wizard'));w['expires']=0;s.set_setting('wizard',json.dumps(w))
    cb={'callback_query':{'id':'x','from':{'id':1},'message':{'chat':{'id':1,'type':'private'}},'data':'newskip:'+w['ticket']}}
    asyncio.run(b.handle(cb));assert not s.listing()

def test_focus_and_hint_can_be_edited_and_cleared_separately(setup):
    b,s,c=setup;sid,_=session(s)
    b.owner_message('/focus '+sid+' Выяснить условия')
    b.owner_message('/steer '+sid+' Уточнить бюджет')
    b.admin_action('focus',sid,c.owner);b.owner_message('/clear')
    row=s.get(sid);assert row['focus']=='' and row['steering']=='Уточнить бюджет'
    b.admin_action('steer',sid,c.owner);b.owner_message('/clear')
    assert s.get(sid)['steering']==''
    with pytest.raises(ValueError):b.owner_text('steer',sid,'x'*2001)

def test_focus_migration_preserves_existing_interviews_and_messages(setup):
    b,s,c=setup;sid,_=session(s);s.add_message(sid,'client','Нужен сайт');s.update(sid,steering='Подсказка')
    path=Path(s.db.execute('PRAGMA database_list').fetchone()[2])
    s.db.execute('ALTER TABLE sessions DROP COLUMN focus')
    s.db.execute('ALTER TABLE sessions DROP COLUMN steering_version');s.db.close()
    migrated=Store(path);row=migrated.get(sid)
    assert row['focus']=='' and row['steering']=='Подсказка' and row['steering_version']==0
    assert migrated.messages(sid)[0]['text']=='Нужен сайт'
    migrated.update(sid,steering='Новая');assert migrated.get(sid)['steering_version']==1

def test_recent_questions_are_bounded_and_isolated_without_confirmations(setup):
    b,s,c=setup;sid,_=session(s);other,_=session(s,uid=3)
    s.add_message(sid,'client','PRIVATE ANSWER?')
    s.add_message(other,'assistant','OTHER INTERVIEW?')
    for i in range(20):s.add_message(sid,'assistant',f'Понял: подробная сводка. Вопрос номер {i}? Ещё вопрос {i}?')
    questions=s.recent_questions(sid)
    assert len(questions)==12 and questions[-1]=='Ещё вопрос 19?'
    assert all('Понял' not in q and 'PRIVATE ANSWER' not in q and 'OTHER INTERVIEW' not in q for q in questions)
    assert 'Вопрос номер 0?' not in questions

def test_interview_prompt_gets_question_memory_and_answer_count(setup):
    b,s,c=setup;sid,_=session(s);s.add_message(sid,'assistant','Как часто обновлять данные?')
    s.update(sid,turns=14);cl=Client([success()])
    asyncio.run(AI(c,s,cl).generate(s.get(sid)))
    payload=json.loads(cl.calls[0]['json']['messages'][-1]['content'])
    assert payload['recent_questions']==['Как часто обновлять данные?']
    assert payload['client_answers_count']==14
