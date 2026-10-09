import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('knowledge_manager',Path(__file__).parents[2]/'knowledge-manager.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class EnrollmentTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  root=Path(self.temp.name)
  for key,value in [('STATE',root/'state.json'),('CONFIG',root/'config.json')]:
   p=patch.object(m,key,value);p.start();self.addCleanup(p.stop)
  m.CONFIG.write_text(json.dumps({'memos_token':'not-a-real-token','vikunja_db':'unused'}))
  self.data={'action':'enroll','service':'memos','user_id':1,'login':'friend','email':'friend@example.org','password':'SamplePass731'}
 def fresh(self,method,url,data=None,token=None):
  if method=='GET':raise urllib.error.HTTPError(url,404,'Not found',{},None)
  return {'name':'users/friend'}
 def test_replay_never_changes_first_password_and_state_contains_no_secret(self):
  with patch.object(m,'native',side_effect=self.fresh) as native:
   self.assertTrue(m.manage(self.data)['ok']);calls=native.call_count
   with self.assertRaises(m.Denied):m.manage({**self.data,'password':'DifferentPass123'})
   self.assertEqual(native.call_count,calls)
  self.assertNotIn(self.data['password'],m.STATE.read_text());self.assertNotIn('not-a-real-token',m.STATE.read_text())
  self.assertEqual(m.STATE.stat().st_mode&0o777,0o600)
  self.assertTrue(m.manage({k:v for k,v in {**self.data,'action':'info'}.items() if k!='password'})['ready'])
 def test_existing_foreign_account_cannot_be_claimed(self):
  with patch.object(m,'native',return_value={'name':'users/friend'}) as native:
   with self.assertRaises(m.Denied):m.manage(self.data)
   self.assertEqual(native.call_count,1);self.assertEqual(m.load(),{})
 def test_only_explicit_prepared_identity_can_set_own_password(self):
  m.save({'1:memos':{'state':'pending_owner','login':'kirill','native_id':'users/kirill'}})
  with patch.object(m,'native',return_value={'name':'users/foreign'}):
   with self.assertRaises(m.Denied):m.manage(self.data)
  with patch.object(m,'native',return_value={'name':'users/kirill'}) as native:
   m.manage(self.data)
   self.assertEqual(native.call_args_list[1].args[0],'PATCH');self.assertIn('/users/kirill?',native.call_args_list[1].args[1])
 def test_ambiguous_failure_requires_review_instead_of_reset_retry(self):
  with patch.object(m,'native',side_effect=[urllib.error.HTTPError('',404,'',{},None),RuntimeError('Unavailable')]):
   with self.assertRaises(RuntimeError):m.manage(self.data)
  self.assertEqual(m.load()['1:memos']['state'],'creating')
  with patch.object(m,'native') as native:
   with self.assertRaises(m.Denied):m.manage(self.data)
   native.assert_not_called()
 def test_payload_rejects_arbitrary_fields_ids_and_services(self):
  for change in [{'user_id':True},{'service':'ssh'},{'command':'reboot'},{'login':'../../root'},{'password':'short'},{'password':'A1'+'я'*36}]:
   with self.subTest(change=change),patch.object(m,'native') as native:
    with self.assertRaises(ValueError):m.manage({**self.data,**change})
    native.assert_not_called()
 def test_unsupported_native_login_is_stable_id_not_username_collision(self):
  self.assertEqual(m.native_username({**self.data,'login':'test_3g8jq4'}),'qb-1')

 def test_native_lookup_exposes_only_active_exact_binding(self):
  m.save({'1:memos':{'state':'pending_owner','login':'kirill','native_id':'users/kirill'}})
  self.assertFalse(m.manage({'action':'lookup','service':'memos','login':'kirill'})['ready'])
  state=m.load();state['1:memos']['state']='active';m.save(state)
  self.assertEqual(m.manage({'action':'lookup','service':'memos','login':'kirill'}),{'ready':True,'user_id':1,'login':'kirill','native_id':'users/kirill'})
  self.assertFalse(m.manage({'action':'lookup','service':'vikunja','login':'kirill'})['ready'])
