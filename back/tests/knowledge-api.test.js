const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const enrollment=require('../src/knowledge-enrollment'),db=require('../src/db'),grants=require('../src/knowledge-services'),gateway=require('../src/knowledge-api');
let server,base,granted=true,active=true,mapped=true,tokenId=9,calls=[];
const original={lookup:enrollment.lookup,manage:enrollment.manage,get:db.getUserById,access:grants.access};
test.before(async()=>{
 enrollment.lookup=async()=>({ready:mapped,user_id:1,native_id:'9'});enrollment.manage=async()=>({ready:true});db.getUserById=async()=>({id:1,status:active?'active':'blocked'});grants.access=async()=>({enabled:granted});
 const app=express();app.use(express.json());app.use((q,s,n)=>{if(q.headers['x-browser'])q.auth={user:{id:1}};n();});
 gateway.register(app,{internalKey:(q,s,n)=>q.headers['x-key']==='private-test'?n():s.status(403).end(),authRateLimiter:(q,s,n)=>n()},async(service,path,options)=>{calls.push({service,path,options});return {status:200,data:path.endsWith('/user')?{id:tokenId,username:'friend'}:{token:'synthetic-native-token'},cookies:[]};});
 server=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x));});base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await new Promise(r=>server.close(r));enrollment.lookup=original.lookup;enrollment.manage=original.manage;db.getUserById=original.get;grants.access=original.access;});
function call(path,body,headers={}){return fetch(base+'/internal/services/knowledge-'+path+'?service=vikunja',{method:body?'POST':'GET',headers:{'x-key':'private-test','Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});}
test('native login still needs active exact Qubite enrollment and grant',async()=>{
 mapped=false;let n=calls.length;assert.equal((await call('login',{username:'friend',password:'not-real'})).status,401);assert.equal(calls.length,n);
 mapped=true;granted=false;assert.equal((await call('login',{username:'friend',password:'not-real'})).status,401);granted=true;active=false;assert.equal((await call('login',{username:'friend',password:'not-real'})).status,401);active=true;
 assert.equal((await call('login',{username:'friend',password:'not-real'})).status,200);assert.equal(calls.at(-1).path,'/api/v1/login');
});
test('native bearer identity is validated by upstream and must match binding',async()=>{
 assert.equal((await call('api',null,{Authorization:'Bearer synthetic-native-token'})).status,200);
 tokenId=22;assert.equal((await call('api',null,{Authorization:'Bearer synthetic-native-token'})).status,403);tokenId=9;
});
test('another browser cookie cannot bypass revocation of presented native token',async()=>{
 granted=false;assert.equal((await call('api',null,{Authorization:'Bearer synthetic-native-token','x-browser':'1'})).status,403);granted=true;
 assert.equal((await call('api',null,{Authorization:'Bearer bad','x-browser':'1'})).status,401);
});
test('anonymous requests cannot reach protected API or login arbitrary upstream',async()=>{
 assert.equal((await call('api')).status,401);assert.equal((await call('login',{username:'friend',password:'not-real',url:'http://elsewhere'})).status,401);
 assert.equal((await call('login',{username:'friend',password:'not-real'},{'x-key':'wrong'})).status,403);
 assert.equal((await call('login',{username:'friend',password:'not-real'},{Origin:'https://evil.example'})).status,403);
});

test('Memos REST refresh cookie becomes a standard secure cookie without splitting Expires comma',()=>{
 const value='memos_refresh=synthetic; Path=/; HttpOnly; Expires=Wed, 10 Oct 2027 00:00:00 GMT; SameSite=Lax';
 const h=new Headers({'grpc-metadata-set-cookie':value});assert.deepEqual(gateway.nativeCookies('memos',h),[value+'; Secure']);
 assert.deepEqual(gateway.nativeCookies('memos',new Headers({'grpc-metadata-set-cookie':'unexpected=synthetic'})),[]);
 assert.deepEqual(gateway.nativeCookies('vikunja',h),[]);
 const direct=new Headers({'Set-Cookie':value+'; Secure'});assert.deepEqual(gateway.nativeCookies('memos',direct),[value+'; Secure']);
});
