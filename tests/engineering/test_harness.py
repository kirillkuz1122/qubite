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


class CoreGroupingTest(unittest.TestCase):
    @staticmethod
    def runner():
        source = Path(__file__).resolve().parents[2] / 'scripts/engineering/verify.py'
        spec = importlib.util.spec_from_file_location('harness_verify', source)
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        return runner

    def test_partition_includes_current_and_future_nested_files_exactly_once(self):
        files = ['tests/test_auth.py', 'tests/test_foundation.py', 'tests/test_identity.py',
                 'tests/test_oauth.py', 'tests/test_challenges.py', 'tests/test_policy.py', 'tests/test_catalog.py',
                 'tests/future/adapter_test.py']
        groups = self.runner().core_groups(files)
        self.assertEqual(len(groups), 4)
        self.assertCountEqual([item for group in groups for item in group], files)
        self.assertEqual(len(set(groups[0]) & set(groups[1])), 0)
        self.assertIn('tests/future/adapter_test.py', groups[2])
        self.assertEqual(groups[3], ['tests/test_catalog.py'])

    def test_empty_group_is_retained_without_losing_future_tests(self):
        self.assertEqual(self.runner().core_groups(['tests/test_new.py']), [[], [], ['tests/test_new.py'], []])
