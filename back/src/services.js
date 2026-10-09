// Additional services share Qubite identities; vault passwords never enter this module.
const sqlite3 = require('sqlite3');
const crypto = require('crypto');
const {DATABASE_PATH, APP_BASE_URL} = require('./config');
const security = require('./security');
const db = new sqlite3.Database(DATABASE_PATH);
db.configure('busyTimeout',10000);
const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this);}));
const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
let ready,auditWriter;
function initialize(){
 if(!ready)ready=new Promise((resolve,reject)=>db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS service_access(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, service TEXT NOT NULL CHECK(service IN ('search','vault')), enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', updated TEXT NOT NULL, PRIMARY KEY(user_id,service));
 CREATE TABLE IF NOT EXISTS service_invites(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires TEXT NOT NULL, used TEXT, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS service_audit(id INTEGER PRIMARY KEY, actor INTEGER, user_id INTEGER, action TEXT, created TEXT NOT NULL);
 `,e=>e?reject(e):resolve()));
 return ready;
}
function urls(){return {search:process.env.SERVICES_SEARCH_BASE_URL||'https://search.qubiteapp.online',vault:process.env.SERVICES_VAULT_BASE_URL||'https://vault.qubiteapp.online'};}
function realOwner(user){return (user?.actual_role||user?.role)==='owner';}
function requireOwner(req,res,next){if(!realOwner(req.auth?.user))return res.status(403).json({error:'Только владелец может управлять сервисами.'});next();}
function limits(input={}){
 const output={paid:input.paid===true,history:input.history===true};
 for(const [key,def,max] of [['daily_requests',10,10000],['hourly_requests',3,1000],['daily_usd',0,100],['monthly_usd',0,1000],['lifetime_usd',0,10000]]){
  const v=input[key]===undefined?def:input[key];
  if(v===null){output[key]=null;continue;}
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||(!key.endsWith('_usd')&&!Number.isInteger(v)))throw Object.assign(new Error('Некорректный лимит '+key),{status:400});
  output[key]=v;
 }
 return output;
}
async function permissions(user){
 await initialize();
 const result={user:'qb:'+user.id,id:user.id,login:user.login,owner:realOwner(user),services:{},urls:urls(),vpnAvailable:await require('./proxy/availability').available(),searchBudgetUsd:await globalBudget()};
 for(const name of ['search','vault']){
  const row=await get('SELECT * FROM service_access WHERE user_id=? AND service=?',[user.id,name]);
  result.services[name]={enabled:result.owner||Boolean(row?.enabled),...(name==='search'?{...limits(row?JSON.parse(row.config):{}),logs_protected:await require('./search-logs').protectedFor(user)}:{} )};
  if(result.owner&&name==='search')Object.assign(result.services[name],{paid:true,history:true,daily_requests:null,hourly_requests:null,daily_usd:null,monthly_usd:null,lifetime_usd:null});
 }
 for(const name of require('./knowledge-services').NAMES)result.services[name]=await require('./knowledge-services').access(user,name);
 Object.assign(result.urls,require('./knowledge-services').urls());
 if(process.env.SIYUAN_PRIVATE_FILE){result.services.siyuan={enabled:result.owner};result.urls.siyuan=require('./siyuan').url();}
 result.services.grammar=await require('./writing').access(user);
 result.urls.grammar=APP_BASE_URL+'/writing';
 return result;
}
async function invite(userId){
 await initialize();const token=crypto.randomBytes(32).toString('hex'),now=new Date();
 await run('UPDATE service_invites SET used=? WHERE user_id=? AND used IS NULL',[now.toISOString(),userId]);
 await run('INSERT INTO service_invites VALUES (?,?,?,NULL,?)',[security.hashOpaqueToken(token),userId,new Date(Date.now()+7*86400000).toISOString(),now.toISOString()]);
 return {url:APP_BASE_URL+'/service-invite#'+token,expiresDays:7};
}
async function audit(actor,userId,action){await initialize();await run('INSERT INTO service_audit(actor,user_id,action,created) VALUES (?,?,?,?)',[actor,userId,action,new Date().toISOString()]);await (auditWriter||require('./db').createAuditLog)({actorUserId:actor,action:'services.'+action.replaceAll(':','.'),entityType:'service_access',entityId:userId,summary:'Сервисы: '+action+' · аккаунт '+(userId??'общие настройки'),payload:{serviceAction:action}});}
function internalKey(req,res,next){
 const a=Buffer.from(process.env.SERVICES_INTERNAL_KEY||''),b=Buffer.from(req.headers['x-qubite-service-key']||'');
 if(a.length<32||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).json({error:'Forbidden'});next();
}
async function listUsers(){await initialize();return all("SELECT id,uid,login,email,role,status,last_login_at FROM users WHERE status!='deleted' ORDER BY login");}
function assertOwner(actor){if(!realOwner(actor))throw Object.assign(new Error('Только владелец управляет сервисами.'),{status:403});}
async function setAccess(actor,user,name,input){
 assertOwner(actor);await initialize();if(!user||!['search','vault'].includes(name))throw Object.assign(new Error('Некорректный аккаунт или сервис.'),{status:400});
 if(realOwner(user))throw Object.assign(new Error('Права владельца изменяются только через CLI.'),{status:400});
 const cfg=name==='search'?limits(input):{},enabled=input.enabled===true;
 if(name==='vault'&&process.env.VAULT_MANAGEMENT_SOCKET)await require('./vault-integration').manage('block',user.login,{blocked:!enabled});
 await run('INSERT INTO service_access VALUES (?,?,?,?,?) ON CONFLICT(user_id,service) DO UPDATE SET enabled=excluded.enabled,config=excluded.config,updated=excluded.updated',[user.id,name,Number(enabled),JSON.stringify(cfg),new Date().toISOString()]);
 await audit(actor.id,user.id,name+':'+(enabled?'grant':'revoke'));return {ok:true};
}
async function createAccount(actor,input){
 assertOwner(actor);await initialize();const native=require('./db'),login=security.normalizeLogin(input.login),email=security.normalizeEmail(input.email);
 if(!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(login)||!/^\S+@\S+\.\S+$/.test(email)||email.length>120)throw Object.assign(new Error('Логин: 3–32 латинских символа; нужна корректная почта.'),{status:400});
 if(await native.findUserByLoginOrEmail(login)||await native.findUserByLoginOrEmail(email))throw Object.assign(new Error('Аккаунт уже существует. Выдай доступ существующему аккаунту.'),{status:409});
 const pw=await security.hashPassword(crypto.randomBytes(48).toString('hex'));
 const u=await native.createUser({uid:security.makeUid(),login,loginNormalized:login,email,emailNormalized:email,role:'user',passwordHash:pw.hash,passwordSalt:pw.salt});
 await audit(actor.id,u.id,'account:invite');return {id:u.id,...await invite(u.id)};
}
async function inviteExisting(actor,user){
 assertOwner(actor);if(!user||realOwner(user))throw Object.assign(new Error('Недоступный аккаунт.'),{status:400});await initialize();
 const row=await get('SELECT last_login_at FROM users WHERE id=?',[user.id]);if(row?.last_login_at)throw Object.assign(new Error('Пользователь уже входит сам. Первичное приглашение не меняет пароль.'),{status:400});return invite(user.id);
}
async function deleteVault(actor,user,confirm){
 assertOwner(actor);if(!user||realOwner(user)||confirm!==user.login)throw Object.assign(new Error('Удаление не подтверждено или защищённый аккаунт.'),{status:400});
 await require('./vault-integration').manage('delete',user.login);await initialize();await audit(actor.id,user.id,'vault:deleted');return {ok:true};
}
async function globalBudget(){return Number(await require('./db').getSystemSettingValue('search_daily_budget_usd',Number(process.env.SEARCH_DAILY_BUDGET_USD||.05)));}
async function setGlobalBudget(actor,value){assertOwner(actor);if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Object.assign(new Error('Бюджет: число от 0 до 100 долларов.'),{status:400});await require('./db').updateSystemSetting('search_daily_budget_usd',value);await initialize();await audit(actor.id,null,'search:budget');return {limit:value};}
async function searchUsage(){
 const response=await fetch((process.env.SEARCH_INTERNAL_URL||'http://127.0.0.1:9120')+'/internal/stats',{headers:{'X-Qubite-Proxy':process.env.SERVICES_INTERNAL_KEY||'','X-Qubite-Service-Key':process.env.SERVICES_INTERNAL_KEY||''},signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Статистика поиска пока недоступна.');return response.json();
}

async function searchAnalytics(days=30,user=''){
 const q=new URLSearchParams({days:String(Math.max(1,Math.min(90,Number(days)||30)))});if(user)q.set('user',user);
 const response=await fetch((process.env.SEARCH_INTERNAL_URL||'http://127.0.0.1:9120')+'/internal/analytics?'+q,{headers:{'X-Qubite-Proxy':process.env.SERVICES_INTERNAL_KEY||'','X-Qubite-Service-Key':process.env.SERVICES_INTERNAL_KEY||''},signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Аналитика поиска пока недоступна.');return response.json();
}

function register(app,deps){
 auditWriter=deps.createAuditLog;
 const {requireAuth,authRateLimiter,createUser,findUserByLoginOrEmail,getUserById,updateUserPassword,createSession,sessionCookieOptions,SESSION_COOKIE_NAME,SESSION_TTL_MS}=deps;
 require('./writing').register(app,{requireAuth,getUserById,audit});
 require('./knowledge-services').register(app,{requireAuth,requireOwner,getUserById,audit});
 require('./knowledge-enrollment').register(app,{requireAuth,authRateLimiter,audit});
 require('./knowledge-api').register(app,{internalKey,authRateLimiter});
 require('./siyuan').register(app,{internalKey});
 app.get('/design-system',(req,res)=>res.sendFile(require('path').join(__dirname,'../../design-system.html')));
 app.get('/services/return',requireAuth,(req,res)=>{
  const target=require('./auth-surface').validateTarget(req.query.url);if(!target)return res.status(400).end();res.set('Cache-Control','no-store').redirect(target);
 });
 app.post('/internal/services/event',internalKey,async(req,res,next)=>{try{
  const {user,operation,status,elapsed_ms,cost_usd}=req.body;
  const allowed=['search.summary','search.sources','fetch.markdown','fetch.summary','fetch.html','history.list','history.read','web.answer','web.search','model.error'];
  if(!/^qb:[0-9]+$/.test(user||'')||!allowed.includes(operation)||!Number.isInteger(status)||status<100||status>599)return res.status(400).json({error:'Некорректное событие.'});
  const uid=Number(user.slice(3));if(!await getUserById(uid))return res.status(400).json({error:'Нет аккаунта.'});
  const details={service:'search',operation,status};if(Number.isFinite(elapsed_ms))details.elapsed_ms=Math.max(0,Math.min(600000,Math.round(elapsed_ms)));if(Number.isFinite(cost_usd))details.cost_usd=Math.max(0,Math.min(100,cost_usd));
  const queryLog=await require('./search-logs').record(uid,operation,req.body.query);if(queryLog)details.query_log_id=queryLog;
  await (auditWriter||require('./db').createAuditLog)({actorUserId:uid,action:'search.'+(status>=400?'error':'operation'),entityType:'search_service',entityId:operation,summary:'Поиск: '+operation+' · HTTP '+status,payload:details});res.json({ok:true});
 }catch(e){next(e);}});
 app.get('/internal/services/session',internalKey,requireAuth,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await permissions(req.auth.user));}catch(e){next(e);}});
 app.get('/api/services/me',requireAuth,async(req,res,next)=>{try{res.json(await permissions(req.auth.user));}catch(e){next(e);}});
 app.get('/api/owner/services/search-analytics',requireAuth,requireOwner,async(req,res,next)=>{try{
  const user=String(req.query.user||'');if(user&&!/^[a-zA-Z0-9_:.-]{1,100}$/.test(user))return res.status(400).json({error:'Некорректный пользователь.'});
  const data=await searchAnalytics(req.query.days,user);const users=await listUsers();
  const names=new Map(users.map(u=>['qb:'+u.id,u.login]));for(const row of data.users)row.login=names.get(row.user)||row.user;data.selected_login=names.get(user)||user;
  res.set('Cache-Control','no-store').json(data);
 }catch(e){next(e);}});
 app.get('/api/owner/services/users',requireAuth,requireOwner,async(req,res,next)=>{try{
  const users=await listUsers();
  for(const u of users)u.access=(await permissions(u)).services;
  res.json({users});
 }catch(e){next(e);}});
 app.get('/api/owner/services/search-logs',requireAuth,requireOwner,async(req,res,next)=>{try{
  const id=req.query.user_id===undefined?null:Number(req.query.user_id);
  if(id!==null&&(!Number.isSafeInteger(id)||id<1))return res.status(400).json({error:'Некорректный аккаунт.'});
  res.set('Cache-Control','no-store').json({items:await require('./search-logs').list(req.auth.user,id,req.query.limit)});
 }catch(e){next(e);}});
 app.put('/api/owner/services/users/:id/search-log-protection',requireAuth,requireOwner,async(req,res,next)=>{try{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Некорректный аккаунт.'});
  const user=await getUserById(id);if(!user)return res.status(404).json({error:'Пользователь не найден.'});
  const result=await require('./search-logs').setProtection(req.auth.user,user,req.body.protected);
  await audit(req.auth.user.id,user.id,'search:logs:'+(result.protected?'protected':'enabled'));res.json(result);
 }catch(e){e.status?res.status(e.status).json({error:e.message}):next(e);}});
 app.put('/api/owner/services/users/:id/:service',requireAuth,requireOwner,async(req,res,next)=>{try{
  await initialize();const id=Number(req.params.id),name=req.params.service;
  if(!Number.isSafeInteger(id)||!['search','vault'].includes(name))return res.status(400).json({error:'Некорректный сервис.'});
  const user=await getUserById(id);if(!user)return res.status(404).json({error:'Пользователь не найден.'});
  if(realOwner(user))return res.status(400).json({error:'Права владельца изменяются только через CLI.'});
  res.json(await setAccess(req.auth.user,user,name,req.body));
 }catch(e){e.status?res.status(e.status).json({error:e.message}):next(e);}});
 app.post('/api/owner/services/users',requireAuth,requireOwner,async(req,res,next)=>{try{
  res.status(201).json(await createAccount(req.auth.user,req.body));
 }catch(e){next(e);}});
 app.post('/api/owner/services/users/:id/invite',requireAuth,requireOwner,async(req,res,next)=>{try{
  const user=await getUserById(Number(req.params.id));if(!user||realOwner(user))return res.status(400).json({error:'Недоступный аккаунт.'});
  res.json(await inviteExisting(req.auth.user,user));
 }catch(e){next(e);}});
 app.post('/api/services/activate',authRateLimiter,async(req,res,next)=>{try{
  await initialize();const token=String(req.body.token||'');if(!/^[a-f0-9]{64}$/.test(token)||!security.isStrongPassword(req.body.password))return res.status(400).json({error:'Проверь ссылку и пароль: минимум 8 символов, латинская буква и цифра.'});
  const found=await get('SELECT * FROM service_invites WHERE hash=? AND used IS NULL AND expires>?',[security.hashOpaqueToken(token),new Date().toISOString()]);
  if(!found)return res.status(400).json({error:'Ссылка истекла или уже использована.'});
  const user=await getUserById(found.user_id);if(!user||user.status!=='active')return res.status(403).json({error:'Аккаунт недоступен.'});
  const pw=await security.hashPassword(req.body.password);
  const claimed=await run('UPDATE service_invites SET used=? WHERE hash=? AND used IS NULL AND expires>?',[new Date().toISOString(),found.hash,new Date().toISOString()]);
  if(claimed.changes!==1)return res.status(409).json({error:'Ссылка уже использована.'});
  await updateUserPassword(user.id,pw.hash,pw.salt);
  const raw=security.generateSessionToken();await createSession({userId:user.id,tokenHash:security.hashSessionToken(raw),ipAddress:req.ip,userAgent:req.headers['user-agent']||'',expiresAt:new Date(Date.now()+SESSION_TTL_MS).toISOString()});
  res.cookie(SESSION_COOKIE_NAME,raw,sessionCookieOptions());res.json({ok:true,login:user.login});
 }catch(e){next(e);}});
 app.get('/service-invite',(req,res)=>res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).sendFile(require('path').join(__dirname,'../public/service-invite.html')));
 app.put('/api/owner/services/search-budget',requireAuth,requireOwner,async(req,res,next)=>{try{res.json(await setGlobalBudget(req.auth.user,req.body.limit));}catch(e){e.status?res.status(e.status).json({error:e.message}):next(e);}});
 require('./service-api').register(app,{requireAuth,internalKey});
 require('./vault-integration').register(app,{permissions,requireAuth,requireOwner,getUserById,audit,internalKey});
}
module.exports={initialize,permissions,limits,realOwner,invite,register,listUsers,setAccess,createAccount,inviteExisting,deleteVault,globalBudget,setGlobalBudget,searchUsage,searchAnalytics,audit,internalKey};
