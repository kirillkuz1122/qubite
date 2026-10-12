import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / 'scripts/engineering/check.py'
spec = importlib.util.spec_from_file_location('harness_check', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class HarnessTest(unittest.TestCase):
    def task(self, key, deps=(), status='backlog'):
        return dict(id=key,title='t',reason='r',module='core',priority='P0',dependencies=list(deps),
                    files=['x'],acceptance=['x'],tests=['x'],risks=['x'],rollback='x',status=status,
                    commit=None,architecture_approved=False)
    def test_cycle_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'Цикл'):
            m.validate([self.task('a',['b']),self.task('b',['a'])])
    def test_unsatisfied_ready_rejected(self):
        a=self.task('a',status='ready');a['architecture_approved']=True
        a['dependencies']=['b']
        with self.assertRaises(AssertionError):m.validate([a,self.task('b')])
    def test_done_without_evidence_rejected(self):
        with self.assertRaises(AssertionError):m.validate([self.task('a',status='done')])
    def test_ready_requires_architecture_approval(self):
        with self.assertRaises(AssertionError):m.validate([self.task('a',status='ready')])
