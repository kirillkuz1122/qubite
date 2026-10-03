const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qubite-tg-test-'));process.env.DATABASE_PATH=path.join(directory,'test.sqlite');
const {register}=require('../src/telegram/handlers/services');
function fixture(){
 const handlers={},commands=[],sent=[],answers=[],changes=[];let serial=0;
 const bot={on:(event,fn)=>(handlers[event]??=[]).push(fn),onText:(regex,fn)=>commands.push([regex,fn]),sendMessage:async(chat,text,options)=>{sent.push({chat,text,options,message_id:++serial});return {message_id:serial};},answerCallbackQuery:async(id,data)=>answers.push(data)};
 const user={id:2,login:'friend',role:'user',status:'active'},owner={id:1,role:'owner'};
 let access={enabled:true,paid:false,history:false,daily_requests:10,hourly_requests:3,daily_usd:0,monthly_usd:0,lifetime_usd:0};
 const services={realOwner:u=>u.role==='owner',permissions:async()=>({owner:false,services:{search:{...access},vault:{enabled:true}}}),setAccess:async(a,u,kind,body)=>{changes.push({a,u,kind,body});if(kind==='search')access={...body};},globalBudget:async()=>.05,searchUsage:async()=>({spent:0,reserved:0}),deleteVault:async(a,u,confirmation)=>{if(confirmation!==u.login)throw Error('Confirmation');changes.push({delete:u.id});}};
 register(bot,{isOwner:id=>String(id)==='7',native:{getOwnerUser:async()=>owner,getUserById:async()=>user},services});
 const callback=(data,id=7,type='private')=>handlers.callback_query[0]({id:'callback',data,from:{id},message:{chat:{id:7,type},message_id:1}});
 const message=(text,reply)=>{const msg={from:{id:7},chat:{id:7,type:'private'},text,reply_to_message:{message_id:reply}};handlers.message[0](msg);return msg;};
 return {callback,message,sent,answers,changes};
}
test('services cannot be controlled by outsider or from group',async()=>{const f=fixture();await f.callback('svc:search:2',8);await f.callback('svc:search:2',7,'group');assert.equal(f.changes.length,0);assert.equal(f.sent.length,0);assert.equal(f.answers.length,2);});
test('a limit change needs reply to exact prompt and preserves other settings',async()=>{const f=fixture();await f.callback('svc:field:2:daily_usd');const prompt=f.sent.at(-1).message_id;f.message('0.012',prompt+1);await new Promise(r=>setImmediate(r));assert.equal(f.changes.length,0);const msg=f.message('0,012',prompt);assert.equal(msg._qubiteServiceInput,true);await new Promise(r=>setImmediate(r));assert.equal(f.changes[0].body.daily_usd,.012);assert.equal(f.changes[0].body.daily_requests,10);assert.equal(f.changes[0].body.paid,false);});
test('vault delete requires matching typed login; failed confirmation makes no deletion',async()=>{const f=fixture();await f.callback('svc:delete:2');f.message('other',f.sent.at(-1).message_id);await new Promise(r=>setImmediate(r));assert.equal(f.changes.length,0);await f.callback('svc:delete:2');f.message('friend',f.sent.at(-1).message_id);await new Promise(r=>setImmediate(r));assert.equal(f.changes[0].delete,2);});
test('unknown field callback cannot mutate policy',async()=>{const f=fixture();await f.callback('svc:field:2:role');assert.equal(f.changes.length,0);assert.ok(f.sent.at(-1).text.startsWith('Ошибка'));});
