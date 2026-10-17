// Account-owned subscription links. Plain bearer tokens are encrypted at rest.
const sqlite3=require('sqlite3');
const crypto=require('crypto');
const {DATABASE_PATH,APP_BASE_URL}=require('../config');
const native=require('../db');
const db=new sqlite3.Database(DATABASE_PATH);db.configure('busyTimeout',10000);
const run=(sql,a=[])=>new Promise((resolve,reject)=>db.run(sql,a,function(e){e?reject(e):resolve(this);}));
const get=(sql,a=[])=>new Promise((resolve,reject)=>db.get(sql,a,(e,r)=>e?reject(e):resolve(r)));
let ready;
let writes=Promise.resolve();
function serialize(fn){const result=writes.then(fn);writes=result.catch(()=>{});return result;}
function init(){return ready ||= new Promise((resolve,reject)=>db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS proxy_subscription_secrets(uid TEXT PRIMARY KEY REFERENCES proxy_subscriptions(uid) ON DELETE CASCADE,ciphertext TEXT NOT NULL);',e=>e?reject(e):resolve()));}
async function save(uid,token,encrypt){return serialize(async()=>{await init();const ciphertext=encrypt(token);if(!ciphertext)throw Object.assign(new Error('Не настроен ключ шифрования VPN.'),{status:503});await run('INSERT INTO proxy_subscription_secrets VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET ciphertext=excluded.ciphertext',[uid,ciphertext]);});}
function settings(body={}){
 const n=(key,def,max)=>{const v=body[key]===undefined?def:Number(body[key]);if(!Number.isFinite(v)||v<1||v>max||!Number.isInteger(v))throw Object.assign(new Error('Некорректное значение '+key),{status:400});return v;};
 const days=n('days',30,3650),maxConnections=n('maxConnections',3,100),speed=body.speedLimitMbps===''||body.speedLimitMbps==null?null:n('speedLimitMbps',100,10000);
 return {expiresAt:new Date(Date.now()+days*86400000).toISOString(),maxConnections,speedLimitMbps:speed,isVip:body.isVip===true,noLogs:body.noLogs!==false};
}
function register(app,deps){
 const {requireAuth,requireOwner,hashOpaqueToken,encrypt,decrypt,createAuditLog}=deps;
 const enabled=async(req,res,next)=>{try{if(!await require('./availability').available())return res.status(503).json({error:'VPN не работает: нет доступной серверной ноды.'});next();}catch(e){next(e);}};
 const route=f=>async(req,res,next)=>{try{await init();await f(req,res);}catch(e){e.status?res.status(e.status).json({error:e.message}):next(e);}};
 const write=f=>route((req,res)=>serialize(()=>f(req,res)));
 app.get('/api/proxy/personal',requireAuth,route(async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!await require('./availability').available())return res.json({available:false,subscription:null,devices:[]});
  const sub=await get("SELECT * FROM proxy_subscriptions WHERE user_id=? AND type='app' ORDER BY created_at DESC LIMIT 1",[req.auth.user.id]);
  const devices=await native.listProxyDevicesForUser(req.auth.user.id);
  if(!sub)return res.json({subscription:null,devices:[]});
  const secret=await get('SELECT ciphertext FROM proxy_subscription_secrets WHERE uid=?',[sub.uid]);
  const usable=sub.status==='active'&&(!sub.expires_at||new Date(sub.expires_at)>new Date());
  const token=usable&&secret?decrypt(secret.ciphertext):'';
  res.json({available:true,subscription:{uid:sub.uid,label:sub.label,status:sub.status,usable,expiresAt:sub.expires_at,maxConnections:sub.max_connections,speedLimitMbps:sub.speed_limit_mbps,isVip:Boolean(sub.is_vip),url:token?APP_BASE_URL+'/api/proxy/subscription/'+encodeURIComponent(token):null},devices:devices.map(d=>({uid:d.uid,name:d.device_name,platform:d.platform,status:d.status,lastSeen:d.last_seen_at}))});
 }));
 app.post('/api/proxy/personal/rotate',requireAuth,enabled,write(async(req,res)=>{
  const sub=await native.getActiveProxySubscriptionForUser(req.auth.user.id,'app');
  if(!sub)return res.status(403).json({error:'Нет действующей VPN-подписки.'});
  const token='qbs_'+crypto.randomBytes(32).toString('hex'),ciphertext=encrypt(token);
  if(!ciphertext)return res.status(503).json({error:'Не настроен ключ шифрования VPN.'});
  await run('BEGIN IMMEDIATE');try{
   const changed=await run("UPDATE proxy_subscriptions SET token_hash=?,updated_at=? WHERE uid=? AND user_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?)",[hashOpaqueToken(token),new Date().toISOString(),sub.uid,req.auth.user.id,new Date().toISOString()]);
   if(!changed.changes)throw Object.assign(new Error('Подписка уже отключена.'),{status:403});
   await run('INSERT INTO proxy_subscription_secrets VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET ciphertext=excluded.ciphertext',[sub.uid,ciphertext]);await run('COMMIT');
  }catch(e){await run('ROLLBACK');throw e;}
  await native.revokeProxySubscriptionSessions(sub.uid);
  await createAuditLog({actorUserId:req.auth.user.id,action:'proxy.subscription.rotate',entityType:'proxy_subscription',entityId:sub.uid,summary:'Обновлена личная ссылка VPN'});
  res.set('Cache-Control','no-store').json({url:APP_BASE_URL+'/api/proxy/subscription/'+encodeURIComponent(token)});
 }));
 app.post('/api/owner/services/users/:id/vpn',requireOwner,enabled,write(async(req,res)=>{
  const user=await native.getUserById(Number(req.params.id));if(!user||user.status!=='active')return res.status(400).json({error:'Нужен активный аккаунт.'});
  if(await native.getActiveProxySubscriptionForUser(user.id,'app'))return res.status(409).json({error:'VPN уже выдан. Открой настройки существующей подписки.'});
  const options=settings(req.body),token='qbs_'+crypto.randomBytes(32).toString('hex');
  if(!encrypt(token))return res.status(503).json({error:'Не настроен ключ шифрования VPN.'});
  // Serialize grants with a database lock to prevent two subscriptions on double-click.
  await run('BEGIN IMMEDIATE');let sub;
  try{
   const existing=await get("SELECT uid FROM proxy_subscriptions WHERE user_id=? AND type='app' AND status='active' AND (expires_at IS NULL OR expires_at>?)",[user.id,new Date().toISOString()]);
   if(existing)throw Object.assign(new Error('VPN уже выдан.'),{status:409});
   const uid='SUB-'+crypto.randomBytes(12).toString('hex'),now=new Date().toISOString();
   await run("INSERT INTO proxy_subscriptions(uid,user_id,token_hash,label,status,no_logs,is_vip,speed_limit_mbps,max_connections,source,type,created_at,updated_at,expires_at) VALUES (?,?,?,?,'active',?,?,?,?,?,'app',?,?,?)",[uid,user.id,hashOpaqueToken(token),'vpn-'+user.login,Number(options.noLogs),Number(options.isVip),options.speedLimitMbps,options.maxConnections,'site_user',now,now,options.expiresAt]);
   await run('INSERT INTO proxy_subscription_secrets VALUES (?,?)',[uid,encrypt(token)]);await run('COMMIT');sub=await native.getProxySubscriptionByUid(uid);
  }catch(e){await run('ROLLBACK');throw e;}
  await createAuditLog({actorUserId:req.auth.user.id,action:'proxy.subscription.create',entityType:'proxy_subscription',entityId:sub.uid,summary:'VPN выдан @'+user.login});
  res.status(201).json({uid:sub.uid});
 }));
}
module.exports={register,save,settings};
