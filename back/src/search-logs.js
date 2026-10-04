// Query text is kept separately from technical audit: protection can erase it.
const sqlite3=require('sqlite3');
const {DATABASE_PATH}=require('./config');
const db=new sqlite3.Database(DATABASE_PATH);db.configure('busyTimeout',10000);
const run=(q,a=[])=>new Promise((r,j)=>db.run(q,a,function(e){e?j(e):r(this);}));
const all=(q,a=[])=>new Promise((r,j)=>db.all(q,a,(e,v)=>e?j(e):r(v)));
let ready;
function initialize(){
 if(!ready)ready=new Promise((r,j)=>db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS search_log_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,protected INTEGER NOT NULL CHECK(protected IN (0,1)),created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS search_query_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,operation TEXT NOT NULL,query TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS search_query_logs_user_time ON search_query_logs(user_id,created);
 CREATE TRIGGER IF NOT EXISTS protect_search_logs_insert AFTER INSERT ON search_log_preferences WHEN NEW.protected=1 BEGIN DELETE FROM search_query_logs WHERE user_id=NEW.user_id; END;
 CREATE TRIGGER IF NOT EXISTS protect_search_logs_update AFTER UPDATE OF protected ON search_log_preferences WHEN NEW.protected=1 BEGIN DELETE FROM search_query_logs WHERE user_id=NEW.user_id; END;
 `,e=>e?j(e):r())).then(async()=>{
  await prune();const timer=setInterval(()=>prune().catch(()=>console.warn('[search logs] Cleanup unavailable')),3600000);timer.unref();
 });return ready;
}
async function prune(){await run('DELETE FROM search_query_logs WHERE created < ?',[new Date(Date.now()-30*86400000).toISOString()]);}
function owner(u){return (u?.actual_role||u?.role)==='owner';}
async function protectedFor(user){
 await initialize();const rows=await all('SELECT protected FROM search_log_preferences WHERE user_id=?',[user.id]);
 return rows.length?Boolean(rows[0].protected):owner(user);
}
async function setProtection(actor,user,value){
 if(!owner(actor))throw Object.assign(new Error('Только владелец управляет журналом поиска.'),{status:403});
 if(!user||typeof value!=='boolean')throw Object.assign(new Error('Нужен аккаунт и логическое значение protected.'),{status:400});
 await initialize();const now=new Date().toISOString();
 // Single statement + trigger: racing events cannot insert a query after protection.
 await run('INSERT INTO search_log_preferences VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET protected=excluded.protected,updated=excluded.updated',[user.id,Number(value),now,now]);
 return {protected:value};
}
async function record(userId,operation,query){
 if(!['web.search','search.summary','search.sources'].includes(operation)||typeof query!=='string'||!query.trim())return null;
 await initialize();const now=new Date().toISOString();
 const r=await run(`INSERT INTO search_query_logs(user_id,operation,query,created)
 SELECT u.id,?,?,? FROM users u LEFT JOIN search_log_preferences p ON p.user_id=u.id
 WHERE u.id=? AND u.status='active' AND COALESCE(p.protected,u.role='owner')=0`,[operation,query.slice(0,700),now,userId]);
 if(!r.changes)return null;
 await run("DELETE FROM search_query_logs WHERE created < ? OR (user_id=? AND id NOT IN (SELECT id FROM search_query_logs WHERE user_id=? ORDER BY id DESC LIMIT 1000))",[new Date(Date.now()-30*86400000).toISOString(),userId,userId]);
 return r.lastID;
}
async function list(actor,userId=null,limit=100){
 if(!owner(actor))throw Object.assign(new Error('Только владелец видит запросы поиска.'),{status:403});
 await initialize();
 return all(`SELECT l.id,l.user_id,l.operation,l.query,l.created,u.login FROM search_query_logs l
 JOIN users u ON u.id=l.user_id LEFT JOIN search_log_preferences p ON p.user_id=l.user_id
 WHERE COALESCE(p.protected,u.role='owner')=0 AND l.created>=? ${userId===null?'':'AND l.user_id=?'}
 ORDER BY l.id DESC LIMIT ?`,[new Date(Date.now()-30*86400000).toISOString(),...(userId===null?[]:[userId]),Math.max(1,Math.min(200,Math.trunc(Number(limit))||100))]);
}
async function enrich(items,actor){
 if(!owner(actor))return items;
 const references=items.map(i=>{try{return JSON.parse(i.payload_json||'{}').query_log_id;}catch{return null;}}).filter(Number.isSafeInteger);
 if(!references.length)return items;
 await initialize();const rows=await all(`SELECT l.id,l.user_id,l.query FROM search_query_logs l JOIN users u ON u.id=l.user_id
 LEFT JOIN search_log_preferences p ON p.user_id=l.user_id WHERE l.id IN (${references.map(()=>'?').join(',')})
 AND COALESCE(p.protected,u.role='owner')=0 AND l.created>=?`,[...references,new Date(Date.now()-30*86400000).toISOString()]);
 const queries=new Map(rows.map(r=>[r.id,r]));
 return items.map(i=>{let id;try{id=JSON.parse(i.payload_json||'{}').query_log_id;}catch{}const q=queries.get(id);
  return q&&q.user_id===i.actor_user_id?{...i,summary:i.summary+' · @'+i.actor_login+' · Запрос: '+q.query}:i;});
}
module.exports={initialize,protectedFor,setProtection,record,list,enrich,prune};
