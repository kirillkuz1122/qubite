import json
from kwork_bot import State,handle_callback,keyboard

def setup(tmp_path):
 s=State(tmp_path);s.save({'id':'123','title':'Test'});s.sent('123',17,False);return s

def callback(owner=5,data='gen:123',mid=17):
 return {'from':{'id':owner},'message':{'chat':{'id':5},'message_id':mid},'data':data}

def test_duplicate_generation(tmp_path):
 s=setup(tmp_path);assert handle_callback(s,callback(),5)=='Готовим отклик'
 assert handle_callback(s,callback(),5)=='Отклик уже в очереди'
 assert s.claim()['kind']=='gen';assert s.claim() is None

def test_foreign_owner_or_message(tmp_path):
 s=setup(tmp_path)
 assert 'владельцу' in handle_callback(s,callback(owner=6),5)
 assert 'недоступна' in handle_callback(s,callback(mid=18),5)
 assert s.claim() is None

def test_delete_cancels_and_blocks_generation(tmp_path):
 s=setup(tmp_path);handle_callback(s,callback(),5);handle_callback(s,callback(data='del:123'),5)
 assert s.get('123')['deleted'];assert s.claim()['kind']=='del';assert s.claim() is None
 assert 'удалено' in handle_callback(s,callback(),5)
 s.save({'id':'123','title':'Updated'})
 assert s.get('123')['deleted']

def test_delete_while_generation_running(tmp_path):
 s=setup(tmp_path);handle_callback(s,callback(),5);job=s.claim()
 handle_callback(s,callback(data='del:123'),5)
 assert s.get('123')['deleted'];assert s.claim()['kind']=='del'
 s.finish(job['id']);assert s.get('123')['deleted']

def test_red_delete_and_no_generation_for_ready():
 k=keyboard('123',True)['inline_keyboard']
 assert k[-1][0]['style']=='danger';assert len(k)==3


def test_feedback_is_owner_scoped_mutable_and_survives_delete(tmp_path):
 s=setup(tmp_path)
 assert 'владельцу' in handle_callback(s,callback(owner=6,data='like:123'),5)
 assert 'недоступна' in handle_callback(s,callback(mid=18,data='like:123'),5)
 assert 'подходят' in handle_callback(s,callback(data='like:123'),5)
 assert 'не подходят' in handle_callback(s,callback(data='dislike:123'),5)
 with s.db() as c:
  rows=c.execute('SELECT * FROM feedback').fetchall()
 assert len(rows)==1 and rows[0]['rating']==-1
 handle_callback(s,callback(data='del:123'),5)
 with s.db() as c:assert c.execute('SELECT count(*) FROM feedback').fetchone()[0]==1
 assert 'удалено' in handle_callback(s,callback(data='like:123'),5)


def test_feedback_examples_are_small_balanced_and_no_drafts(tmp_path,monkeypatch):
 import kwork_parser
 s=State(tmp_path);monkeypatch.setenv('KWORK_BOT_ROOT',str(tmp_path))
 before=kwork_parser.feedback_revision()
 for i in range(20):
  oid=str(100+i);s.save({'id':oid,'title':'Telegram бот' if i%2 else 'Дизайн сайта','description':'Нужен небольшой проект','reply':'SECRET DRAFT'});s.sent(oid,100+i,False)
  s.callback('like' if i%2 else 'dislike',oid,100+i)
 examples=kwork_parser.feedback_examples([{'title':'Telegram бот','description':'Нужен проект'}])
 assert len(examples)==12 and sum(e['liked'] for e in examples)==6
 assert 'SECRET DRAFT' not in json.dumps(examples) and kwork_parser.feedback_revision()!=before
