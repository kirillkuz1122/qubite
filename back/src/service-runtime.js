const http = require('http');
const native = require('./db');
const CATALOG = {
 qubite: ['Qubite · сайт и турниры', 'Отключится сайт/турниры. Отдельные Qubite Auth, редактор и управляющий бот продолжат работать.'],
 hermes: ['Hermes', 'Бот Hermes не сможет отвечать.'],
 vault: ['AliasVault', 'Хранилище паролей будет недоступно. Данные сохраняются.'],
 languagetool: ['LanguageTool', 'Обычная проверка орфографии будет недоступна.'],
 omniroute: ['OmniRoute', 'Панель и API OmniRoute будут недоступны.'],
 searxng: ['SearXNG', 'Поиск Qubite и поиск Hermes потеряют источники.'],
 hermes_dashboard: ['Дашборд Hermes', 'Отключится только веб-панель Hermes.'],
 search: ['Оболочка поиска', 'Поисковый сайт и его API будут недоступны.'],
 brief: ['Qubite Brief', 'Интервью остановятся до включения бота.'],
 memos: ['Memos', 'Заметки и доступ Hermes к ним будут недоступны.'],
 siyuan: ['SiYuan · личная база знаний', 'Заметки и ограниченные инструменты Hermes будут недоступны. Данные сохраняются.'],
 vikunja: ['Vikunja', 'Задачи и доступ Hermes к ним будут недоступны.'],
 kwork_poll: ['Kwork · кнопки', 'Кнопки бота Kwork будут недоступны. Обработка заказов управляется отдельно.'],
 kwork_work: ['Kwork · обработка', 'Генерация откликов будет остановлена.'],
 voice_listener: ['Транскрипция · слушатель', 'Автоматическая транскрипция личных сообщений остановится.'],
 voice_bot: ['Транскрипция · бот', 'Ручная транскрипция и уведомления в этом боте будут недоступны.'],
};
function request(body) {
 return new Promise((resolve,reject)=>{
  const socketPath=process.env.RUNTIME_MANAGEMENT_SOCKET;
  if(!socketPath)return reject(new Error('Управление процессами пока не подключено.'));
  const data=JSON.stringify(body);
  const q=http.request({socketPath,path:'/manage',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},s=>{
   let text='';s.on('data',c=>{text+=c;if(text.length>65536)q.destroy(new Error('Слишком большой ответ.'));});
   s.on('end',()=>{try{const r=JSON.parse(text);s.statusCode===200?resolve(r):reject(new Error(r.error||'Операция не выполнена.'));}catch{reject(new Error('Неверный ответ менеджера.'));}});
  });q.setTimeout(60000,()=>q.destroy(new Error('Операция ещё не подтверждена. Обнови статус.')));q.on('error',()=>reject(new Error('Менеджер сервисов недоступен.')));q.end(data);
 });
}
async function workspaceEnabled(){return process.env.QUBITE_PROCESS_ROLE==='auth'?false:await native.getSystemSettingValue('workspace_enabled',true)!==false;}
async function list(){
 const {items}=await request({action:'status'});
 return items.map(i=>({...i,label:CATALOG[i.id]?.[0]||i.id,warning:CATALOG[i.id]?.[1]||''}));
}
async function set(id,enabled){
 if(!Object.hasOwn(CATALOG,id)||typeof enabled!=='boolean')throw new Error('Неизвестный сервис или состояние.');
 const result=await request({action:'set',id,enabled});
 if(id==='qubite')await native.updateSystemSetting('workspace_enabled',enabled);
 return result;
}
function corePath(p){return ['/privacy.html','/terms.html','/acceptable-use.html','/security.html'].includes(p)||p==='/auth'||p.startsWith('/auth/')||p.startsWith('/api/auth/')||p==='/api/public/config'||p==='/api/status'||p.startsWith('/api/proxy/')||p.startsWith('/front/');}
function registerGate(app){app.use(async(q,s,n)=>{try{
 if(corePath(q.path)||await workspaceEnabled())return n();
 if(q.path==='/'||q.path==='/index.html')return s.redirect('/auth');
 return s.status(503).json({error:'Основной сайт Qubite выключен владельцем. Вход и другие сервисы продолжают работать.'});
 }catch(e){n(e);}});}
module.exports={CATALOG,list,set,workspaceEnabled,corePath,registerGate};
