const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../integrations/qubite-writing/firefox/background.js'),'utf8');
const id='writing@qubiteapp.online',options='moz-extension://qa-writing/options.html';
function background(){
 let listener;const calls=[];
 const browser={
  browserAction:{onClicked:{addListener(){}}},
  contextMenus:{create(){},onClicked:{addListener(){}}},
  runtime:{id,getURL:p=>'moz-extension://qa-writing/'+p,onMessage:{addListener:f=>listener=f}},
  storage:{local:{get:async defaults=>({...defaults,token:'qbw_'+'a'.repeat(64)})}}
 };
 vm.runInNewContext(source,{browser,URL,AbortSignal,fetch:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({access:{ai:true},matches:[]})};}});
 return {send:(message,sender)=>listener(message,sender),calls};
}
test('options opened in a tab can check connection using the private key',async()=>{
 const b=background(),result=await b.send({kind:'request',action:'me'},{id,url:options,tab:{id:7}});
 assert.equal(result.access.ai,true);assert.equal(b.calls.length,1);
 assert.equal(b.calls[0].url,'https://qubiteapp.online/api/writing/v1/me');
 assert.equal(b.calls[0].init.method,'GET');assert.equal(b.calls[0].init.credentials,'omit');
 assert.equal(b.calls[0].init.headers.Authorization,'Bearer qbw_'+'a'.repeat(64));
});
test('options URL query and hash do not break the connection check',async()=>{
 const b=background();await b.send({kind:'request',action:'me'},{id,url:options+'?view=settings#connection',tab:{id:7}});
 assert.equal(b.calls.length,1);
});
test('web pages and other extension pages cannot read account information',async()=>{
 const b=background();
 for(const sender of [
  {id,url:'https://example.org/',tab:{id:7}},
  {id,url:'https://example.org/'},
  {id,url:'moz-extension://another/options.html',tab:{id:7}},
  {id:'another-addon',url:options,tab:{id:7}},
  {id,url:options+'.unexpected',tab:{id:7}},
  {id,tab:{id:7}}
 ])await assert.rejects(b.send({kind:'request',action:'me'},sender),/Недоступная команда/);
 assert.equal(b.calls.length,0);
});
test('content script can still check a text field without receiving the key',async()=>{
 const b=background(),result=await b.send({kind:'request',action:'check',body:{text:'Привет!',language:'ru'}},{id,url:'https://example.org/',tab:{id:7}});
 assert.equal(b.calls[0].url,'https://qubiteapp.online/api/writing/v1/check');
 assert.equal(JSON.parse(b.calls[0].init.body).text,'Привет!');
 assert.ok(!JSON.stringify(result).includes('qbw_'));
});
