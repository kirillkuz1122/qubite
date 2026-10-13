"""Guard against lost files, mixed auth and installer side effects after relocation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]

class RelocationTest(unittest.TestCase):
    def test_every_archived_file_preserved_or_explicit_change_recorded(self):
        manifest=json.loads((ROOT/'docs/migration/RELOCATION_MANIFEST.json').read_text())
        self.assertEqual(len(manifest['files']),368)
        old=set(); new=set()
        for row in manifest['files']:
            self.assertNotIn(row['old_path'],old);old.add(row['old_path'])
            self.assertNotIn(row['new_path'],new);new.add(row['new_path'])
            target=ROOT/row['new_path'];self.assertTrue(target.is_file(),row['new_path'])
            self.assertFalse(target.is_symlink(),row['new_path'])
            actual=hashlib.sha256(target.read_bytes()).hexdigest()
            if not row.get('change_reason'):
                self.assertEqual(actual,row['original_sha256'],row['new_path'])
            else:
                self.assertTrue(row['change_reason'].strip())

    def test_root_no_longer_serves_legacy_site_and_manifest_is_independent(self):
        self.assertFalse(list(ROOT.glob('*.html')))
        for directory in ['back','front','app']:
            self.assertFalse((ROOT/directory).exists(),directory)
        component=json.loads((ROOT/'modules/tournaments/manifest.json').read_text())
        self.assertEqual(component['kind'],'standalone-legacy')
        self.assertFalse(component['default_enabled'])
        self.assertFalse(component['core_identity_integration'])
        self.assertFalse(component['core_data_access'])
        self.assertTrue((ROOT/component['source_path']/'back/server.js').is_file())

    def test_legacy_installer_plan_works_without_reading_or_executing_private_env(self):
        with tempfile.TemporaryDirectory() as folder:
            config=Path(folder)/'private.env';side_effect=Path(folder)/'executed'
            config.write_text(f'FAKE_PASSWORD=not-for-output\n$(touch {side_effect})\n')
            result=subprocess.run(['bash',str(ROOT/'legacy/qubite-v1/deploy/install.sh'),
                '--plan','--env-file',str(config)],cwd=folder,env={'PATH':os.environ['PATH']},
                capture_output=True,text=True,check=True,timeout=10)
            self.assertNotIn('not-for-output',result.stdout+result.stderr)
            self.assertFalse(side_effect.exists())
            plan=json.loads(result.stdout)
            self.assertFalse(plan['mutations']);self.assertFalse(plan['shared_core_identity'])
            self.assertTrue(plan['env_file_exists'])
            self.assertEqual(Path(plan['backend']),ROOT/'legacy/qubite-v1/back/server.js')
            self.assertTrue(Path(plan['writing_reference']).is_dir())

    def test_legacy_config_check_uses_explicit_fixture_env_before_any_install(self):
        with tempfile.TemporaryDirectory() as folder:
            config=Path(folder)/'private.env'
            config.write_text('INSTALL_PLATFORM=false\nINSTALL_SEARCH=false\nINSTALL_VAULT=false\nINSTALL_WRITING=false\nINGRESS_MODE=direct\n')
            env={'PATH':os.environ['PATH'],'QUBITE_LEGACY_ENV_FILE':str(config)}
            result=subprocess.run(['python3',str(ROOT/'legacy/qubite-v1/deploy/services/configure.py'),
                str(ROOT/'legacy/qubite-v1'),'--check'],env=env,capture_output=True,text=True,check=True,timeout=10)
            self.assertFalse(json.loads(result.stdout)['platform'])

    def test_new_env_template_contains_only_current_core_keys_and_no_credentials(self):
        content=(ROOT/'.env.example').read_text()
        pairs=dict(line.split('=',1) for line in content.splitlines() if line and not line.startswith('#'))
        self.assertTrue(all(k.startswith('QUBITE_CORE_') for k in pairs))
        self.assertEqual(pairs['QUBITE_CORE_DATABASE_URL'],'')
        self.assertEqual(pairs['QUBITE_CORE_OAUTH_NETWORK_ENABLED'],'false')
        self.assertEqual(pairs['QUBITE_CORE_EMAIL_CHALLENGES_ENABLED'],'false')
        self.assertEqual(pairs['QUBITE_CORE_AUTH_LOCAL_HTTP'],'false')
        for key,value in pairs.items():
            if key.endswith(('_SECRET','_ID')):self.assertEqual(value,'',key)
        result=subprocess.run(['git','check-ignore','--stdin'],cwd=ROOT,
            input='.env\ndeploy/.env\nlegacy/qubite-v1/.env\n',text=True,capture_output=True,check=True)
        self.assertEqual(len(result.stdout.splitlines()),3)

if __name__=='__main__':unittest.main()
