import importlib.util,pathlib,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).parents[1]/'server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ScopeTests(unittest.TestCase):
 def setUp(self):self.c=m.Client({'token':'not-real','notebook':'20261009111111-abcdefg'})
 def test_no_arbitrary_actions(self):
  for name in ['sql','siyuan_delete','siyuan_read_file']:
   with self.assertRaises(ValueError):self.c.call(name,{})
 def test_private_and_hostile_ids_denied(self):
  with patch.object(self.c,'request',return_value=[]) as request:
   with self.assertRaises(ValueError):self.c.call('siyuan_read_note',{'id':'20261009111111-private'})
   self.assertEqual(request.call_count,1)
   with self.assertRaises(ValueError):self.c.call('siyuan_read_note',{'id':"x' OR 1=1"})
   self.assertEqual(request.call_count,1)
 def test_search_escapes_sql_and_is_scoped(self):
  with patch.object(self.c,'request',return_value=[]) as request:
   self.c.call('siyuan_search',{'query':"' OR 1=1 --"});stmt=request.call_args.args[1]['stmt']
   self.assertIn("box='20261009111111-abcdefg'",stmt);self.assertIn("''' OR 1=1 --'",stmt);self.assertTrue(stmt.endswith('LIMIT 20'))
 def test_root_overwrite_extra_arguments_and_paths_denied(self):
  with patch.object(self.c,'belongs',return_value={'id':'20261009111111-abcdefg','type':'d'}):
   with self.assertRaises(ValueError):self.c.call('siyuan_update_block',{'id':'20261009111111-abcdefg','markdown':'replace'})
  for args in [{'title':'../private','markdown':'x'},{'title':'note','markdown':'x','notebook':'other'}]:
   with self.assertRaises(ValueError):self.c.call('siyuan_create_note',args)
 def test_no_secret_on_result(self):
  self.assertEqual(len(m.TOOLS),7)
  self.assertTrue(all(x[1]['additionalProperties'] is False for x in m.TOOLS.values()))
if __name__=='__main__':unittest.main()
