const native=require('../../db');
const serviceDomain=require('../../services');
const {isOwner}=require('../access');
const {APP_BASE_URL}=require('../../config');
const {paginatedList}=require('../menus');
const KEYS=['daily_requests','hourly_requests','daily_usd','monthly_usd','lifetime_usd'];
const LABELS={daily_requests:'Запросов в день',hourly_requests:'Запросов в час',daily_usd:'Долларов в день',monthly_usd:'Долларов в месяц',lifetime_usd:'Долларов всего'};
function privateOwner(message,ownerCheck=isOwner){return Boolean(message?.from&&message?.chat?.type==='private'&&String(message.chat.id)===String(message.from.id)&&ownerCheck(message.from.id));}
function register(bot,deps={}){
 const s=deps.services||serviceDomain,d=deps.native||native,ownerCheck=deps.isOwner||isOwner,pending=new Map();
 const actor=async()=>{const a=await d.getOwnerUser();if(!a)throw new Error('Сначала назначь владельца Qubite через CLI.');return a;};
 const back={inline_keyboard:[[{text:'Сервисы',callback_data:'menu:services'},{text:'Главное меню',callback_data:'menu:main'}]]};
 async function list(chat,page=0){
  const users=await s.listUsers();const keyboard=paginatedList(users.map(u=>({id:u.id,label:'@'+u.login+' · '+u.role})), 'svc:user',Math.max(0,page),8,'menu:main');
  keyboard.inline_keyboard.unshift([{text:'Аналитика ИИ',callback_data:'svc:analytics'}]);
  keyboard.inline_keyboard.unshift([{text:'Общий бюджет и расходы',callback_data:'svc:budget'}]);
  keyboard.inline_keyboard.unshift([{text:'Пригласить аккаунт',callback_data:'svc:add'}]);
  return bot.sendMessage(chat,'Поиск и хранилище: выбери пользователя.',{reply_markup:keyboard});
 }
 async function card(chat,id){
  const u=await d.getUserById(id);if(!u)throw new Error('Аккаунт не найден.');const p=await s.permissions(u),a=p.services.search,v=p.services.vault;
  const rows=[];
  if(!p.owner){
   rows.push([{text:a.enabled?'Отозвать поиск':'Выдать поиск',callback_data:`svc:search:${id}`}]);
   rows.push([{text:a.paid?'Платные: да':'Платные: нет',callback_data:`svc:paid:${id}`},{text:a.history?'История: разрешена':'История: запрещена',callback_data:`svc:history:${id}`}]);
   for(const key of KEYS)rows.push([{text:LABELS[key]+': '+(a[key]??'без лимита'),callback_data:`svc:field:${id}:${key}`}]);
   rows.push([{text:v.enabled?'Отозвать хранилище':'Выдать хранилище',callback_data:`svc:vault:${id}`}]);
   rows.push([{text:'Удалить хранилище',callback_data:`svc:delete:${id}`},{text:'Первичная активация',callback_data:`svc:invite:${id}`}]);
  }
  rows.push([{text:'Расходы этого пользователя',callback_data:'svc:analytics:'+id}]);
  rows.push([{text:'Список пользователей',callback_data:'menu:services'}]);
  return bot.sendMessage(chat,`@${u.login} · ${u.status}\nПоиск: ${a.enabled?'выдан':'не выдан'}\nХранилище: ${v.enabled?'выдано':'не выдано'}\n${p.owner?'Владелец: защищён, изменения через CLI.':'Пароли выбирает сам пользователь; история сохраняется по желанию пользователя; мастер-пароль хранилища нам недоступен.'}`,{reply_markup:{inline_keyboard:rows}});
 }
 async function prompt(chat,task,text){const sent=await bot.sendMessage(chat,text,{reply_markup:{force_reply:true,selective:true}});pending.set(String(chat),{...task,message:sent.message_id,expires:Date.now()+300000});}
 async function budget(chat){let spent='недоступна';try{const usage=await s.searchUsage();spent=`$${Number(usage.spent).toFixed(6)}; зарезервировано $${Number(usage.reserved).toFixed(6)}`;}catch{}const limit=await s.globalBudget();return bot.sendMessage(chat,`Общий дневной бюджет поиска: $${limit}\nРасход сегодня: ${spent}\nИндивидуальные бюджеты задаются в карточках пользователей.`,{reply_markup:{inline_keyboard:[[{text:'Изменить общий бюджет',callback_data:'svc:budget_edit'}],[{text:'Назад',callback_data:'menu:services'}]]}});}
 async function analytics(chat,id){
  const data=await s.searchAnalytics(30,id?'qb:'+id:'');
  const money=n=>'$'+Number(n||0).toFixed(6);let name='Все пользователи';if(id){const u=await d.getUserById(id);name=u?'@'+u.login:'qb:'+id;}
  const text=`ИИ-поиск · ${name}\nСегодня (UTC): ${data.today.calls||0} вызовов, ${money(data.today.cost_usd)}\nЗа 30 дней: ${data.totals.calls||0} вызовов, ${money(data.totals.cost_usd)}\nРезерв: ${money(data.totals.reserved_usd)}\n\n`+data.models.slice(0,15).map(m=>`${m.model==='legacy/unknown'?'Ранние записи, модель неизвестна':m.model}: ${m.calls} · ${money(m.cost_usd)}`).join('\n')+`\n\nГрафики и детализация: ${APP_BASE_URL}/?view=analytics`;
  return bot.sendMessage(chat,text,{reply_markup:back});
 }
 async function input(msg){
  const task=pending.get(String(msg.chat.id));if(!task)return;
  if(task.expires<Date.now()){pending.delete(String(msg.chat.id));return;}
  if(!msg.reply_to_message||msg.reply_to_message.message_id!==task.message)return;
  msg._qubiteServiceInput=true;
  pending.delete(String(msg.chat.id));
  try{
   const a=await actor(),text=msg.text.trim();
   if(task.kind==='add'){const parts=text.split(/\s+/);if(parts.length!==2)throw new Error('Нужно: логин почта');const result=await s.createAccount(a,{login:parts[0],email:parts[1]});await bot.sendMessage(msg.chat.id,'Одноразовое приглашение на 7 дней:\n'+result.url,{disable_web_page_preview:true,reply_markup:back});return;}
   if(task.kind==='budget'){await s.setGlobalBudget(a,Number(text.replace(',','.')));await budget(msg.chat.id);return;}
   const u=await d.getUserById(task.id);if(!u||s.realOwner(u))throw new Error('Защищённый или отсутствующий аккаунт.');
   if(task.kind==='delete'){await s.deleteVault(a,u,text);await bot.sendMessage(msg.chat.id,'Хранилище удалено; аккаунт Qubite сохранён.',{reply_markup:back});return;}
   if(task.kind==='field'){const p=await s.permissions(u),value=text==='-'?null:Number(text.replace(',','.'));await s.setAccess(a,u,'search',{...p.services.search,[task.key]:value});await card(msg.chat.id,u.id);}
  }catch(e){await bot.sendMessage(msg.chat.id,'Ошибка: '+e.message,{reply_markup:back});}
 }
 bot.onText(/^\/services(?:@\w+)?$/i,async msg=>{if(!privateOwner(msg,ownerCheck))return;try{await list(msg.chat.id);}catch(e){await bot.sendMessage(msg.chat.id,e.message);}});
 bot.onText(/^\/service_user(?:@\w+)?\s+(\S+)$/i,async(msg,m)=>{if(!privateOwner(msg,ownerCheck))return;try{const u=await d.findUserByLoginOrEmail(m[1]);if(!u)throw new Error('Аккаунт не найден.');await card(msg.chat.id,u.id);}catch(e){await bot.sendMessage(msg.chat.id,e.message);}});
 bot.on('callback_query',async q=>{
  if(q.data!=='menu:services'&&!q.data?.startsWith('svc:'))return;
  const msg={...q.message,from:q.from};
  if(!privateOwner(msg,ownerCheck))return bot.answerCallbackQuery(q.id,{text:'Только владелец в личном чате.'});
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  try{
   const chat=q.message.chat.id,parts=q.data.split(':');
   if(q.data==='menu:services')return await list(chat);
   if(q.data.startsWith('svc:user:page:'))return await list(chat,Number(parts[3])||0);
   if(parts[1]==='analytics')return await analytics(chat,Number(parts[2])||null);
   if(parts[1]==='user')return await card(chat,Number(parts[2]));
   if(parts[1]==='add')return await prompt(chat,{kind:'add'},'Ответь на это сообщение: логин почта. Пароль не присылай — пользователь выберет его сам.');
   if(parts[1]==='budget')return await budget(chat);
   if(parts[1]==='budget_edit')return await prompt(chat,{kind:'budget'},'Общий бюджет поиска в долларах в день (0–100). Ответь на это сообщение.');
   const id=Number(parts[2]),u=await d.getUserById(id);if(!u||s.realOwner(u))throw new Error('Защищённый или отсутствующий аккаунт.');
   if(parts[1]==='field'){if(!KEYS.includes(parts[3]))throw new Error('Неизвестный лимит.');return await prompt(chat,{kind:'field',id,key:parts[3]},LABELS[parts[3]]+'. Ответь числом; «-» снимает ограничение. Нулевой денежный лимит разрешает только бесплатные модели; нулевой лимит запросов отключает ИИ.');}
   if(parts[1]==='delete')return await prompt(chat,{kind:'delete',id},'Безвозвратно удалить зашифрованное хранилище? Для подтверждения ответь точным логином: '+u.login);
   const a=await actor();
   if(parts[1]==='invite'){const result=await s.inviteExisting(a,u);return await bot.sendMessage(chat,result.url,{disable_web_page_preview:true,reply_markup:back});}
   const p=await s.permissions(u);
   if(parts[1]==='vault')await s.setAccess(a,u,'vault',{enabled:!p.services.vault.enabled});
   else if(['search','paid','history'].includes(parts[1])){const key=parts[1]==='search'?'enabled':parts[1];await s.setAccess(a,u,'search',{...p.services.search,[key]:!p.services.search[key]});}
   else throw new Error('Неизвестное действие.');
   await card(chat,id);
  }catch(e){await bot.sendMessage(q.message.chat.id,'Ошибка: '+e.message,{reply_markup:back});}
 });
 // Registered before other message handlers; exact replies cannot be consumed by proxy/support prompts.
 bot.on('message',msg=>{if(privateOwner(msg,ownerCheck)&&typeof msg.text==='string'&&!msg.text.startsWith('/'))void input(msg).catch(()=>{});});
}
module.exports={register,privateOwner};
