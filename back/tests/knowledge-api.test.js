const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const enrollment=require('../src/knowledge-enrollment'),db=require('../src/db'),grants=require('../src/knowledge-services'),gateway=require('../src/knowledge-api');
let server,base,granted=true,active=true,mapped=true,tokenId=9,calls=[];
const original={lookup:enrollment.lookup,manage:enrollment.manage,get:db.getUserById,access:grants.access};
test.before(async()=>{
 enrollment.lookup=async service=>({ready:mapped,user_id:1,native_id:service==='memos'?'users/friend':'9'});enrollment.manage=async()=>({ready:true});db.getUserById=async()=>({id:1,status:active?'active':'blocked'});grants.access=async()=>({enabled:granted});
 const app=express();app.use(express.json());app.use((q,s,n)=>{if(q.headers['x-browser'])q.auth={user:{id:1}};n();});
 gateway.register(app,{internalKey:(q,s,n)=>q.headers['x-key']==='private-test'?n():s.status(403).end(),authRateLimiter:(q,s,n)=>n()},async(service,path,options)=>{calls.push({service,path,options});return {status:200,data:path.endsWith('/user')?{id:tokenId,username:'friend'}:path.endsWith('/auth/me')?{user:{name:'users/friend'}}:path.endsWith('/auth/refresh')?{accessToken:'synthetic-refreshed-token'}:{token:'synthetic-native-token'},cookies:[]};});
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

test('refresh maps native cookie to grpc metadata and never returns a token after revocation',async()=>{
 const url=base+'/internal/services/knowledge-refresh?service=memos',options={method:'POST',headers:{'x-key':'private-test',Cookie:'memos_refresh=synthetic','Content-Type':'application/json'},body:'{}'};
 let r=await fetch(url,options);assert.equal(r.status,200);assert.equal(calls.at(-2).options.headers['Grpc-Metadata-Cookie'],'memos_refresh=synthetic');
 granted=false;r=await fetch(url,options);assert.equal(r.status,403);assert.equal((await r.json()).accessToken,undefined);assert.equal(r.headers.get('set-cookie'),null);granted=true;
});

test('Vikunja OAuth PKCE exchange/refresh validates grant before releasing token',async()=>{
 const b={grant_type:'authorization_code',code:'synthetic-code',client_id:'test',redirect_uri:'vikunja-test://callback',code_verifier:'synthetic-verifier'};
 // Replace only the synthetic upstream response in this fixture via dedicated app.
 const app=express();app.use(express.json());gateway.register(app,{internalKey:(q,s,n)=>n(),authRateLimiter:(q,s,n)=>n()},async(service,path)=>({status:200,data:path.endsWith('/oauth/token')?{access_token:'synthetic-token',refresh_token:'synthetic-refresh'}:{username:'friend',id:9},cookies:[]}));
 const x=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x));});const url='http://127.0.0.1:'+x.address().port+'/internal/services/knowledge-oauth-token?service=vikunja';
 try{const send=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send(b)).status,200);granted=false;const r=await send(b);assert.equal(r.status,403);assert.equal((await r.json()).access_token,undefined);granted=true;
 assert.equal((await send({...b,url:'http://foreign'})).status,401);
 assert.equal((await send({grant_type:'refresh_token',refresh_token:'synthetic-refresh'})).status,200);
 }finally{granted=true;await new Promise(r=>x.close(r));}
});
