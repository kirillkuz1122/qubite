const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DATABASE_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'runtime-')),'test.sqlite');
const {register}=require('../src/telegram/handlers/runtime');
function fixture(){
 const callbacks=[],sent=[],changes=[];let sequence=0;
 const bot={on:(e,f)=>callbacks.push(f),onText:()=>{},sendMessage:async(c,t,o)=>{sent.push({text:t,options:o,message_id:++sequence});return {message_id:sequence};},answerCallbackQuery:async()=>{}};
 const runtime={CATALOG:{memos:['Memos']},list:async()=>[{id:'memos',label:'Memos',running:true,state:'running',warning:'Данные сохраняются.'}],set:async(...args)=>changes.push(args)};
 register(bot,{runtime,isOwner:id=>id===7});
 return {sent,changes,call:(data,id=7,type='private',message=1)=>callbacks[0]({id:'q',data,from:{id},message:{chat:{id:7,type},message_id:message}})};
}
test('runtime controls reject outsiders/groups',async()=>{const f=fixture();await f.call('power:choose:memos:off',8);await f.call('power:choose:memos:off',7,'group');assert.equal(f.sent.length,0);assert.equal(f.changes.length,0);});
test('runtime transition needs exact one-time confirmation',async()=>{const f=fixture();await f.call('power:choose:memos:off');assert.equal(f.changes.length,0);const p=f.sent.at(-1),data=p.options.reply_markup.inline_keyboard[0][0].callback_data;await f.call(data,7,'private',999);assert.equal(f.changes.length,0);await f.call(data,7,'private',p.message_id);assert.deepEqual(f.changes,[['memos',false]]);await f.call(data,7,'private',p.message_id);assert.equal(f.changes.length,1);});
test('unknown/core service cannot be confirmed',async()=>{const f=fixture();await f.call('power:choose:qubite-auth:off');assert.equal(f.changes.length,0);assert.match(f.sent.at(-1).text,/недоступен/);});
