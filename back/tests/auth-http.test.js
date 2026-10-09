const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qubite-auth-http-'));
Object.assign(process.env,{DATABASE_PATH:path.join(directory,'db.sqlite'),SEED_DEMO_DATA:'false',APP_BASE_URL:'https://qubite.example',SERVICES_MEMOS_BASE_URL:'https://memos.example',SERVICES_SEARCH_BASE_URL:'https://search.example',SERVICES_INTERNAL_KEY:'test-service-key',QUBITE_PROCESS_ROLE:'auth'});
const express=require('express'),db=require('../src/db');let server,base;
test.before(async()=>{
 await db.initializeDatabase({seedDemoData:false});const app=express();
 app.use((req,res,next)=>{if(req.headers['x-test-owner'])req.auth={user:{id:1,role:'owner'}};next();});
 require('../src/auth-surface').register(app,{requireAuth:(q,s,n)=>q.auth?n():s.status(401).end(),internalKey:(q,s,n)=>q.headers['x-qubite-service-key']==='test-service-key'?n():s.status(403).end()});
 require('../src/service-runtime').registerGate(app);
 app.get('/api/auth/session',(q,s)=>s.json({ok:true}));app.get('/api/tournaments',(q,s)=>s.json({ok:true}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
test('separate auth reuses all existing forms, with independent theme and no foreign redirect',async()=>{
 const r=await fetch(base+'/auth?return_to=https%3A%2F%2Fsearch.example');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 const html=await r.text();for(const id of ['loginModal','front/js/app.js','data-auth-surface','/front/auth.css'])assert.ok(html.includes(id),id);
 assert.equal((await fetch(base+'/auth?return_to=https://foreign.example')).status,400);
 assert.equal((await fetch(base+'/auth?return_to=/auth/')).status,400);
});
test('paused main site cannot block core authentication or redirect to itself',async()=>{
 await db.updateSystemSetting('workspace_enabled',false);
 assert.equal((await fetch(base+'/api/auth/session')).status,200);assert.equal((await fetch(base+'/api/tournaments')).status,503);
 const r=await fetch(base+'/api/auth/destination',{headers:{'x-test-owner':'1'}});assert.equal(r.status,200);assert.equal((await r.json()).paused,true);
});
test('native services are protected before their own login, and never redirect to a dead main page',async()=>{
 assert.equal((await fetch(base+'/internal/services/browser-access?service=memos',{redirect:'manual'})).status,403);
 const h={'x-qubite-service-key':'test-service-key'};let r=await fetch(base+'/internal/services/browser-access?service=memos',{headers:h,redirect:'manual'});
 assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location')).pathname,'/auth');
 r=await fetch(base+'/internal/services/browser-access?service=memos',{headers:{...h,'x-test-owner':'1'}});assert.equal(r.status,200);
 assert.equal((await fetch(base+'/internal/services/browser-access?service=auth',{headers:h})).status,400);
});
