const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qb-writing-'));
Object.assign(process.env,{DATABASE_PATH:path.join(dir,'db.sqlite'),APP_BASE_URL:'https://qb.example',NODE_ENV:'production',TELEGRAM_ENABLED:'false',SEED_DEMO_DATA:'false',WRITING_OPENROUTER_API_KEY:'test-private-key',WRITING_DAILY_BUDGET_RUB:'5',WRITING_RUB_PER_USD:'100'});
const native=require('../src/db'),writing=require('../src/writing'),services=require('../src/services'),express=require('express'),sqlite=require('sqlite3');
const sql=new sqlite.Database(process.env.DATABASE_PATH);
const get=(q,a=[])=>new Promise((r,j)=>sql.get(q,a,(e,v)=>e?j(e):r(v)));
let owner,friend,server,base;
const auth=async(q,s,n)=>{const u=await native.getUserById(Number(q.headers['x-test-user']));if(!u)return s.status(401).json({error:'Auth'});q.auth={user:{...u,actual_role:u.role,role:q.headers['x-preview']||u.role}};n();};
async function call(url,u,body,method=body?'POST':'GET',headers={}){const r=await fetch(base+url,{method,headers:{'content-type':'application/json','x-test-user':String(u?.id||0),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,headers:r.headers,data:r.status===204?{}:await r.json()};}
test.before(async()=>{
 await native.initializeDatabase({seedDemoData:false});
 const create=login=>native.createUser({uid:login,login,loginNormalized:login,email:login+'@example.com',emailNormalized:login+'@example.com',role:'user',passwordHash:'unused',passwordSalt:'unused'});
 owner=await create('owner');friend=await create('friend');await new Promise((r,j)=>sql.run("UPDATE users SET role='owner' WHERE id=?",[owner.id],e=>e?j(e):r()));owner=await native.getUserById(owner.id);
 const app=express();app.use(express.json());const guard=require('../src/request-guard').createOriginGuard({allowedOrigins:['https://qb.example'],allowedHosts:[]});app.use((q,s,n)=>writing.bypassCookieGuard(q)?n():guard(q,s,n));
 services.register(app,{requireAuth:auth,authRateLimiter:(q,s,n)=>n(),getUserById:native.getUserById,createAuditLog:native.createAuditLog});
 app.use((e,q,s,n)=>s.status(500).json({error:e.message}));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{if(server)await new Promise(r=>server.close(r));sql.close();fs.rmSync(dir,{recursive:true,force:true});});
test('access and grants use actual owner role and are independent of search',async()=>{
 assert.equal((await call('/api/writing/me',friend)).data.access.enabled,false);
 const grant='/api/owner/services/users/'+friend.id+'/grammar';
 assert.equal((await call(grant,friend,{enabled:true,ai:true},'PUT',{'x-preview':'owner'})).status,403);
 assert.equal((await call(grant,owner,{enabled:true,ai:true,daily_requests:null,ai_daily_requests:null,daily_rub:null},'PUT')).status,200);
 const me=(await call('/api/services/me',friend)).data;assert.equal(me.services.grammar.enabled,true);assert.equal(me.services.search.enabled,false);assert.equal(me.services.grammar.daily_rub,null);
 assert.equal((await call(grant,owner,{enabled:true,daily_requests:1.2},'PUT')).status,400);
});
test('cookie guard is preserved and bearer extension CORS is narrow',async()=>{
 const path='/api/writing/v1/check',origin='moz-extension://c0ffee-123';
 assert.equal((await call(path,null,undefined,'OPTIONS',{origin})).status,204);
 assert.equal((await call('/api/writing/keys',owner,{name:'x'},'POST',{origin})).status,403);
 assert.equal((await call(path,owner,{text:'Hello'},'POST',{origin})).status,403);
 assert.equal((await call('/api/writing/v1/me',owner,undefined,'GET',{origin:'https://evil.example'})).status,403);
});
test('keys are hashed, scopes isolated, and revocation takes effect immediately',async()=>{
 const k=(await call('/api/writing/keys',friend,{name:'Firefox',ai:false})).data;assert.match(k.token,/^qbw_[a-f0-9]{64}$/);
 assert.ok(!(await get('SELECT hash FROM writing_keys WHERE id=?',[k.id])).hash.includes(k.token));
 assert.ok(!JSON.stringify((await call('/api/writing/keys',friend)).data).includes(k.token));
 const h={authorization:'Bearer '+k.token,origin:'moz-extension://test-id'};
 assert.equal((await call('/api/writing/v1/me',null,undefined,'GET',h)).status,200);
 assert.equal((await call('/api/writing/v1/rewrite',null,{text:'Hello',mode:'check'},'POST',h)).status,403);
 assert.equal((await call('/api/writing/v1/check',null,{text:'x'.repeat(8001)},'POST',h)).status,400);
 await call('/api/writing/keys/'+k.id,owner,{},'DELETE');assert.equal((await call('/api/writing/v1/me',null,undefined,'GET',h)).status,200);
 await call('/api/writing/keys/'+k.id,friend,{},'DELETE');assert.equal((await call('/api/writing/v1/me',null,undefined,'GET',h)).status,401);
});
test('revoked grant blocks its still active keys',async()=>{
 const k=(await call('/api/writing/keys',friend,{})).data;
 await call('/api/owner/services/users/'+friend.id+'/grammar',owner,{enabled:false},'PUT');
 assert.equal((await call('/api/writing/v1/me',null,undefined,'GET',{authorization:'Bearer '+k.token})).status,403);
});
test('local check uses fixed loopback and stores no input; overflow fails immediately',async()=>{
 const original=global.fetch;let release;const upstream=new Promise(r=>release=r),matches=[{offset:0,length:2,replacements:[{value:'Привет'}],message:'Ошибка'}];
 global.fetch=async(url,opt)=>{if(String(url).startsWith('http://127.0.0.1:9091')){assert.ok(opt.body.get('text').includes('PRIVATE'));await upstream;return {ok:true,json:async()=>({matches})};}return original(url,opt);};
 try{
  const first=writing.check(owner,{text:'PRIVATE draft',language:'ru'});await new Promise(r=>setTimeout(r,25));
  await assert.rejects(writing.check(owner,{text:'PRIVATE next'}),e=>e.status===429);release();assert.deepEqual((await first).matches,matches);
  process.env.LANGUAGETOOL_URL='http://169.254.169.254';await assert.rejects(writing.check(owner,{text:'PRIVATE'}),e=>e.status===503);delete process.env.LANGUAGETOOL_URL;
  const rows=await new Promise((r,j)=>sql.all('SELECT * FROM writing_usage',[],(e,v)=>e?j(e):r(v)));assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
 }finally{release();global.fetch=original;delete process.env.LANGUAGETOOL_URL;}
});
test('parallel AI requests reserve budget atomically, enforce price and never retry',async()=>{
 await native.updateSystemSetting('writing_daily_budget_rub',0.025);
 const original=global.fetch;let count=0,release;const wait=new Promise(r=>release=r);
 global.fetch=async(url,opt)=>{if(String(url).startsWith('https://openrouter.ai/')){count++;const body=JSON.parse(opt.body);assert.equal(body.provider.allow_fallbacks,false);assert.deepEqual(body.provider.only,['deepinfra/fp8']);assert.equal(body.provider.max_price.completion,.08);assert.ok(!JSON.stringify(body.messages).includes('PRIVATE previous'));await wait;return {ok:true,json:async()=>({usage:{cost:.000001},choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'Привет!',notes:[],questions:[]})}}]})};}return original(url,opt);};
 try{
  const first=writing.rewrite(owner,{text:'PRIVATE current',mode:'improve'});await new Promise(r=>setTimeout(r,40));
  await assert.rejects(writing.rewrite(owner,{text:'PRIVATE next',mode:'check'}),e=>e.status===429);release();assert.equal((await first).text,'Привет!');assert.equal(count,1);
 }finally{release();global.fetch=original;await native.updateSystemSetting('writing_daily_budget_rub',5);}
});
test('malformed or truncated AI content never passes as text and uncertain costs stay reserved',async()=>{
 const original=global.fetch;
 global.fetch=async(url,opt)=>String(url).startsWith('https://openrouter.ai/')?{ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"text":"PRIVATE'}}]})}:original(url,opt);
 try{await assert.rejects(writing.rewrite(owner,{text:'PRIVATE source',mode:'prompt'}),e=>e.status===422);const row=await get("SELECT * FROM writing_usage WHERE operation='ai.prompt' ORDER BY id DESC LIMIT 1");assert.equal(row.status,'error');assert.ok(row.cost>0);assert.ok(!JSON.stringify(row).includes('PRIVATE'));}finally{global.fetch=original;}
});
