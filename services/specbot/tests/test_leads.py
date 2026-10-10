import asyncio
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace as NS
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from leads import Leads, process_one, fingerprint
from leads_personal import member
from install_lead_hooks import kwork, listener


@pytest.fixture
def setup(tmp_path):
    s=Store(tmp_path/'data'/'specbot.sqlite')
    cfg={'enabled':True,'owner':1,'profile_url':'https://kwork.ru/user/kirillkuz_ai','training_started':time.time(), 'sources':['test_requests']}
    l=Leads(s,cfg)
    s.db.execute("UPDATE lead_sources SET chat_id=-100123,status='joined',auto_allowed=1")
    yield s,l
    s.db.close()


def capture(l,mid=1,uid=2,text='Ищу разработчика, нужен бот. В личку.',now=None):
    assert l.capture(-100123,mid,uid,'client_user',text,now=now)


@pytest.mark.parametrize('chat,uid,text',[(-100456,2,'Нужен бот'),(-100123,1,'Нужен бот'),(-100123,-5,'Нужен бот'),(-100123,2,'Предлагаю разработку ботов'),(-100123,2,'Нужен сантехник'),(-100123,2,'Курьер, свободный график работы, оплата за работу'),(-100123,2,'Подскажите когда заработает банана')])
def test_scope_owner_anonymous_and_free_prefilter(setup,chat,uid,text):
    _,l=setup
    assert not l.capture(chat,1,uid,'some_user',text)


def test_deduplicates_author_across_messages_and_same_request(setup):
    s,l=setup;capture(l)
    assert not l.capture(-100123,2,2,'client_user','Нужен сайт, ищу исполнителя')
    assert not l.capture(-100123,3,3,'other_user','Ищу разработчика, нужен бот. В личку.')
    assert s.db.execute('select count(*) from telegram_leads').fetchone()[0]==1


def test_folder_membership_preserves_explicit_exclusions():
    user=NS(id=5,contact=False)
    f=NS(include_peers=[],exclude_peers=[NS(user_id=5)],pinned_peers=[],contacts=False,non_contacts=True)
    assert not member(f,user)
    f.exclude_peers=[];assert member(f,user)
    f.non_contacts=False;f.include_peers=[NS(user_id=5)];assert member(f,user)


class FakeAI:
    def __init__(self,c,s):
        self.client=self
    async def post(self,*args,**kw):
        assert 'owner_examples' in kw['json']['state']
        return NS(status_code=200,json=lambda:{'answers':{k:{'noul':.99} for k in ['suitable','buyer','direct']}})
    async def complete(self,sid,messages,schema,max_tokens,validator,**kw):
        out={'title':'Бот для заявки','reply':'Какие функции нужны боту и есть ли описание задачи?','reason':'Запрошена разработка бота, деталей пока мало.'}
        validator(out);return out,'test-provider'
    async def aclose(self):pass


def generate(setup,monkeypatch):
    s,l=setup;capture(l)
    monkeypatch.setattr('leads.AI',FakeAI)
    c=NS(key='test-key',daily=1,session=1)
    assert asyncio.run(process_one(l,c))
    return s,l,dict(s.db.execute('select * from telegram_leads').fetchone())


def test_training_draft_does_not_send_and_preserves_structured_context(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    assert row['status']=='draft' and row['proposal']
    assert l.n.dispatchable() is None
    assert l.n.pending_model() is None
    assert isinstance(s.get(row['sid'])['state'],dict)
    assert 'с Kwork' not in l.n.intro(row['sid'])
    assert 'ИИ-помощник' in s.db.execute('select text from negotiation_proposals').fetchone()[0]
    assert s.db.execute('select cost from usage').fetchone()[0]==.001


def test_changed_request_cancels_approved_draft(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    p=s.db.execute('select * from negotiation_proposals').fetchone()
    s.db.execute('update negotiation_proposals set message_id=42 where id=?',(p['id'],))
    l.n.approve(p['id'],1,42)
    assert not l.capture(-100123,1,2,'client_user','Ищу разработчика, нужен сайт. В личку.')
    assert l.n.dispatchable() is None
    assert l.n.get(row['sid'])['status']=='paused'


def test_negative_feedback_cancels_and_is_a_training_example(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    l.feedback(row['id'],'not_order')
    assert l.examples()[0]['suitable'] is False
    assert l.n.get(row['sid'])['status']=='closed'
    assert l.n.dispatchable() is None


def test_bad_draft_is_not_a_negative_service_example(setup,monkeypatch):
    _,l,row=generate(setup,monkeypatch);l.feedback(row['id'],'bad_draft')
    assert l.examples()[0]['suitable'] is True
    assert l.examples()[0]['reason']=='bad_draft'


def test_auto_waits_for_time_and_feedback_and_not_only_two_days(setup):
    s,l=setup;now=time.time()
    assert not l.auto_ready(now+3*86400)
    for i in range(30):
        capture(l,i+1,i+10,'Ищу разработчика, нужен бот с функцией '+str(i))
        s.db.execute("UPDATE telegram_leads SET feedback=1,feedback_reason='owner_send' WHERE message_id=?",(i+1,))
    assert not l.auto_ready(now)
    assert l.auto_ready(now+2*86400+1)
    s.set_setting('lead_mode','paused');assert not l.auto_ready(now+3*86400)


def test_auto_needs_current_source_direct_invitation_and_very_high_result(setup,monkeypatch):
    _,l=setup;capture(l)
    monkeypatch.setattr(l,'auto_ready',lambda now=None:True)
    row=dict(l.s.db.execute('select * from telegram_leads').fetchone())
    row.update(probability=.99,buyer=.99,direct=.99)
    assert l.eligible_auto(row)
    assert not l.eligible_auto({**row,'buyer':.5})
    assert not l.eligible_auto({**row,'created_at':time.time()-121})
    assert not l.eligible_auto({**row,'text':'Подскажите, как сделать бота самому?'})
    l.s.db.execute('update lead_sources set auto_allowed=0');assert not l.eligible_auto(row)


def test_model_failure_keeps_one_paid_reserve_without_retry(setup,monkeypatch):
    s,l=setup;capture(l)
    class Bad(FakeAI):
        async def post(self,*args,**kw):raise TimeoutError('provider unavailable')
    monkeypatch.setattr('leads.AI',Bad)
    c=NS(key='test-key',daily=1,session=1)
    assert not asyncio.run(process_one(l,c))
    assert not asyncio.run(process_one(l,c))
    assert s.db.execute('select count(*) from usage').fetchone()[0]==1
    assert s.db.execute('select status from usage').fetchone()[0]=='uncertain'


def test_known_rejected_filter_has_no_draft_cost(setup,monkeypatch):
    s,l=setup;capture(l)
    class No(FakeAI):
        async def post(self,*args,**kw):
            return NS(status_code=200,json=lambda:{'answers':{k:{'noul':.1} for k in ['suitable','buyer','direct']},'usage':{'cost':.0001}})
        async def complete(self,*args,**kw):raise AssertionError('Should not draft')
    monkeypatch.setattr('leads.AI',No)
    assert asyncio.run(process_one(l,NS(key='test',daily=1,session=1)))
    assert s.db.execute('select status from telegram_leads').fetchone()[0]=='filtered'


def test_owner_send_queues_folder_move_only_after_delivery(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    p=s.db.execute('select * from negotiation_proposals').fetchone()
    s.db.execute('update negotiation_proposals set message_id=42 where id=?',(p['id'],))
    l.n.approve(p['id'],1,42)
    assert s.db.execute('select count(*) from negotiation_folder_jobs').fetchone()[0]==0
    item,_=l.n.dispatchable();l.n.delivered(item['id'],50)
    assert s.db.execute('select first_sent from telegram_leads').fetchone()[0]==1
    assert s.db.execute('select client from negotiation_folder_jobs').fetchone()[0]==2


def test_optional_brief_does_not_send_client_link_or_accept_other_person(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    bid=l.brief(row['id'],'test_bot')
    assert s.db.execute('select client from sessions where id=?',(bid,)).fetchone()[0] is None
    assert l.n.dispatchable() is None
    s.db.execute("UPDATE sessions SET client=3,status='done' WHERE id=?",(bid,))
    l.sync_briefs();assert l.n.get(row['sid'])['status']=='paused'


def test_patches_preserve_one_client_and_are_idempotent():
    root=Path(__file__).resolve().parents[3]
    original=(root/'integrations/kwork/kwork_bot.py').read_text()
    changed=kwork(original);assert kwork(changed)==changed
    assert changed.count('leads_integration.callback(')==1
    import ast
    ast.parse(changed)
    personal=Path('/tmp/qubite-tg-listener-live.py')
    if personal.exists():
        src=personal.read_text()
        from install_personal_hooks import patch
        src=patch(src)
        out=listener(src)
        assert listener(out)==out and out.count('TelegramClient(')==1
        assert 'events.MessageEdited' in out


def test_before_send_rechecks_source_hash_sender_and_folder_configuration(setup,monkeypatch):
    import leads_personal as lp
    s,l,row=generate(setup,monkeypatch)
    monkeypatch.setattr(lp,'configuration',lambda:l.c)
    monkeypatch.setitem(sys.modules,'tg_common',NS(notify=lambda text:None))
    class Client:
        async def get_messages(self,*args,**kw):return NS(sender_id=2,raw_text=row['text'])
    client=Client();policy=lambda uid,name:True
    assert not asyncio.run(lp.source_current(client,s,row['sid'],policy))
    s.set_setting('lead_money_folder','3');s.set_setting('lead_heart_folder','4')
    assert asyncio.run(lp.source_current(client,s,row['sid'],policy))
    assert not asyncio.run(lp.source_current(client,s,row['sid'],lambda uid,name:False))
    class Changed(Client):
        async def get_messages(self,*args,**kw):return NS(sender_id=2,raw_text='Нужен другой сайт')
    assert not asyncio.run(lp.source_current(Changed(),s,row['sid'],policy))
    class Other(Client):
        async def get_messages(self,*args,**kw):return NS(sender_id=3,raw_text=row['text'])
    assert not asyncio.run(lp.source_current(Other(),s,row['sid'],policy))


def test_folder_updates_preserve_other_chats_and_all_type_flags(setup,monkeypatch):
    import copy
    import leads_personal as lp
    from telethon.tl.types import DialogFilter,TextWithEntities,InputPeerUser
    from telethon.tl.functions.messages import GetDialogFiltersRequest,UpdateDialogFilterRequest
    s,l=setup
    s.set_setting('lead_money_folder','3');s.set_setting('lead_heart_folder','4')
    s.db.execute('INSERT INTO negotiation_folder_jobs(client,username,created_at,updated_at) VALUES(2,\'client_user\',1,1)')
    path=Path(s.db.execute('pragma database_list').fetchone()[2])
    def opened():
        fresh=Store(path);return fresh,Leads(fresh,l.c)
    monkeypatch.setattr(lp,'opened',opened)
    fs={3:DialogFilter(id=3,title=TextWithEntities('💰',[]),pinned_peers=[InputPeerUser(9,99)],include_peers=[],exclude_peers=[InputPeerUser(2,22)],groups=True),
        4:DialogFilter(id=4,title=TextWithEntities('❤️',[]),pinned_peers=[],include_peers=[InputPeerUser(2,22),InputPeerUser(8,88)],exclude_peers=[],contacts=True,non_contacts=True)}
    touched=[]
    class Client:
        async def get_input_entity(self,uid):return InputPeerUser(uid,22)
        async def __call__(self,req):
            if isinstance(req,GetDialogFiltersRequest):return NS(filters=copy.deepcopy(list(fs.values())))
            assert isinstance(req,UpdateDialogFilterRequest)
            touched.append(req.id);fs[req.id]=req.filter
    asyncio.run(lp.folders(Client(),lambda uid,name:True,lambda text:None))
    assert touched==[3,4]
    assert fs[3].groups and fs[4].contacts and fs[4].non_contacts
    assert fs[3].pinned_peers[0].user_id==9
    assert [p.user_id for p in fs[3].include_peers]==[2]
    assert [p.user_id for p in fs[4].include_peers]==[8]
    assert [p.user_id for p in fs[4].exclude_peers]==[2]
    assert s.db.execute('select status from negotiation_folder_jobs').fetchone()[0]=='done'


def test_subbudget_blocks_paid_calls_without_increasing_brief_limit(setup,monkeypatch):
    s,l=setup;capture(l);l.c['daily_cap_usd']=.001
    class Never(FakeAI):
        def __init__(self,*args):raise AssertionError('Must not call model')
    monkeypatch.setattr('leads.AI',Never)
    assert not asyncio.run(process_one(l,NS(key='test',daily=.05,session=.05)))
    assert s.db.execute('select count(*) from usage').fetchone()[0]==0
    assert s.db.execute('select status from telegram_leads').fetchone()[0]=='budget_wait'


def test_cli_rejects_foreign_owner_before_controls(setup,monkeypatch):
    import leads_cli as cli
    s,l=setup
    path=Path(s.db.execute('pragma database_list').fetchone()[2])
    monkeypatch.setattr(cli,'configuration',lambda:l.c)
    monkeypatch.setattr(cli,'load_env',lambda p:None)
    monkeypatch.setattr(cli,'Config',lambda:NS(owner=1,data=path.parent))
    with pytest.raises(ValueError):asyncio.run(cli.execute({'action':'mode','uid':2,'chat':1,'mode':'paused'}))
    assert s.setting('lead_mode','training')=='training'


def test_good_existing_card_approves_current_draft_and_labels(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    l.good(row['id'])
    assert l.n.dispatchable()
    r=s.db.execute('select * from telegram_leads').fetchone()
    assert r['manual_override']==1 and r['feedback']==1


def test_good_filtered_reuses_ledger_session_and_overrides_jev(setup,monkeypatch):
    s,l=setup;capture(l,now=time.time()-7000)
    sid,_=s.create('Тестовая заявка')
    s.db.execute("UPDATE telegram_leads SET sid=?,status='filtered'",(sid,))
    charge=s.reserve(sid,.0001,'earlier',1,1);s.settle(charge,.0001,'done')
    row=s.db.execute('select * from telegram_leads').fetchone();l.good(row['id'])
    class Low(FakeAI):
        async def post(self,*args,**kw):return NS(status_code=200,json=lambda:{'answers':{k:{'noul':.1} for k in ['suitable','buyer','direct']}})
    monkeypatch.setattr('leads.AI',Low)
    assert asyncio.run(process_one(l,NS(key='test',daily=1,session=1)))
    r=s.db.execute('select * from telegram_leads').fetchone()
    assert r['sid']==sid and r['status']=='approved'
    assert l.n.dispatchable()
    assert s.db.execute('select count(*) from usage where session=?',(sid,)).fetchone()[0]==2


def test_good_cannot_contact_old_or_disabled_source(setup):
    s,l=setup;capture(l,now=time.time()-86401)
    with pytest.raises(ValueError):l.good(1)
    s.db.execute('update telegram_leads set created_at=?',(time.time(),))
    s.db.execute("update lead_sources set status='disabled'")
    with pytest.raises(ValueError):l.good(1)


def test_notifications_separate_leads_and_kwork(setup,monkeypatch):
    from negotiation_cli import notification_events
    s,l,row=generate(setup,monkeypatch)
    other,_=s.create('Kwork-заявка')
    s.db.execute('INSERT INTO negotiations(sid,client,updated) VALUES(?,?,?)',(other,3,time.time()))
    l.n.owner_notice(other,'Только Kwork')
    assert all(r['sid']==row['sid'] for r in notification_events(s,'leads',True))
    assert [r['sid'] for r in notification_events(s,'kwork',True)]==[other]


def test_source_add_and_disable_are_owner_scoped(setup,monkeypatch):
    import leads_cli as cli
    s,l=setup;path=Path(s.db.execute('pragma database_list').fetchone()[2])
    monkeypatch.setattr(cli,'configuration',lambda:l.c)
    monkeypatch.setattr(cli,'load_env',lambda p:None)
    monkeypatch.setattr(cli,'Config',lambda:NS(owner=1,data=path.parent))
    req={'action':'source','uid':1,'chat':1,'username':'https://t.me/new_group','op':'add'}
    asyncio.run(cli.execute(req))
    assert s.db.execute("select status from lead_sources where username='new_group'").fetchone()[0]=='pending'
    asyncio.run(cli.execute(dict(req,op='off')))
    assert s.db.execute("select status from lead_sources where username='new_group'").fetchone()[0]=='disabled'
    with pytest.raises(ValueError):asyncio.run(cli.execute(dict(req,username='https://evil.test/not-a-group')))
    asyncio.run(cli.execute(dict(req,username='Группа без username',op='add')))
    assert s.db.execute("select status from lead_sources where title='Группа без username'").fetchone()[0]=='pending'
    asyncio.run(cli.execute(dict(req,username='-1001234567890',op='add')))
    assert s.db.execute("select status from lead_sources where username='id_1001234567890'").fetchone()[0]=='pending'


def test_separate_bot_denies_other_users_and_requires_prompt_reply(tmp_path):
    from lead_bot import Bot,State
    b=Bot.__new__(Bot);b.owner=1;b.state=State(tmp_path/'lead-bot.sqlite')
    calls=[];b.send=lambda text,rows=None:calls.append(text);b.source=lambda *a:calls.append(a)
    b.handle({'message':{'from':{'id':2},'chat':{'id':1},'text':'/start'}})
    assert calls==[]
    b.state.set('add_source_prompt','42')
    b.handle({'message':{'from':{'id':1},'chat':{'id':1},'text':'@new_group','reply_to_message':{'message_id':42}}})
    assert calls==[('@new_group','add')] and b.state.get('add_source_prompt')==''


def test_source_current_rejects_disabled_source_even_with_manual_override(setup,monkeypatch):
    import leads_personal as p
    s,l=setup;capture(l);sid,_=s.create('Тест')
    s.db.execute('update telegram_leads set sid=?,manual_override=1',(sid,))
    s.set_setting('lead_money_folder','3');s.set_setting('lead_heart_folder','4')
    s.db.execute("update lead_sources set status='disabled'")
    monkeypatch.setattr(p,'configuration',lambda:l.c)
    assert not asyncio.run(p.source_current(NS(),s,sid,lambda *a:True))


def test_group_capture_does_not_notify_reads(setup,monkeypatch):
    from datetime import datetime,timezone
    import leads_personal as p
    s,l=setup;path=Path(s.db.execute('pragma database_list').fetchone()[2])
    def opened():
        other=Store(path);return other,Leads(other,l.c)
    monkeypatch.setattr(p,'opened',opened)
    async def sender():return NS(id=2,first_name='Автор',username='user',bot=False)
    ev=NS(out=False,is_private=False,chat_id=-100123,date=datetime.now(timezone.utc),get_sender=sender,message=NS(reply_to=None),raw_text='Ищу разработчика. Нужен бот.',id=1)
    assert asyncio.run(p.forward(ev,lambda *a:True))
    assert s.db.execute('select count(*) from telegram_leads').fetchone()[0]==1


def test_only_successful_send_creates_complete_audit_once(setup,monkeypatch):
    import negotiation_personal as p
    s,l=setup;path=Path(s.db.execute('pragma database_list').fetchone()[2])
    sid,_=s.create('Тестовая отправка')
    s.db.execute('INSERT INTO negotiations(sid,client,username,updated) VALUES(?,?,?,?)',(sid,2,'user',time.time()))
    l.n.queue(sid,'reply','Тестовый текст без обрезки '*100)
    calls=[]
    monkeypatch.setattr(p,'configuration',lambda:{'enabled':True,'data_dir':str(path.parent),'owner':1,'profile_url':l.c['profile_url']})
    monkeypatch.setitem(sys.modules,'tg_common',NS(require=lambda *a:('dummy','1')))
    monkeypatch.setattr('requests.post',lambda *a,**kw:(calls.append(kw['json']['text']) or NS(json=lambda:{'ok':True})))
    asyncio.run(p.notify_sent());assert not calls
    item,_=l.n.dispatchable();l.n.delivered(item['id'],55)
    asyncio.run(p.notify_sent());first=len(calls)
    assert first==2 and 'Тестовый текст' in calls[0]
    asyncio.run(p.notify_sent());assert len(calls)==first


@pytest.mark.parametrize('ambiguous',[False,True])
def test_exact_title_resolution_uses_metadata_and_avoids_duplicate_source(setup,monkeypatch,ambiguous):
    import leads_personal as p
    from datetime import datetime,timezone
    from telethon.tl.types import DialogFilter,TextWithEntities,InputPeerUser,Channel,ChatPhotoEmpty
    from telethon.tl.functions.messages import GetDialogFiltersRequest
    s,l=setup;path=Path(s.db.execute('pragma database_list').fetchone()[2])
    s.db.execute('update lead_sources set chat_id=-1001234567890')
    s.db.execute("INSERT INTO lead_sources(username,title,created_at,updated_at) VALUES('title_test','Без username',1,1)")
    def opened():
        fresh=Store(path);return fresh,Leads(fresh,l.c)
    monkeypatch.setattr(p,'opened',opened)
    group=Channel(id=1234567890,title='Без username',photo=ChatPhotoEmpty(),date=datetime.now(timezone.utc),megagroup=True)
    fs=[DialogFilter(id=3,title=TextWithEntities('💰',[]),pinned_peers=[],include_peers=[InputPeerUser(2,22)],exclude_peers=[]),
        DialogFilter(id=4,title=TextWithEntities('❤️',[]),pinned_peers=[],include_peers=[InputPeerUser(3,33)],exclude_peers=[InputPeerUser(2,22)])]
    class Client:
        async def get_me(self):return NS(id=1)
        async def get_entity(self,ref):return NS(id=2 if ref=='mbemlin' else 3,username=ref,contact=False)
        async def __call__(self,req):
            assert isinstance(req,GetDialogFiltersRequest), 'Must not join or read messages for duplicate/ambiguous title'
            return NS(filters=fs)
        async def iter_dialogs(self):
            yield NS(name='Без username',entity=group)
            if ambiguous:
                other=Channel(id=1234567891,title='Без username',photo=ChatPhotoEmpty(),date=datetime.now(timezone.utc),megagroup=True)
                yield NS(name='Без username',entity=other)
    asyncio.run(p.setup(Client(),lambda *a:True,lambda *a:pytest.fail('No read notifications')))
    row=s.db.execute("select * from lead_sources where username='title_test'").fetchone()
    assert (row['status']=='unavailable') if ambiguous else row is None


def lifecycle_bot(s,l,monkeypatch):
    import lead_bot as module
    path=Path(s.db.execute('pragma database_list').fetchone()[2])
    monkeypatch.setattr(module,'configuration',lambda:dict(l.c,data_dir=str(path.parent)))
    b=module.Bot.__new__(module.Bot);b.owner=1;calls=[]
    def api(method,payload,timeout=15):
        calls.append((method,payload));return {'message_id':payload.get('message_id',100)}
    b.api=api;b.send=lambda text,rows=None:api('sendMessage',{'text':text,'reply_markup':rows})
    return b,calls


@pytest.mark.parametrize('reason',['not_order','not_service'])
def test_rejected_card_is_deleted_once_and_training_retained(setup,monkeypatch,reason):
    s,l,row=generate(setup,monkeypatch)
    s.set_setting('lead.card.1','42');l.feedback(1,reason)
    b,calls=lifecycle_bot(s,l,monkeypatch);b.notices();b.notices()
    assert [m for m,p in calls]==['deleteMessage']
    assert s.db.execute('select feedback from telegram_leads').fetchone()[0]==-1
    assert s.setting('lead.card.1')==''


def test_good_status_edits_same_card_then_deletes_after_delivery(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    s.set_setting('lead.card.1','42');s.set_setting('lead.cardtext.1','Исходная карточка')
    l.good(1);b,calls=lifecycle_bot(s,l,monkeypatch)
    b.notices();b.notices()
    assert [m for m,p in calls]==['editMessageText'] and calls[0][1]['message_id']==42
    item,_=l.n.dispatchable();l.n.delivered(item['id'],55)
    b.notices();assert [m for m,p in calls]==['editMessageText','deleteMessage']


def test_failed_status_reuses_card_and_does_not_hide_paused_send(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    s.set_setting('lead.card.1','42');s.set_setting('lead.cardtext.1','Исходная карточка')
    l.good(1);l.n.pause(row['sid'],'Остановлено')
    b,calls=lifecycle_bot(s,l,monkeypatch);b.notices()
    assert [m for m,p in calls]==['editMessageText'] and 'остановлена' in calls[0][1]['text']


def test_good_double_click_does_not_create_second_attempt(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch);l.good(1)
    with pytest.raises(ValueError):l.good(1)
    assert s.db.execute('select count(*) from negotiation_personal_outbox').fetchone()[0]==1


def test_rejection_during_model_wait_cannot_restore_or_send_card(setup,monkeypatch):
    s,l=setup;capture(l);s.db.execute('update telegram_leads set manual_override=1')
    class Cancelled(FakeAI):
        async def complete(self,*args,**kw):
            l.feedback(1,'not_order');return await super().complete(*args,**kw)
    monkeypatch.setattr('leads.AI',Cancelled)
    assert not asyncio.run(process_one(l,NS(key='test',daily=1,session=1)))
    assert s.db.execute('select status from telegram_leads').fetchone()[0]=='rejected'
    assert s.db.execute('select count(*) from negotiation_personal_outbox').fetchone()[0]==0


def test_uncertain_advice_does_not_generate_paid_draft(setup,monkeypatch):
    s,l=setup;capture(l,text='Подскажите, как исправить лица на фото?',uid=2)
    class Advice(FakeAI):
        async def post(self,*args,**kw):
            assert 'context' not in kw['json']['state']
            return await super().post(*args,**kw)
        async def complete(self,*args,**kw):raise AssertionError('Advice must not draft')
    monkeypatch.setattr('leads.AI',Advice)
    assert asyncio.run(process_one(l,NS(key='test',daily=1,session=1)))
    assert s.db.execute('select status from telegram_leads').fetchone()[0]=='uncertain'
    assert s.db.execute('select count(*) from negotiation_proposals').fetchone()[0]==0


def test_negative_feedback_is_quiet_and_not_a_reply_style_example(setup,monkeypatch):
    s,l,row=generate(setup,monkeypatch)
    before=s.db.execute('select count(*) from negotiation_owner_outbox').fetchone()[0]
    l.feedback(1,'not_order')
    assert s.db.execute('select count(*) from negotiation_owner_outbox').fetchone()[0]==before
    assert l.examples()[0]['reply_example']==''


def test_legacy_cleanup_only_deletes_our_bot_stale_cards(setup,monkeypatch,tmp_path):
    import leads_personal as p
    from datetime import datetime,timezone
    s,l,row=generate(setup,monkeypatch);l.feedback(1,'not_order')
    s.db.execute('update negotiation_proposals set message_id=42')
    s.set_setting('lead_cleanup_legacy','requested')
    path=Path(s.db.execute('pragma database_list').fetchone()[2])
    def opened():
        fresh=Store(path);return fresh,Leads(fresh,l.c)
    monkeypatch.setattr(p,'opened',opened)
    monkeypatch.setattr(Path,'home',lambda:tmp_path)
    root=tmp_path/'services/qubite-specbot';root.mkdir(parents=True)
    (root/'lead-bot-private.json').write_text(json.dumps({'token':'123456789:dummy','owner':1}))
    now=datetime.now(timezone.utc)
    messages=[NS(id=42,sender_id=123456789,raw_text='Старая карточка',date=now),NS(id=43,sender_id=1,raw_text='Telegram-заявка 1',date=now),NS(id=44,sender_id=123456789,raw_text='Telegram-заявка 1',date=now),NS(id=45,sender_id=123456789,raw_text='Другое сообщение',date=now)]
    class Client:
        async def get_me(self):return NS(id=1)
        async def get_entity(self,name):assert name=='Gdhdhdjdjbtnbot';return NS(id=123456789,bot=True)
        async def get_messages(self,peer,limit):assert peer.id==123456789 and limit==100;return messages
    deleted=[]
    monkeypatch.setattr('requests.post',lambda *a,**kw:(deleted.append(kw['json']['message_id']) or NS(json=lambda:{'ok':True})))
    asyncio.run(p.cleanup_legacy_cards(Client(),lambda *a:True))
    assert deleted==[42,44] and s.setting('lead_cleanup_legacy')=='complete:2'
