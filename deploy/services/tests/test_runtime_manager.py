import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('runtime_manager',Path(__file__).parents[2]/'runtime-manager.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RuntimeTests(unittest.TestCase):
 def test_core_services_cannot_be_stopped(self):
  for service in ['qubite-auth','qubite-control-bot','tailscaled','sing-box','cloudflared','caddy','ssh','memos; reboot','../qubite-auth']:
   with self.subTest(service=service),patch.object(m,'run') as run:
    with self.assertRaises(ValueError):m.manage({'action':'set','id':service,'enabled':False})
    run.assert_not_called()
 def test_only_boolean_and_exact_schema(self):
  for data in [{'action':'set','id':'memos','enabled':0},{'action':'set','id':'memos','enabled':False,'command':'reboot'},[],{'action':'status','id':'ssh'}]:
   with patch.object(m,'run') as run:
    with self.assertRaises(ValueError):m.manage(data)
    run.assert_not_called()
 def test_stop_preserves_container(self):
  with patch.object(m,'status',side_effect=[{'state':'running','running':True},{'state':'exited','running':False}]),patch.object(m,'run') as run:
   run.return_value.returncode=0
   self.assertTrue(m.manage({'action':'set','id':'memos','enabled':False})['ok'])
   run.assert_called_once_with(['docker','stop','memos'])
 def test_failure_is_not_reported_success(self):
  with patch.object(m,'status',return_value={'state':'active','running':True}),patch.object(m,'run') as run:
   run.return_value.returncode=1
   with self.assertRaises(RuntimeError):m.manage({'action':'set','id':'qubite','enabled':False})
 def test_missing_service_is_not_created(self):
  with patch.object(m,'status',return_value={'state':'missing'}),patch.object(m,'run') as run:
   with self.assertRaises(RuntimeError):m.manage({'action':'set','id':'memos','enabled':True})
   run.assert_not_called()

