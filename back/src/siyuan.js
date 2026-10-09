// A personal workspace: only the real Qubite owner can enter it.
const fs=require('fs');
const {APP_BASE_URL}=require('./config');
function url(){return process.env.SERVICES_SIYUAN_BASE_URL||'https://siyuan.qubiteapp.online';}
function target(value='/'){
 if(typeof value!=='string'||value.length>8192||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20\x7f]/.test(value))return null;
 try{const base=new URL(url()),u=new URL(value,base);return u.origin===base.origin&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
function owner(user){return (user?.actual_role||user?.role)==='owner';}
function requestAllowed(q){
 const method=q.headers['x-forwarded-method']||q.method;
 const origin=q.headers.origin;
 if(origin&&origin!==new URL(url()).origin)return false;
 const websocket=(q.headers['x-forwarded-uri']||'').split('?')[0]==='/ws';
 return ['GET','HEAD'].includes(method)&&!q.headers.upgrade&&!websocket||origin===new URL(url()).origin;
}
function register(app,d){
 app.get('/internal/services/siyuan-access',d.internalKey,(q,s)=>{
  s.set('Cache-Control','no-store');
  const uri=q.headers['x-forwarded-uri']||'/',to=target(uri);if(!to)return s.status(400).end();
  if(!q.auth?.user)return uri.startsWith('/api/')||q.headers.upgrade?s.status(401).end():s.redirect(APP_BASE_URL+'/auth?return_to='+encodeURIComponent(to));
  if(!owner(q.auth.user))return s.status(403).send('Это личное хранилище владельца Qubite.');
  if(!requestAllowed(q))return s.status(403).end();
  // Native HTTP and websocket authentication uses its signed host-only cookie.
  if(uri.split('?')[0]==='/check-auth'||!/(?:^|;\s*)siyuan=/.test(q.headers.cookie||'')){
   if(uri.startsWith('/api/')||q.headers.upgrade)return s.status(401).end();
   return s.redirect(url()+'/_qubite/session?return_to='+encodeURIComponent(uri.split('?')[0]==='/check-auth'?'/':uri));
  }
  return s.status(200).end();
 });
 app.get('/internal/services/siyuan-session',d.internalKey,async(q,s)=>{
  s.set('Cache-Control','no-store');
  const to=target(q.query.return_to||'/');if(!to||new URL(to).pathname.startsWith('/_qubite/')||new URL(to).pathname==='/check-auth')return s.status(400).end();
  if(!q.auth?.user)return s.redirect(APP_BASE_URL+'/auth?return_to='+encodeURIComponent(to));
  if(!owner(q.auth.user)||!requestAllowed(q))return s.status(403).end();
  try{
   const secret=JSON.parse(fs.readFileSync(process.env.SIYUAN_PRIVATE_FILE,'utf8'));
   const r=await fetch('http://127.0.0.1:6806/api/system/loginAuth',{method:'POST',headers:{'Content-Type':'application/json','Host':new URL(url()).host,'Origin':new URL(url()).origin},body:JSON.stringify({authCode:secret.auth_code,rememberMe:true}),signal:AbortSignal.timeout(10000)});
   const data=await r.json(),cookies=r.headers.getSetCookie();
   if(!r.ok||data.code!==0||!cookies.length||cookies.some(c=>!c.startsWith('siyuan=')))throw Error();
   s.set('Set-Cookie',cookies.map(c=>c.replace(/;\s*Domain=[^;]*/ig,'').replace(/;\s*Secure/ig,'')+'; Secure'));
   s.redirect(to);
  }catch{s.status(503).send('SiYuan выключен или вход временно недоступен. Включи сервис через /power.');}
 });
}
module.exports={url,target,owner,requestAllowed,register};
