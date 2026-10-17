#!/usr/bin/env python3
"""Reproducible unsigned Firefox package, without credentials or external assets."""
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parent
(root/'dist').mkdir(exist_ok=True)
with zipfile.ZipFile(root/'dist/qubite-writing.xpi','w',zipfile.ZIP_DEFLATED) as out:
 for p in sorted((root/'firefox').iterdir()):
  if p.is_file():
   info=zipfile.ZipInfo(p.name,date_time=(2026,10,5,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
   out.writestr(info,p.read_bytes())
print('dist/qubite-writing.xpi (unsigned)')
