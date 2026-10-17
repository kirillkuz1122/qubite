"""Configuration has no print/repr path for secrets."""
import os
from pathlib import Path

def load_env(path):
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

class Config:
    def __init__(self):
        self.token = os.environ.get('BOT_TOKEN', '')
        self.key = os.environ.get('OPENROUTER_API_KEY', '')
        self.owner = int(os.environ.get('OWNER_ID', '0'))
        if self.owner<=0:raise ValueError('OWNER_ID must be explicitly configured')
        self.data = Path(os.environ.get('DATA_DIR', './data')).resolve()
        self.daily = float(os.environ.get('DAILY_BUDGET_USD', '.05'))
        self.session = float(os.environ.get('SESSION_BUDGET_USD', '.05'))
        self.primary_timeout = float(os.environ.get('PRIMARY_TIMEOUT', os.environ.get('FLEX_TIMEOUT', '18')))
        self.standard_timeout = float(os.environ.get('STANDARD_TIMEOUT', '55'))
        self.stt_python = os.environ.get('STT_PYTHON', '')
        self.stt_script = os.environ.get('STT_SCRIPT', '')
        self.send_client = os.environ.get('SEND_PDF_TO_CLIENT', 'false').lower() == 'true'
        if self.daily <= 0 or self.session <= 0:
            raise ValueError('Invalid budget configuration')
