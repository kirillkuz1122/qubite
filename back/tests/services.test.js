const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qubite-services-test-'));
Object.assign(process.env,{DATABASE_PATH:path.join(dir,'db.sqlite'),NODE_ENV:'production',SEED_DEMO_DATA:'false',TELEGRAM_ENABLED:'false',SERVICES_INTERNAL_KEY:'a'.repeat(64),SERVICES_VPN_ENABLED:'true',PROXY_CREDENTIAL_ENCRYPTION_KEY:'test-key-private',VAULT_MANAGEMENT_SOCKET:'',APP_BASE_URL:'https://qubite.example',SESSION_COOKIE_DOMAIN:''});
const native=require('../src/db'),security=require('../src/security'),services=require('../src/services'),express=require('express');
const sqlite3=require('sqlite3'),crypto=require('crypto');
const sql=new sqlite3.Database(process.env.DATABASE_PATH);sql.configure('busyTimeout',10000);
const get=(q,a=[])=>new Promise((r,j)=>sql.get(q,a,(e,v)=>e?j(e):r(v)));
let server,base,owner,friend,second;
const auth=async(req,res,next)=>{const u=await native.getUserById(Number(req.headers['x-test-user']));if(!u||u.status!=='active')return res.status(401).json({error:'Auth'});req.auth={user:{...u,actual_role:u.role,role:req.headers['x-test-preview']||u.role}};next();};
const own=(req,res,next)=>auth(req,res,()=>services.realOwner(req.auth.user)?next():res.status(403).json({error:'Owner'}));
const encryptionKey=crypto.randomBytes(32);
function encrypt(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv);const data=Buffer.concat([c.update(text),c.final()]);return [iv,c.getAuthTag(),data].map(b=>b.toString('base64')).join('.');}
function decrypt(text){const [iv,tag,data]=text.split('.').map(b=>Buffer.from(b,'base64'));const c=crypto.createDecipheriv('aes-256-gcm',encryptionKey,iv);c.setAuthTag(tag);return Buffer.concat([c.update(data),c.final()]).toString();}
async function call(url,user,body,method=body?'POST':'GET',extra={}){const r=await fetch(base+url,{method,headers:{'content-type':'application/json','x-test-user':String(user?.id||0),...extra},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
test.before(async()=>{
 await native.initializeDatabase({seedDemoData:false});
 const create=async login=>native.createUser({uid:login,login,loginNormalized:login,email:login+'@example.com',emailNormalized:login+'@example.com',role:'user',passwordHash:'unused',passwordSalt:'unused'});
 owner=await create('owner');await new Promise((r,j)=>sql.run("UPDATE users SET role='owner' WHERE id=?",[owner.id],e=>e?j(e):r()));owner=await native.getUserById(owner.id);
 friend=await create('friend');second=await create('second');
 const app=express();app.use(express.json());
 services.register(app,{requireAuth:auth,authRateLimiter:(q,s,n)=>n(),createUser:native.createUser,findUserByLoginOrEmail:native.findUserByLoginOrEmail,getUserById:native.getUserById,updateUserPassword:native.updateUserPassword,createSession:native.createSession,sessionCookieOptions:()=>({httpOnly:true}),SESSION_COOKIE_NAME:'qb_session',SESSION_TTL_MS:60000});
 require('../src/proxy/personal').register(app,{requireAuth:auth,requireOwner:own,hashOpaqueToken:security.hashOpaqueToken,encrypt,decrypt,createAuditLog:native.createAuditLog});
 app.use((e,q,s,n)=>s.status(500).json({error:e.message}));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await new Promise(r=>server.close(r));sql.close();fs.rmSync(dir,{recursive:true,force:true});});
test('friend cannot grant access even with owner role preview',async()=>{const r=await call('/api/owner/services/users/'+friend.id+'/search',friend,{enabled:true},'PUT',{'x-test-preview':'owner'});assert.equal(r.status,403);});
test('owner grants isolated search limits without changing roles',async()=>{const r=await call('/api/owner/services/users/'+friend.id+'/search',owner,{enabled:true,paid:true,history:true,daily_requests:12,hourly_requests:4,daily_usd:.01,monthly_usd:.2,lifetime_usd:1},'PUT');assert.equal(r.status,200);const a=(await call('/api/services/me',friend)).data,b=(await call('/api/services/me',second)).data;assert.equal(a.services.search.daily_requests,12);assert.equal(a.services.search.paid,true);assert.equal(b.services.search.enabled,false);assert.equal((await native.getUserById(friend.id)).role,'user');});
test('invalid limits and redirect to foreign host denied',async()=>{assert.equal((await call('/api/owner/services/users/'+friend.id+'/search',owner,{enabled:true,daily_requests:1.5},'PUT')).status,400);const r=await fetch(base+'/services/return?url=https://evil.example',{headers:{'x-test-user':String(friend.id)},redirect:'manual'});assert.equal(r.status,400);});
test('vault enrollment requires grant and exact account username',async()=>{assert.equal((await call('/api/services/vault/enroll',friend)).status,403);await call('/api/owner/services/users/'+friend.id+'/vault',owner,{enabled:true},'PUT');const r=await call('/api/services/vault/enroll',friend);assert.equal(r.status,200);assert.equal(r.data.login,'friend');assert.equal((await call('/internal/services/vault/register',friend,{username:'second'},'POST',{'x-qubite-service-key':'a'.repeat(64)})).status,403);});
test('new account receives one-use invitation and chooses own password',async()=>{const r=await call('/api/owner/services/users',owner,{login:'invited',email:'invited@example.com'});assert.equal(r.status,201);const token=r.data.url.split('#')[1];assert.equal((await call('/api/services/activate',null,{token,password:'ExamplePassword123!'})).status,200);assert.equal((await call('/api/services/activate',null,{token,password:'ExamplePassword123!'})).status,400);});
test('VPN tokens are encrypted; subscriptions cannot be read or rotated by other user',async()=>{let r=await call('/api/owner/services/users/'+friend.id+'/vpn',owner,{days:10,maxConnections:2});assert.equal(r.status,201);const uid=r.data.uid;
 const personal=(await call('/api/proxy/personal',friend)).data;assert.equal(personal.subscription.uid,uid);assert.equal(personal.subscription.maxConnections,2);const token=decodeURIComponent(personal.subscription.url.split('/').pop());const stored=await get('SELECT ciphertext FROM proxy_subscription_secrets WHERE uid=?',[uid]);assert.ok(!stored.ciphertext.includes(token));assert.equal((await call('/api/proxy/personal',second)).data.subscription,null);assert.equal((await call('/api/proxy/personal/rotate',second,{})).status,403);
 r=await call('/api/proxy/personal/rotate',friend,{});assert.equal(r.status,200);assert.notEqual(r.data.url,personal.subscription.url);assert.equal(await native.getActiveProxySubscriptionByTokenHash(security.hashOpaqueToken(token)),null);
});
test('duplicate VPN grant and disabled VPN operations rejected',async()=>{assert.equal((await call('/api/owner/services/users/'+friend.id+'/vpn',owner,{days:10})).status,409);process.env.SERVICES_VPN_ENABLED='false';assert.equal((await call('/api/proxy/personal/rotate',friend,{})).status,503);assert.equal((await call('/api/proxy/personal',friend)).data.available,false);process.env.SERVICES_VPN_ENABLED='true';});

test('concurrent grants create only one subscription',async()=>{const results=await Promise.all([call('/api/owner/services/users/'+second.id+'/vpn',owner,{days:10}),call('/api/owner/services/users/'+second.id+'/vpn',owner,{days:10})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await get("SELECT COUNT(*) n FROM proxy_subscriptions WHERE user_id=? AND type='app'",[second.id])).n,1);});

test('global budget is owner-only and survives a new permissions read',async()=>{assert.equal((await call('/api/owner/services/search-budget',friend,{limit:.02},'PUT')).status,403);assert.equal((await call('/api/owner/services/search-budget',owner,{limit:.02},'PUT')).status,200);assert.equal((await call('/api/services/me',owner)).data.searchBudgetUsd,.02);assert.equal((await call('/api/owner/services/search-budget',owner,{limit:-1},'PUT')).status,400);});

test('owner can remove both request caps using null',async()=>{const r=await call('/api/owner/services/users/'+friend.id+'/search',owner,{enabled:true,paid:true,history:true,daily_requests:null,hourly_requests:null},'PUT');assert.equal(r.status,200);const a=(await call('/api/services/me',friend)).data.services.search;assert.equal(a.daily_requests,null);assert.equal(a.hourly_requests,null);});

test('API keys are one-time secrets, scoped, capped and revocable',async()=>{
 const created=await call('/api/services/search-keys',friend,{name:'agent',scopes:['search'],daily_requests:2});assert.equal(created.status,200);assert.match(created.data.token,/^qbs_/);
 const keys=(await call('/api/services/search-keys',friend)).data.keys;assert.equal(keys.length,1);assert.equal(keys[0].token,undefined);assert.ok(!JSON.stringify(keys).includes(created.data.token));
 const stored=await get('SELECT hash FROM search_api_keys WHERE id=?',[created.data.id]);assert.notEqual(stored.hash,created.data.token);
 const authKey=async(scope,consume=true)=>call('/internal/services/api-key',null,{token:created.data.token,scope,consume},'POST',{'x-qubite-service-key':'a'.repeat(64)});
 assert.equal((await authKey('history')).status,403);assert.equal((await authKey('search')).data.user,'qb:'+friend.id);assert.equal((await authKey('search')).status,200);assert.equal((await authKey('search')).status,429);assert.equal((await authKey('search',false)).status,200);
 assert.equal((await call('/api/services/search-keys?user_id='+friend.id,second)).status,403);
 await call('/api/services/search-keys/'+created.data.id,friend,{},'DELETE');assert.equal((await authKey('search',false)).status,401);
});

test('revoking account grant immediately blocks its API keys',async()=>{
 const key=(await call('/api/services/search-keys',friend,{name:'revocation',scopes:['search','fetch','history'],daily_requests:null})).data.token;
 await call('/api/owner/services/users/'+friend.id+'/search',owner,{enabled:false},'PUT');
 const r=await call('/internal/services/api-key',null,{token:key,scope:'search'},'POST',{'x-qubite-service-key':'a'.repeat(64)});assert.equal(r.status,403);
});

test('search events appear in native audit without queries, history or credentials',async()=>{
 const body={user:'qb:'+owner.id,operation:'fetch.markdown',status:422,elapsed_ms:123.4,cost_usd:.0001,query:'PRIVATE QUERY',token:'PRIVATE TOKEN',history:'PRIVATE HISTORY'};
 assert.equal((await call('/internal/services/event',null,body)).status,403);
 assert.equal((await call('/internal/services/event',null,body,'POST',{'x-qubite-service-key':'a'.repeat(64)})).status,200);
 const row=await get("SELECT * FROM audit_log WHERE entity_type='search_service' ORDER BY id DESC LIMIT 1");
 assert.equal(row.action,'search.error');assert.equal(row.actor_user_id,owner.id);
 const data=JSON.parse(row.payload_json);assert.equal(data.operation,'fetch.markdown');assert.equal(data.elapsed_ms,123);
 assert.ok(!JSON.stringify(row).includes('PRIVATE'));
 assert.equal((await call('/internal/services/event',null,{...body,operation:'arbitrary.query'},'POST',{'x-qubite-service-key':'a'.repeat(64)})).status,400);
 const grant=await get("SELECT * FROM audit_log WHERE action='services.search.grant' ORDER BY id DESC LIMIT 1");assert.ok(grant);
});

test('AI analytics are owner-only and map account ids without exposing history',async()=>{
 const original=global.fetch;let calls=0;
 global.fetch=async(url,options)=>{
  if(String(url).includes('/internal/analytics?')){calls++;assert.equal(options.headers['X-Qubite-Service-Key'],'a'.repeat(64));return {ok:true,json:async()=>({users:[{user:'qb:'+friend.id,calls:2,cost_usd:.001}],models:[],daily:[],totals:{calls:2,cost_usd:.001},today:{calls:2,cost_usd:.001},user_models:[]})};}
  return original(url,options);
 };
 try{
  assert.equal((await call('/api/owner/services/search-analytics',friend)).status,403);
  assert.equal((await call('/api/owner/services/search-analytics',friend,undefined,'GET',{'x-test-preview':'owner'})).status,403);
  assert.equal(calls,0);
  const result=await call('/api/owner/services/search-analytics?user=qb:'+friend.id,owner);
  assert.equal(result.status,200);assert.equal(result.data.selected_login,friend.login);assert.equal(result.data.users[0].login,friend.login);assert.equal(calls,1);
  assert.equal((await call('/api/owner/services/search-analytics?user=bad%20value',owner)).status,400);
 }finally{global.fetch=original;}
});

test('query logs are owner-only; protection purges text and keeps technical audit',async()=>{
 const logs=require('../src/search-logs');
 assert.equal((await services.permissions(owner)).services.search.logs_protected,true);
 assert.equal((await services.permissions(friend)).services.search.logs_protected,false);
 const event=(u,query,operation='web.search')=>call('/internal/services/event',null,{user:'qb:'+u.id,operation,status:200,query,token:'DO NOT STORE TOKEN'},'POST',{'x-qubite-service-key':'a'.repeat(64)});
 await event(owner,'OWNER MUST NOT LEAK');await event(friend,'PRIVATE QUERY <script>alert(1)</script>');
 assert.equal((await call('/api/owner/services/search-logs',friend)).status,403);
 assert.equal((await call('/api/owner/services/search-logs',friend,undefined,'GET',{'x-test-preview':'owner'})).status,403);
 assert.equal((await call('/api/owner/services/users/'+friend.id+'/search-log-protection',friend,{protected:true},'PUT')).status,403);
 const list=(await call('/api/owner/services/search-logs?user_id='+friend.id,owner)).data.items;
 assert.equal(list.length,1);assert.equal(list[0].query,'PRIVATE QUERY <script>alert(1)</script>');assert.equal(list[0].login,friend.login);
 assert.equal((await call('/api/owner/services/search-logs?user_id='+owner.id,owner)).data.items.length,0);
 const row=await get("SELECT al.*,u.login actor_login FROM audit_log al LEFT JOIN users u ON u.id=al.actor_user_id WHERE al.actor_user_id=? AND al.entity_id='web.search' ORDER BY al.id DESC LIMIT 1",[friend.id]);
 assert.ok(JSON.parse(row.payload_json).query_log_id);assert.ok(!JSON.stringify(row).includes('PRIVATE QUERY'));assert.ok(!JSON.stringify(row).includes('DO NOT STORE TOKEN'));
 assert.match((await logs.enrich([row],owner))[0].summary,/PRIVATE QUERY/);
 assert.ok(!(await logs.enrich([row],friend))[0].summary.includes('PRIVATE QUERY'));
 assert.equal((await call('/api/owner/services/users/'+friend.id+'/search-log-protection',owner,{protected:'true'},'PUT')).status,400);
 assert.equal((await call('/api/owner/services/users/'+friend.id+'/search-log-protection',owner,{protected:true},'PUT')).status,200);
 assert.equal((await services.permissions(friend)).services.search.logs_protected,true);
 assert.equal((await get('SELECT count(*) n FROM search_query_logs WHERE user_id=?',[friend.id])).n,0);
 assert.ok(!(await logs.enrich([row],owner))[0].summary.includes('PRIVATE QUERY'));
 await event(friend,'PROTECTED MUST NOT LEAK');
 assert.equal((await call('/api/owner/services/search-logs?user_id='+friend.id,owner)).data.items.length,0);
 assert.ok(await get('SELECT id FROM audit_log WHERE id=?',[row.id]));
 await call('/api/owner/services/users/'+friend.id+'/search-log-protection',owner,{protected:false},'PUT');
 await event(friend,'AFTER ENABLE');await event(friend,'FETCH NOT A SEARCH','fetch.markdown');
 assert.deepEqual((await call('/api/owner/services/search-logs?user_id='+friend.id,owner)).data.items.map(x=>x.query),['AFTER ENABLE']);
 assert.equal((await call('/api/owner/services/search-logs?user_id=bad',owner)).status,400);
});

test('owner can change own log protection; racing writes cannot bypass it',async()=>{
 const logs=require('../src/search-logs');
 assert.equal((await call('/api/owner/services/users/'+owner.id+'/search-log-protection',owner,{protected:false},'PUT')).status,200);
 assert.ok(await logs.record(owner.id,'web.search','OWNER OPTED IN'));
 await Promise.all([...Array(12)].map((_,i)=>logs.record(owner.id,'web.search','RACE '+i)).concat(logs.setProtection(owner,owner,true)));
 assert.equal(await logs.record(owner.id,'web.search','AFTER PROTECTION'),null);
 assert.equal((await get('SELECT count(*) n FROM search_query_logs WHERE user_id=?',[owner.id])).n,0);
 assert.equal((await services.permissions(owner)).services.search.logs_protected,true);
});

test('expired queries are removed even without a new search',async()=>{
 const logs=require('../src/search-logs');
 await new Promise((r,j)=>sql.run('INSERT INTO search_query_logs(user_id,operation,query,created) VALUES (?,?,?,?)',[friend.id,'web.search','EXPIRED QUERY','2000-01-01T00:00:00.000Z'],e=>e?j(e):r()));
 const before=(await logs.list(owner,friend.id)).map(x=>x.query);assert.ok(!before.includes('EXPIRED QUERY'));assert.ok(before.includes('AFTER ENABLE'));
 await logs.prune();assert.equal((await get('SELECT count(*) n FROM search_query_logs WHERE query=?',['EXPIRED QUERY'])).n,0);
 assert.ok((await logs.list(owner,friend.id)).some(x=>x.query==='AFTER ENABLE'));
});

test('knowledge grants require real owner, isolate accounts and are reversible',async()=>{
 assert.equal((await services.permissions(friend)).services.memos.enabled,false);
 assert.equal((await services.permissions(owner)).services.memos.enabled,true);
 assert.equal((await call('/api/owner/services/users/'+friend.id+'/knowledge/memos',second,{enabled:true},'PUT',{'x-test-preview':'owner'})).status,403);
 assert.equal((await call('/api/owner/services/users/'+friend.id+'/knowledge/memos',owner,{enabled:true},'PUT')).status,200);
 assert.equal((await services.permissions(friend)).services.memos.enabled,true);
 assert.equal((await services.permissions(second)).services.memos.enabled,false);
 assert.equal((await call('/api/owner/services/users/'+friend.id+'/knowledge/memos',owner,{enabled:false},'PUT')).status,200);
 assert.equal((await services.permissions(friend)).services.memos.enabled,false);
});
