import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from caddy_merge import merge_master
class Merge(unittest.TestCase):
 def test_master_preserves_naive_and_tls_port(self):
  source='{\n https_port 18443\n}\nproxy.example {\n forward_proxy {}\n}\nhttps://example.org, https://www.example.org {\n reverse_proxy localhost:8080\n}\n'
  out,reused=merge_master(source,'example.org',9130)
  self.assertTrue(reused);self.assertIn('https_port 18443',out);self.assertIn('forward_proxy {}',out);self.assertIn('reverse_proxy 127.0.0.1:9130',out)
 def test_existing_custom_site_is_not_overwritten(self):
  with self.assertRaises(ValueError):merge_master('example.org {\n reverse_proxy 127.0.0.1:7777\n}', 'example.org',9130)
 def test_new_host_appends_without_replacement(self):
  source='other.example {\n reverse_proxy localhost:8080\n}'
  self.assertEqual(merge_master(source,'example.org',9130),(source,False))
if __name__=='__main__':unittest.main()

class SplitAuth(unittest.TestCase):
 def test_guard_is_ordered_before_auth_and_proxy(self):
  from caddy_merge import portal_routes,knowledge_route
  portal=portal_routes(9130,9131,'qubite.example')
  self.assertIn('route {',portal);self.assertLess(portal.index('respond @wrongHost'),portal.index('handle @auth'))
  self.assertIn('/privacy.html',portal);self.assertIn('127.0.0.1:9131',portal)
  native=knowledge_route('memos.example','memos',9131,5230,'test-key')
  self.assertLess(native.index('respond @wrongHost'),native.index('forward_auth'))
  with self.assertRaises(ValueError):knowledge_route('evil.example','auth',1,2,'key')
