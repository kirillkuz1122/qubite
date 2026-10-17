#!/usr/bin/env python3
"""Selected text → editor → clipboard. Secrets stay in a private local file."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import urllib.request
from urllib.parse import urlparse

CONFIG=Path.home()/'.config/qubite-writing/config.json'
def clipboard(primary=False):
 if os.environ.get('WAYLAND_DISPLAY') and shutil.which('wl-paste'):
  args=['wl-paste','--no-newline']+(['--primary'] if primary else [])
 elif shutil.which('xclip'):
  args=['xclip','-selection','primary' if primary else 'clipboard','-o']
 else:return ''
 try:return subprocess.run(args,capture_output=True,text=True,timeout=2,check=True).stdout[:8000]
 except (subprocess.SubprocessError,OSError):return ''
def copy(text):
 if os.environ.get('WAYLAND_DISPLAY') and shutil.which('wl-copy'):args=['wl-copy']
 elif shutil.which('xclip'):args=['xclip','-selection','clipboard']
 else:raise RuntimeError('Установи wl-clipboard (Wayland) или xclip (X11).')
 subprocess.run(args,input=text,text=True,timeout=3,check=True)
def request(config,action,body=None):
 url=urlparse(config['base'])
 if url.scheme!='https' or url.username or url.password:raise RuntimeError('Нужен HTTPS-адрес Qubite.')
 req=urllib.request.Request(config['base'].rstrip('/')+'/api/writing/v1/'+action,data=json.dumps(body).encode() if body else None,headers={'Authorization':'Bearer '+config['token'],'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=40) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  try:message=json.load(e).get('error','Запрос отклонён.')
  except Exception:message='Qubite недоступен.'
  raise RuntimeError(message) from None
def qt_main(initial):
 from PySide6 import QtCore,QtWidgets
 app=QtWidgets.QApplication(sys.argv);window=QtWidgets.QWidget();window.setWindowTitle('Qubite Writing');window.resize(850,660)
 layout=QtWidgets.QVBoxLayout(window)
 window.setStyleSheet('QWidget{background:#0b1220;color:#e2e8f0;font-size:14px}QPushButton,QLineEdit,QComboBox{background:#273449;padding:9px;border:1px solid #536178;border-radius:12px}QPushButton:hover{border-color:#f59e0b}QPushButton:focus{border-color:#f43f5e}QPlainTextEdit{padding:12px;background:#020617}')
 if '--configure' in sys.argv or not CONFIG.exists():
  layout.addWidget(QtWidgets.QLabel('Подключение к Qubite · ключ из /writing'))
  base=QtWidgets.QLineEdit('https://qubiteapp.online');token=QtWidgets.QLineEdit();token.setEchoMode(QtWidgets.QLineEdit.Password);token.setPlaceholderText('qbw_…');layout.addWidget(base);layout.addWidget(token)
  button=QtWidgets.QPushButton('Проверить и сохранить');layout.addWidget(button)
  def save():
   import re
   try:
    if not re.fullmatch(r'qbw_[a-f0-9]{64}',token.text().strip()):raise RuntimeError('Нужен ключ qbw_…')
    config={'base':base.text().rstrip('/'),'token':token.text().strip()};request(config,'me')
    CONFIG.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(CONFIG,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as out:json.dump(config,out)
    CONFIG.chmod(0o600);QtWidgets.QMessageBox.information(window,'Qubite','Готово. Выдели текст и запусти помощник.');window.close()
   except Exception as e:QtWidgets.QMessageBox.warning(window,'Qubite',str(e))
  button.clicked.connect(save);window.show();app.exec();return
 config=json.loads(CONFIG.read_text());draft=QtWidgets.QPlainTextEdit(initial);layout.addWidget(draft)
 row=QtWidgets.QHBoxLayout();layout.addLayout(row);buttons=[];last=[None];worker=[None]
 style=QtWidgets.QComboBox();style.setEditable(True);style.addItems(['простой и понятный','дружелюбный разговорный','деловой','академический','краткий и прямой']);layout.addWidget(style)
 status=QtWidgets.QLabel('Текст не сохраняется. После исправления скопируй результат и нажми Ctrl+V в исходном поле.');status.setWordWrap(True);layout.addWidget(status)
 class Worker(QtCore.QThread):
  done=QtCore.Signal(object,object)
  def __init__(self,mode,text,chosen):super().__init__();self.mode=mode;self.text=text;self.chosen=chosen
  def run(self):
   try:self.done.emit(request(config,'check' if self.mode=='local' else 'rewrite',{'text':self.text,'language':'auto'} if self.mode=='local' else {'text':self.text,'mode':self.mode,'style':self.chosen}),None)
   except Exception as e:self.done.emit(None,str(e))
 def action(mode):
  text=draft.toPlainText()
  if not text.strip() or len(text)>8000:status.setText('Текст: от 1 до 8000 символов.');return
  for b in buttons:b.setEnabled(False)
  status.setText('Проверяем…');task=Worker(mode,text,style.currentText());worker[0]=task
  def done(data,error):
   for b in buttons:b.setEnabled(True)
   if error:status.setText(error);return
   if mode=='local':
    dialog=QtWidgets.QDialog(window);dialog.setWindowTitle('LanguageTool');box=QtWidgets.QVBoxLayout(dialog)
    if not data['matches']:box.addWidget(QtWidgets.QLabel('Локальные правила не нашли ошибок.'))
    for m in data['matches']:
     label=QtWidgets.QLabel(m['message']);label.setWordWrap(True);box.addWidget(label)
     for v in m['replacements'][:3]:
      b=QtWidgets.QPushButton(v['value']);box.addWidget(b)
      def apply(m=m,v=v):
       if draft.toPlainText()!=text:status.setText('Текст изменился. Проверь ещё раз.');dialog.close();return
       # LanguageTool offsets are UTF-16, convert to Python's Unicode indices.
       raw=text.encode('utf-16-le');value=(raw[:m['offset']*2]+v['value'].encode('utf-16-le')+raw[(m['offset']+m['length'])*2:]).decode('utf-16-le')
       last[0]=(text,value);draft.setPlainText(value);dialog.close()
      b.clicked.connect(apply)
    dialog.exec();status.setText('Для сложных ошибок нажми ИИ-проверку.');return
   if draft.toPlainText()!=text:QtWidgets.QMessageBox.information(window,'Результат отдельно: текст изменился',data['text']);return
   last[0]=(text,data['text']);draft.setPlainText(data['text']);status.setText('Текст заменён. '+' '.join(data['notes']+data['questions']))
  task.done.connect(done);task.start()
 for label,mode in [('Локально','local'),('ИИ-проверка','check'),('Мой стиль','improve'),('Сменить стиль','style'),('Промпт','prompt')]:
  b=QtWidgets.QPushButton(label);b.clicked.connect(lambda checked=False,m=mode:action(m));row.addWidget(b);buttons.append(b)
 undo=QtWidgets.QPushButton('Отменить замену');layout.addWidget(undo)
 def cancel():
  if last[0] and draft.toPlainText()==last[0][1]:draft.setPlainText(last[0][0]);last[0]=None;status.setText('Замена отменена.')
 undo.clicked.connect(cancel);accept=QtWidgets.QPushButton('Принять и скопировать');layout.addWidget(accept)
 def accepted():app.clipboard().setText(draft.toPlainText());status.setText('Скопировано. Вернись в исходное поле и нажми Ctrl+V.')
 accept.clicked.connect(accepted)
 def close_event(event):
  if worker[0] and worker[0].isRunning():status.setText('Дождись завершения запроса перед закрытием окна.');event.ignore()
  else:event.accept()
 window.closeEvent=close_event;window.show();app.exec()
def main():
 initial=clipboard(True) or clipboard(False)
 try:import tkinter as tk;from tkinter import ttk,messagebox
 except ImportError:
  try:return qt_main(initial)
  except ImportError:raise SystemExit('Установи python3-tk / tk или python-pyside6. Поддерживаются оба интерфейса.')
 app=tk.Tk();app.title('Qubite Writing');app.geometry('850x660')
 if '--configure' in sys.argv or not CONFIG.exists():
  app.geometry('620x330');ttk.Label(app,text='Подключение к твоему Qubite').pack(pady=12)
  base=tk.StringVar(value='https://qubiteapp.online');token=tk.StringVar()
  ttk.Label(app,text='Адрес HTTPS').pack();ttk.Entry(app,textvariable=base,width=65).pack(pady=8)
  ttk.Label(app,text='Ключ qbw_… из редактора Qubite').pack();ttk.Entry(app,textvariable=token,show='•',width=65).pack(pady=8)
  def save():
   import re
   try:
    if not re.fullmatch(r'qbw_[a-f0-9]{64}',token.get().strip()):raise RuntimeError('Нужен ключ qbw_…')
    value={'base':base.get().rstrip('/'),'token':token.get().strip()};request(value,'me')
    CONFIG.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(CONFIG,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(value,f)
    CONFIG.chmod(0o600);messagebox.showinfo('Qubite','Готово. Теперь выдели текст и запусти помощник.');app.destroy()
   except Exception as e:messagebox.showerror('Qubite',str(e))
  ttk.Button(app,text='Проверить и сохранить',command=save).pack(pady=12);app.mainloop();return
 config=json.loads(CONFIG.read_text());draft=tk.Text(app,wrap='word',font=('Sans',13),undo=True);draft.pack(fill='both',expand=True,padx=15,pady=15);draft.insert('1.0',initial)
 row=ttk.Frame(app);row.pack(fill='x',padx=15);status=tk.StringVar(value='Текст не сохраняется. После исправления: «Принять и скопировать», затем Ctrl+V в исходном поле.')
 ttk.Label(app,textvariable=status,wraplength=800).pack(padx=15,pady=15)
 last=[None];buttons=[];style=tk.StringVar(value='простой и понятный')
 ttk.Combobox(app,textvariable=style,values=['простой и понятный','дружелюбный разговорный','деловой','академический','краткий и прямой']).pack()
 def action(mode):
  text=draft.get('1.0','end-1c');chosen_style=style.get()
  if not text.strip() or len(text)>8000:status.set('Текст: от 1 до 8000 символов.');return
  for b in buttons:b.configure(state='disabled')
  status.set('Проверяем…')
  def worker():
   try:
    data=request(config,'check' if mode=='local' else 'rewrite',{'text':text,'language':'auto'} if mode=='local' else {'text':text,'mode':mode,'style':chosen_style});error=None
   except Exception as e:data=None;error=str(e)
   def done():
    for b in buttons:b.configure(state='normal')
    if error:status.set(error);return
    if mode=='local':
     message='\n'.join(m['message']+' → '+', '.join(v['value'] for v in m['replacements'][:3]) for m in data['matches']) or 'Локальные правила не нашли ошибок.'
     messagebox.showinfo('Замечания LanguageTool',message);status.set('Для сложных ошибок нажми ИИ-проверку.');return
    if draft.get('1.0','end-1c')!=text:messagebox.showinfo('Текст изменился. Результат отдельно',data['text']);return
    last[0]=(text,data['text']);draft.delete('1.0','end');draft.insert('1.0',data['text']);status.set('Текст заменён. '+ ' '.join(data['notes']+data['questions']))
   app.after(0,done)
  threading.Thread(target=worker,daemon=True).start()
 for label,mode in [('Локально','local'),('ИИ-проверка','check'),('Мой стиль','improve'),('Сменить стиль','style'),('Промпт','prompt')]:
  b=ttk.Button(row,text=label,command=lambda m=mode:action(m));b.pack(side='left',padx=3);buttons.append(b)
 def undo():
  if last[0] and draft.get('1.0','end-1c')==last[0][1]:draft.delete('1.0','end');draft.insert('1.0',last[0][0]);last[0]=None;status.set('Замена отменена.')
 def accept():
  try:copy(draft.get('1.0','end-1c'));status.set('Скопировано. Вернись в исходное поле и нажми Ctrl+V.')
  except Exception as e:status.set(str(e))
 ttk.Button(app,text='Отменить замену',command=undo).pack(side='left',padx=15,pady=15)
 ttk.Button(app,text='Принять и скопировать',command=accept).pack(side='right',padx=15,pady=15)
 app.mainloop()
if __name__=='__main__':main()
