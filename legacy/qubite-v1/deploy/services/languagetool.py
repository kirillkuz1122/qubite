#!/usr/bin/env python3
"""Install pinned official LanguageTool, loopback only, bounded Java heap."""
import hashlib
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import urllib.request
import zipfile
VERSION='6.6'
SHA256='53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631'
def install(base,user,port=9091):
 base=Path(base).resolve();account=pwd.getpwnam(user)
 base.mkdir(parents=True,exist_ok=True)
 archive=base/('LanguageTool-'+VERSION+'.zip')
 if not archive.exists():
  part=archive.with_suffix('.zip.part')
  with urllib.request.urlopen('https://languagetool.org/download/LanguageTool-'+VERSION+'.zip',timeout=300) as src,part.open('wb') as dst:shutil.copyfileobj(src,dst)
  part.replace(archive)
 with archive.open('rb') as src:
  checksum=hashlib.file_digest(src,'sha256').hexdigest()
 if checksum!=SHA256:raise RuntimeError('LanguageTool download hash mismatch')
 with zipfile.ZipFile(archive) as z:
  for name in z.namelist():
   if not (base/name).resolve().is_relative_to(base):raise RuntimeError('Invalid archive path')
  z.extractall(base)
 props=base/'server.properties'
 props.write_text('maxTextLength=8000\nmaxTextHardLength=8000\nmaxCheckTimeMillis=20000\nmaxCheckThreads=1\nmaxWorkQueueSize=4\ncacheSize=0\npipelineCaching=true\nmaxPipelinePoolSize=2\npipelineExpireTimeInSeconds=600\npipelinePrewarming=false\nskipLoggingChecks=true\nskipLoggingRuleMatches=true\n')
 command=f'/usr/bin/java -Xms64m -Xmx384m -XX:ActiveProcessorCount=1 -cp {base}/LanguageTool-{VERSION}/languagetool-server.jar org.languagetool.server.HTTPServer --config {props} --port {int(port)}'
 Path('/etc/systemd/system/qubite-languagetool.service').write_text(f'[Unit]\nDescription=Qubite local LanguageTool\nAfter=network.target\nStartLimitIntervalSec=300\nStartLimitBurst=3\n[Service]\nUser={user}\nWorkingDirectory={base}\nExecStart={command}\nRestart=on-failure\nRestartSec=10\nMemoryHigh=550M\nMemoryMax=700M\nCPUQuota=100%\nNice=10\nTasksMax=128\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n')
 for p in [base,*base.rglob('*')]:os.chown(p,account.pw_uid,account.pw_gid)
 subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','enable','--now','qubite-languagetool'],check=True)
