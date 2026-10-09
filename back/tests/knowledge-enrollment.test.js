const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qb-enrollment-'));
Object.assign(process.env,{DATABASE_PATH:path.join(root,'db.sqlite'),SEED_DEMO_DATA:'false',APP_BASE_URL:'https://qubite.example',KNOWLEDGE_MANAGEMENT_SOCKET:path.join(root,'manager.sock')});
const express=require('express'),db=require('../src/db'),grants=require('../src/knowledge-services'),enroll=require('../src/knowledge-enrollment');let server,manager,base,calls=[],audits=[],reply={ready:false,login:'friend'};
const users={1:{id:1,login:'owner',email:'owner@example.org',role:'owner'},2:{id:2,login:'friend',email:'friend@example.org',role:'user'},3:{id:3,login:'other',email:'other@example.org',role:'user'}};
test.before(async()=>{
 await db.initializeDatabase({seedDemoData:false});await grants.set(users[1],users[2],'memos',true);
 manager=http.createServer((q,s)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{calls.push(JSON.parse(body));s.writeHead(reply.status||200,{'Content-Type':'application/json'});s.end(JSON.stringify(reply));});});await new Promise(r=>manager.listen(process.env.KNOWLEDGE_MANAGEMENT_SOCKET,r));
 const app=express();app.use(express.json());app.use((q,s,n)=>{q.auth={user:users[q.headers['x-user']]};n();});
 enroll.register(app,{requireAuth:(q,s,n)=>q.auth.user?n():s.status(401).json({error:'Auth'}),authRateLimiter:(q,s,n)=>n(),audit:async(...a)=>audits.push(a)});
 require('../src/service-runtime').registerGate(app);app.use((e,q,s,n)=>s.status(500).json({error:'Unexpected'}));
 server=await new Promise(r=>{let x=app.listen(0,'127.0.0.1',()=>r(x));});base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>manager.close(r))]);fs.rmSync(root,{recursive:true,force:true});});
function request(user,body){return fetch(base+'/api/services/knowledge/memos/enroll',{method:body===undefined?'GET':'POST',headers:{'x-user':String(user),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
test('no anonymous or ungranted account can invoke privileged enrollment',async()=>{
 const before=calls.length;assert.equal((await request(0)).status,401);assert.equal((await request(3,{password:'SamplePass731'})).status,403);assert.equal(calls.length,before);
 const r=await fetch(base+'/service-enroll?service=memos',{redirect:'manual'});assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location')).pathname,'/auth');
});
test('identity comes exclusively from Qubite and payload cannot change it',async()=>{
 assert.equal((await request(2,{password:'SamplePass731',user_id:1})).status,400);
 const r=await request(2,{password:'SamplePass731'});assert.equal(r.status,200);assert.deepEqual(calls.at(-1),{action:'enroll',service:'memos',user_id:2,login:'friend',email:'friend@example.org',password:'SamplePass731'});assert.deepEqual(audits.at(-1),[2,2,'memos:enrolled']);
});
test('replay returns safe conflict and no extra audit',async()=>{
 reply={status:409,error:'Первичная регистрация недоступна.'};const count=audits.length;const r=await request(2,{password:'SamplePass731'});assert.equal(r.status,409);assert.equal((await r.json()).error,reply.error);assert.equal(audits.length,count);
});
test('registration stays available with main workspace disabled',async()=>{
 reply={ready:false,login:'friend'};await db.updateSystemSetting('workspace_enabled',false);
 assert.equal((await request(2)).status,200);const r=await fetch(base+'/service-enroll?service=memos',{headers:{'x-user':'2'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok((await r.text()).includes('new-password'));
});
