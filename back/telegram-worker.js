// Independent control bot: stopping qubite-platform must not stop this process.
const db=require('./src/db');
const {startTelegramBot,stopTelegramBot}=require('./src/telegram-bot');
const events=require('./src/process-events');
const emitter=new(require('events').EventEmitter)();
let eventServer;
for(const type of ['message','chat:new'])emitter.on(type,payload=>events.relay('platform',type,payload));
db.initializeDatabase().then(async()=>{
 startTelegramBot({supportChatEmitter:emitter});
 eventServer=await events.listen('bot',async(type,payload)=>{
  const notifier=require('./src/telegram/notifier');
  if(type==='audit')notifier.notifyAudit(payload);
  else if(type==='support:new')await notifier.notifySupportNewChat(payload);
  else if(type==='tg:reply')emitter.emit(type,payload);
  else throw new Error('Unsupported bot event');
 });
}).catch(()=>{console.error('Не удалось запустить управляющий бот.');process.exit(1);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{eventServer?.close();stopTelegramBot();setTimeout(()=>process.exit(0),200).unref();});
