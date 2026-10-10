import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from store import Store
from bridge import create_invitation
from negotiation import Negotiations, generate_one, validate, COMMITMENT
import negotiation_personal as personal
from install_personal_hooks import patch as patch_listener


def test_listener_patch_keeps_single_session_and_original_stt():
    original=Path('/tmp/qubite-tg-listener-live.py').read_text() if Path('/tmp/qubite-tg-listener-live.py').exists() else '''import asyncio
import tempfile
from telethon import TelegramClient, events
async def main():
    client=TelegramClient(SESSION,1,'hash')
    work_lock = asyncio.Lock()
    async def handler(event):
        async with work_lock: await handle(event)
    async def handle(event):
        text=await asyncio.to_thread(transcribe,path)
        kind = "🎙 Голосовое"
    await client.run_until_disconnected()
'''
    updated=patch_listener(original)
    assert patch_listener(updated)==updated
    assert updated.count('TelegramClient(')==1
    assert 'asyncio.to_thread(transcribe, path)' in updated or 'asyncio.to_thread(transcribe,path)' in updated
    assert 'forward_event(event,negotiation_policy,text)' in updated
    assert 'asyncio.create_task(outbound_loop(client,negotiation_policy))' in updated


@pytest.fixture
def setup(tmp_path):
    s=Store(tmp_path/'data'/'specbot.sqlite')
    invite=create_invitation(s,{'oid':'123','title':'Каталог','preset':'development','focus':'Каталог и доставка'},b'x'*32,1,'test_bot')
    sid=invite['sid'];s.claim(invite['url'].split('start=')[1],2);s.profile(sid,{'id':2,'username':'client_user'})
    s.update(sid,status='active')
    n=Negotiations(s,1);n.discover(0)
    return s,n,sid


def result(action='offer',**kw):
    return {'action':action,'reply':'Уточните, какие материалы уже подготовлены?','price_rub':15000 if action in ('offer','propose') else 0,
            'days':7 if action in ('offer','propose') else 0,'scope':'Каталог с доставкой','reason':'Нужно уточнить материалы','summary':'Каталог и доставка',**kw}


def approve(n,s,ident,mid=42):
    s.db.execute('UPDATE negotiation_proposals SET message_id=? WHERE id=?',(mid,ident))
    return n.approve(ident,1,mid)


def test_done_proposal_requires_exact_owner_approval(setup):
    s,n,sid=setup;s.update(sid,status='done')
    assert n.pending_model()[1]=='offer'
    assert n.apply(sid,0,'offer',result(),0)
    assert n.dispatchable() is None
    p=s.db.execute('SELECT * FROM negotiation_proposals').fetchone()
    assert '15000 ₽' in p['text'] and '7 дней' in p['text'] and 'ИИ-помощник' in p['text']
    assert 'https://kwork.ru/user/kirillkuz_ai' in p['text']
    with pytest.raises(ValueError):n.approve(p['id'],1,100)
    approve(n,s,p['id'])
    item,_=n.dispatchable();assert item['text']==p['text']
    n.delivered(item['id'],50);n.delivered(item['id'],50)
    assert s.db.execute("select count(*) from negotiation_messages where role='assistant'").fetchone()[0]==1


def test_new_client_message_invalidates_approval_and_pending_send(setup):
    s,n,sid=setup;ident=n.propose(sid,result());approve(n,s,ident)
    n.receive(2,101,'А ещё нужна интеграция с CRM')
    assert n.dispatchable() is None
    with pytest.raises(ValueError):n.approve(ident,1,42)


def test_owner_edit_is_new_version_and_old_button_cannot_send(setup):
    s,n,sid=setup;ident=n.propose(sid,result());s.db.execute('UPDATE negotiation_proposals SET message_id=42 WHERE id=?',(ident,))
    n.revise(ident,20000,10,'Каталог и CRM')
    with pytest.raises(ValueError):n.approve(ident,1,42)
    s.db.execute('UPDATE negotiation_proposals SET message_id=43 WHERE id=?',(ident,))
    n.approve(ident,2,43)
    item,_=n.dispatchable();assert '20000 ₽' in item['text'] and '10 дней' in item['text']


def test_only_one_reminder_after_thirty_minutes_and_error_rescue(setup):
    s,n,sid=setup
    now=10000;s.db.execute('UPDATE sessions SET updated=? WHERE id=?',(now,sid));s.db.execute('UPDATE negotiations SET updated=? WHERE sid=?',(now,sid))
    n.discover(0,now=now+1799);assert n.dispatchable() is None
    n.discover(0,now=now+1800);assert n.dispatchable()[0]['kind']=='reminder'
    n.discover(0,now=now+3600)
    assert s.db.execute('SELECT count(*) FROM negotiation_personal_outbox').fetchone()[0]==1
    s.enqueue(sid,'interview');s.db.execute("UPDATE jobs SET status='failed'")
    n.discover(0,now=now+3601)
    assert s.db.execute("SELECT count(*) FROM negotiation_personal_outbox WHERE kind='rescue'").fetchone()[0]==1
    n.discover(0,now=now+3602)
    assert s.db.execute('SELECT count(*) FROM negotiation_personal_outbox').fetchone()[0]==2


def test_paused_or_revoked_brief_stops_personal_automation(setup):
    s,n,sid=setup;n.queue(sid,'reminder','Помощь')
    s.mode(sid,'paused');assert n.dispatchable() is None
    assert not n.receive(2,99,'Привет')


def test_foreign_chat_duplicate_message_and_optout(setup):
    s,n,sid=setup
    assert not n.receive(3,1,'Чужие данные')
    assert n.receive(2,1,'Можно обсудить?') and not n.receive(2,1,'Дубликат')
    n.queue(sid,'question','Какие материалы?')
    assert n.receive(2,2,'Не пишите мне больше')
    assert n.get(sid)['status']=='paused' and n.dispatchable() is None


def test_question_auto_but_money_and_promises_owner_only(setup):
    s,n,sid=setup
    n.apply(sid,0,'reply',result('question'),0)
    assert n.dispatchable()[0]['kind']=='question'
    n.apply(sid,0,'reply',result('question',reply='Сделаем бесплатно за 2 дня, согласны?'),0)
    assert s.db.execute('select count(*) from negotiation_proposals').fetchone()[0]==1
    assert s.db.execute('select count(*) from negotiation_personal_outbox').fetchone()[0]==1


def test_unhandled_messages_are_not_truncated_and_summary_is_preserved(setup):
    s,n,sid=setup
    s.db.execute('UPDATE negotiations SET summary=? WHERE sid=?',('Важное старое условие',sid))
    for i in range(15):n.receive(2,i+1,'Сообщение '+str(i)+' '*3000)
    payload,cursor=n.context(sid)
    assert len(payload['dialogue'])==15 and cursor==15
    assert payload['negotiation_summary']=='Важное старое условие'


def test_failed_model_does_not_retry_or_starve_other_clients(setup):
    s,n,sid=setup;s.update(sid,status='done')
    class FakeAI:
        calls=0
        async def complete(self,*args):self.calls+=1;raise ValueError('Failure')
    ai=FakeAI()
    asyncio.run(generate_one(n,ai));asyncio.run(generate_one(n,ai))
    assert ai.calls==1
    assert s.db.execute("select count(*) from negotiation_attempts where status='failed'").fetchone()[0]==1
    assert s.db.execute("select count(*) from negotiation_owner_outbox where text like '%платного повтора%'").fetchone()[0]==1


def test_changed_revision_during_model_call_never_sent(setup):
    s,n,sid=setup;s.update(sid,status='done')
    class FakeAI:
        async def complete(self,*args):n.receive(2,8,'Требования изменились');return result(),'test'
    assert asyncio.run(generate_one(n,FakeAI())) is False
    assert n.dispatchable() is None
    assert s.db.execute('select count(*) from negotiation_proposals').fetchone()[0]==0


def test_personal_username_resolution_cannot_switch_recipient(setup,monkeypatch):
    s,n,sid=setup;n.queue(sid,'reminder','Помощь')
    cfg={'enabled':True,'data_dir':str(Path(s.db.execute('pragma database_list').fetchone()[2]).parent),'owner':1,'profile_url':n.profile}
    monkeypatch.setattr(personal,'configuration',lambda:cfg)
    class Client:
        async def get_me(self):return SimpleNamespace(id=1)
        async def get_input_entity(self,peer):raise ValueError('Not cached')
        async def get_entity(self,username):return SimpleNamespace(id=999,bot=False)
        async def __call__(self,*args):pytest.fail('Wrong peer must never receive a message')
    assert asyncio.run(personal.send_one(Client(),lambda *args:True)) is False
    assert n.get(sid)['status']=='paused'


def test_personal_hard_block_prevents_sending_and_forwarding(setup,monkeypatch):
    s,n,sid=setup;n.queue(sid,'reminder','Помощь')
    cfg={'enabled':True,'data_dir':str(Path(s.db.execute('pragma database_list').fetchone()[2]).parent),'owner':1,'profile_url':n.profile}
    monkeypatch.setattr(personal,'configuration',lambda:cfg)
    class Client:
        async def get_me(self):return SimpleNamespace(id=1)
        async def get_input_entity(self,*args):pytest.fail('Blocked peer cannot be resolved')
    assert asyncio.run(personal.send_one(Client(),lambda *args:False)) is False
    assert n.get(sid)['status']=='paused'


def test_brief_change_invalidates_approved_offer(setup):
    s,n,sid=setup;ident=n.propose(sid,result());approve(n,s,ident)
    s.update(sid,revision=s.get(sid)['revision']+1)
    assert n.dispatchable() is None
    with pytest.raises(ValueError):n.approve(ident,1,42)
    n.discover(0)
    assert s.db.execute('SELECT status FROM negotiation_proposals WHERE id=?',(ident,)).fetchone()[0]=='stale'


def test_crash_recovery_once_and_no_automatic_resend(setup):
    s,n,sid=setup;ident=n.queue(sid,'question','Какие материалы?')
    s.db.execute("UPDATE negotiation_personal_outbox SET status='sending',sending_started=1 WHERE id=?",(ident,))
    s.db.execute("INSERT INTO negotiation_attempts VALUES(?,0,'reply','running',1)",(sid,))
    n.recover(1000);count=s.db.execute('SELECT COUNT(*) FROM negotiation_owner_outbox').fetchone()[0]
    n.recover(2000)
    assert s.db.execute('SELECT COUNT(*) FROM negotiation_owner_outbox').fetchone()[0]==count
    assert n.get(sid)['status']=='paused' and n.dispatchable() is None
    assert s.db.execute('SELECT status FROM negotiation_personal_outbox WHERE id=?',(ident,)).fetchone()[0]=='uncertain'


def test_personal_receive_scoped_and_incoming_owner_audit(setup,monkeypatch):
    s,n,sid=setup
    cfg={'enabled':True,'data_dir':str(Path(s.db.execute('pragma database_list').fetchone()[2]).parent),'owner':1,'profile_url':n.profile}
    monkeypatch.setattr(personal,'configuration',lambda:cfg)
    class Event:
        is_private=True;out=False;sender_id=2;id=55;raw_text='Можно уточнить?'
        async def get_sender(self):return SimpleNamespace(id=self.sender_id,username='client_user',bot=False)
    event=Event()
    assert not asyncio.run(personal.forward_event(event,lambda *args:False))
    event.sender_id=99
    assert not asyncio.run(personal.forward_event(event,lambda *args:True))
    event.sender_id=2;event.is_private=False
    assert not asyncio.run(personal.forward_event(event,lambda *args:True))
    event.is_private=True
    assert asyncio.run(personal.forward_event(event,lambda *args:True))
    assert s.db.execute("SELECT COUNT(*) FROM negotiation_owner_outbox WHERE text LIKE 'Клиент%'").fetchone()[0]==1


def test_personal_success_uses_exact_approved_text_and_random_id(setup,monkeypatch):
    s,n,sid=setup;ident=n.propose(sid,result());approve(n,s,ident)
    item=n.dispatchable()[0]
    cfg={'enabled':True,'data_dir':str(Path(s.db.execute('pragma database_list').fetchone()[2]).parent),'owner':1,'profile_url':n.profile}
    monkeypatch.setattr(personal,'configuration',lambda:cfg)
    # Test the native request boundary without installing or logging into another client.
    import types
    module=types.ModuleType('telethon.tl.functions.messages')
    module.SendMessageRequest=lambda **kw:SimpleNamespace(**kw)
    monkeypatch.setitem(sys.modules,'telethon.tl.functions.messages',module)
    class Client:
        async def get_me(self):return SimpleNamespace(id=1)
        async def get_input_entity(self,uid):return SimpleNamespace(user_id=uid)
        async def __call__(self,request):
            assert request.peer.user_id==2
            assert request.message==item['text'] and request.random_id==item['random_id']
            return SimpleNamespace(id=888)
    assert asyncio.run(personal.send_one(Client(),lambda *args:True))
    assert s.db.execute('SELECT status FROM negotiation_proposals WHERE id=?',(ident,)).fetchone()[0]=='sent'
    assert asyncio.run(personal.send_one(Client(),lambda *args:True)) is False


def test_manual_pause_resume_and_close(setup):
    s,n,sid=setup;n.pause(sid);n.resume(sid);assert n.get(sid)['status']=='active'
    n.close(sid);assert n.get(sid)['status']=='closed'
    with pytest.raises(ValueError):n.resume(sid)
