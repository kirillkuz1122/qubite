const crypto=require('crypto');
const runtime=require('../../service-runtime');
const {isOwner}=require('../access');
function allowed(msg,check){return msg?.chat?.type==='private'&&String(msg.chat.id)===String(msg.from?.id)&&check(msg.from.id);}
function register(bot,deps={}){
 const r=deps.runtime||runtime,check=deps.isOwner||isOwner,pending=new Map(),busy=new Set();
 async function menu(chat){const items=await r.list();return bot.sendMessage(chat,'Сервисы Raspberry · выбери действие.\nAuth и этот бот работают постоянно. Выключение сохраняет данные.',{reply_markup:{inline_keyboard:[...items.map(i=>[{text:`${i.running?'🟢':'⚫'} ${i.label}${i.state==='missing'?' · не установлен':''}`,callback_data:`power:choose:${i.id}:${i.running?'off':'on'}`}]),[{text:'Обновить',callback_data:'menu:runtime'},{text:'Главное меню',callback_data:'menu:main'}]]}});}
 bot.onText(/^\/power(?:@\w+)?$/i,async msg=>{if(!allowed(msg,check))return;try{await menu(msg.chat.id);}catch{await bot.sendMessage(msg.chat.id,'Менеджер сервисов недоступен.');}});
 bot.on('callback_query',async q=>{
  if(q.data!=='menu:runtime'&&!q.data?.startsWith('power:'))return;
  if(!allowed({...q.message,from:q.from},check))return bot.answerCallbackQuery(q.id,{text:'Только владелец в личном чате.'});
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  const chat=q.message.chat.id,key=String(chat);
  try{
   if(q.data==='menu:runtime'){pending.delete(key);return await menu(chat);}
   const parts=q.data.split(':');
   if(parts[1]==='choose'){
    const item=(await r.list()).find(i=>i.id===parts[2]);
    if(!item||item.state==='missing'||!['on','off'].includes(parts[3]))throw Error('Сервис недоступен.');
    const enabled=parts[3]==='on',token=crypto.randomBytes(8).toString('hex');
    const sent=await bot.sendMessage(chat,`${enabled?'Включить':'Выключить'} ${item.label}?\n${item.warning}`,{reply_markup:{inline_keyboard:[[{text:'Подтвердить',callback_data:'power:confirm:'+token},{text:'Отмена',callback_data:'menu:runtime'}]]}});
    pending.set(key,{id:item.id,enabled,token,message:sent.message_id,expires:Date.now()+120000});return;
   }
   const task=pending.get(key);
   if(parts[1]!=='confirm'||!task||task.token!==parts[2]||task.message!==q.message.message_id||task.expires<Date.now())throw Error('Подтверждение устарело. Открой меню заново.');
   if(busy.has(key))throw Error('Дождись текущей операции.');
   pending.delete(key);busy.add(key);
   try{await r.set(task.id,task.enabled);await bot.sendMessage(chat,`${r.CATALOG[task.id][0]} ${task.enabled?'включён':'выключен'}.`);await menu(chat);}finally{busy.delete(key);}
  }catch(e){await bot.sendMessage(chat,e.message||'Операция не выполнена.');}
 });
}
module.exports={register,allowed};
