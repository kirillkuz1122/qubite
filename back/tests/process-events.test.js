const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
process.env.QUBITE_EVENT_SOCKET_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'qubite-ipc-'));
const events=require('../src/process-events');
test('split processes deliver audit and support privately, reject unknown events and duplicate listeners',async()=>{
 const received=[];const server=await events.listen('bot',(type,payload)=>received.push({type,payload}));
 try{
  assert.equal(fs.statSync(events.socket('bot')).mode&0o777,0o600);
  await events.send('bot','audit',{action:'system.setting.update'});
  await events.send('bot','tg:reply',{chat:{id:7},message:{body:'test'}});
  assert.equal(received.length,2);assert.equal(received[1].payload.chat.id,7);
  await assert.rejects(events.send('bot','execute',{command:'id'}));
  await assert.rejects(events.send('bot','message',{body:'x'.repeat(66000)}));
  await assert.rejects(events.listen('bot',()=>{}),/already running/);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(process.env.QUBITE_EVENT_SOCKET_DIR,{recursive:true,force:true});}
});
