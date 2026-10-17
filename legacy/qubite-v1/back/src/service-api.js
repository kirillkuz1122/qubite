// Scoped search API keys; plaintext is returned once and is never persisted.
const crypto=require('crypto');
const sqlite3=require('sqlite3');
const {DATABASE_PATH}=require('./config');
const native=require('./db');
const services=require('./services');
const db=new sqlite3.Database(DATABASE_PATH);db.configure('busyTimeout',10000);
const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this);}));
const get=(sql,args=[])=>new Promise((r,j)=>db.get(sql,args,(e,x)=>e?j(e):r(x)));
const all=(sql,args=[])=>new Promise((r,j)=>db.all(sql,args,(e,x)=>e?j(e):r(x)));
let ready,queue=Promise.resolve();
function initialize(){return ready||=(new Promise((r,j)=>db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS search_api_keys(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,hash TEXT UNIQUE NOT NULL,prefix TEXT NOT NULL,name TEXT NOT NULL,scopes TEXT NOT NULL,daily_requests INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revoked_at TEXT,last_used TEXT);
 CREATE INDEX IF NOT EXISTS search_api_key_user ON search_api_keys(user_id,revoked_at);
 CREATE TABLE IF NOT EXISTS search_api_attempts(key_id TEXT NOT NULL REFERENCES search_api_keys(id) ON DELETE CASCADE,day TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(key_id,day));
 `,e=>e?j(e):r())));}
function hash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function error(message,status=400){return Object.assign(new Error(message),{status});}
function serialized(fn){const p=queue.then(fn);queue=p.catch(()=>{});return p;}
async function list(user){await initialize();return (await all('SELECT id,prefix,name,scopes,daily_requests,created_at,last_used,revoked_at FROM search_api_keys WHERE user_id=? ORDER BY created_at DESC',[user.id])).map(r=>({...r,scopes:JSON.parse(r.scopes)}));}
async function create(user,input={}){
 await initialize();const p=await services.permissions(user);if(!p.services.search.enabled)throw error('Нет доступа к поиску.',403);
 const scopes=input.scopes===undefined?['search','fetch']:input.scopes;
 if(!Array.isArray(scopes)||!scopes.length||scopes.length>3||new Set(scopes).size!==scopes.length||scopes.some(x=>!['search','fetch','history'].includes(x)))throw error('Некорректные права ключа.');
 if(scopes.includes('history')&&!p.services.search.history)throw error('Нет разрешения на историю.',403);
 const cap=input.daily_requests===undefined?100:input.daily_requests;
 if(cap!==null&&(!Number.isInteger(cap)||cap<0||cap>10000))throw error('Лимит ключа: 0–10000 или без ограничения.');
 const name=String(input.name||'Агент').trim();if(!name||name.length>80)throw error('Название: 1–80 символов.');
 const token='qbs_'+crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),now=new Date().toISOString();
 await serialized(async()=>{if((await get('SELECT COUNT(*) n FROM search_api_keys WHERE user_id=? AND revoked_at IS NULL',[user.id])).n>=20)throw error('Не более 20 активных ключей.');await run('INSERT INTO search_api_keys(id,user_id,hash,prefix,name,scopes,daily_requests,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,user.id,hash(token),token.slice(0,12),name,JSON.stringify(scopes),cap,now,now]);});
 await services.audit(user.id,user.id,'api:key:create');
 return {id,token,name,scopes,daily_requests:cap,base_url:process.env.SERVICES_SEARCH_BASE_URL||'https://search.qubiteapp.online'};
}
async function revoke(user,id){await initialize();await run('UPDATE search_api_keys SET revoked_at=?,updated_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL',[new Date().toISOString(),new Date().toISOString(),id,user.id]);await services.audit(user.id,user.id,'api:key:revoke');return {ok:true};}
async function authorize(token,scope,consume=true){
 await initialize();if(!/^qbs_[A-Za-z0-9_-]{43}$/.test(token||'')||!['search','fetch','history'].includes(scope))throw error('Недействительный API-ключ.',401);
 return serialized(async()=>{
 const key=await get('SELECT * FROM search_api_keys WHERE hash=? AND revoked_at IS NULL',[hash(token)]);if(!key)throw error('Недействительный API-ключ.',401);
 const user=await native.getUserById(key.user_id);if(!user||user.status!=='active')throw error('Аккаунт недоступен.',403);
 const p=await services.permissions(user),scopes=JSON.parse(key.scopes);
 if(!p.services.search.enabled||!scopes.includes(scope)||scope==='history'&&!p.services.search.history)throw error('Недостаточно прав.',403);
 if(consume){
  const day=new Date().toISOString().slice(0,10);await run('BEGIN IMMEDIATE');
  try{const used=(await get('SELECT count FROM search_api_attempts WHERE key_id=? AND day=?',[key.id,day]))?.count||0;
   if(key.daily_requests!==null&&used>=key.daily_requests)throw error('Дневной лимит API-ключа исчерпан.',429);
   await run('INSERT INTO search_api_attempts VALUES (?,?,1) ON CONFLICT(key_id,day) DO UPDATE SET count=count+1',[key.id,day]);await run('UPDATE search_api_keys SET last_used=? WHERE id=?',[new Date().toISOString(),key.id]);await run('DELETE FROM search_api_attempts WHERE day<?',[new Date(Date.now()-7*86400000).toISOString().slice(0,10)]);await run('COMMIT');
  }catch(e){await run('ROLLBACK');throw e;}
 }
 return {...p,key_id:key.id,key_scopes:scopes};
 });
}
function register(app,{requireAuth,internalKey}){
 const target=async req=>{const id=req.query.user_id||req.body?.user_id;if(!id||Number(id)===req.auth.user.id)return req.auth.user;if(!services.realOwner(req.auth.user))throw error('Чужие ключи недоступны.',403);const u=await native.getUserById(Number(id));if(!u)throw error('Пользователь не найден.',404);return u;};
 const handle=fn=>async(q,s,n)=>{try{s.set('Cache-Control','no-store').json(await fn(q));}catch(e){e.status?s.status(e.status).json({error:e.message}):n(e);}};
 app.get('/api/services/search-keys',requireAuth,handle(async q=>({keys:await list(await target(q))})));
 app.post('/api/services/search-keys',requireAuth,handle(async q=>create(await target(q),q.body)));
 app.delete('/api/services/search-keys/:id',requireAuth,handle(async q=>revoke(await target(q),q.params.id)));
 app.post('/internal/services/api-key',internalKey,handle(async q=>authorize(q.body.token,q.body.scope,q.body.consume!==false)));
}
module.exports={initialize,list,create,revoke,authorize,register};
