// Native API clients use their own token, still subject to the Qubite grant.
const db=require('./db'),grants=require('./knowledge-services'),enrollment=require('./knowledge-enrollment');
const origins={memos:'http://127.0.0.1:5230',vikunja:'http://127.0.0.1:3456'};
function nativeCookies(service,headers){
 const values=headers.getSetCookie();const metadata=headers.get('grpc-metadata-set-cookie');
 // Memos' REST grpc-gateway returns its single refresh cookie as metadata.
 if(service==='memos'&&!values.length&&metadata?.startsWith('memos_refresh='))values.push(metadata);
 const secure=new URL(grants.urls()[service]).protocol==='https:';
 return values.map(c=>secure&&!/;\s*Secure(?:;|$)/i.test(c)?c+'; Secure':c);
}
async function native(service,path,options={}){
 const r=await fetch(origins[service]+path,{...options,signal:AbortSignal.timeout(12000),redirect:'error'});
 const text=await r.text();if(text.length>65536)throw Error('Oversized native authentication response');
 return {status:r.status,data:JSON.parse(text||'{}'),cookies:nativeCookies(service,r.headers)};
}
async function account(service,login,identity){
 const binding=await enrollment.lookup(service,login);if(!binding.ready)return false;
 if(identity!==undefined&&String(binding.native_id)!==String(identity))return false;
 const user=await db.getUserById(binding.user_id);return !!(user?.status==='active'&&(await grants.access(user,service)).enabled);
}
function identity(service,data){return service==='memos'?{login:data.user?.name?.replace(/^users\//,''),id:data.user?.name}:{login:data.username,id:data.id};}
function denied(s,status=401){return s.status(status).set({'Cache-Control':'no-store','WWW-Authenticate':'Bearer'}).json({error:status===503?'Сервис временно недоступен.':'Нужны нативный вход и разрешение Qubite. Сначала создай аккаунт через Qubite.'});}
function register(app,d,api=native){
 const valid=(q,s,n)=>{if(!grants.NAMES.includes(q.query.service))return s.status(400).end();if(q.headers.origin&&q.headers.origin!==new URL(grants.urls()[q.query.service]).origin)return denied(s,403);n();};
 app.get('/internal/services/knowledge-api',d.internalKey,valid,async(q,s)=>{try{
  const service=q.query.service;
  const authorization=q.headers.authorization;
  if(!authorization&&q.auth?.user&&(await grants.access(q.auth.user,service)).enabled){const info=await enrollment.manage('info',q.auth.user,service);if(info.ready)return s.status(200).end();}
  if(!/^Bearer [^\s]{10,4096}$/.test(authorization||''))return denied(s);
  const r=await api(service,service==='memos'?'/api/v1/auth/me':'/api/v1/user',{headers:{Authorization:authorization}});
  if(r.status!==200)return denied(s);const u=identity(service,r.data);
  if(!u.login||!await account(service,u.login,u.id))return denied(s,403);
  s.status(200).end();
 }catch{denied(s,503);}});
 app.post('/internal/services/knowledge-login',d.internalKey,d.authRateLimiter,valid,async(q,s)=>{try{
  const service=q.query.service,body=q.body;let login,password;
  if(service==='memos'){
   if(!body||Object.keys(body).some(k=>k!=='passwordCredentials')||!body.passwordCredentials||Object.keys(body.passwordCredentials).some(k=>!['username','password'].includes(k)))return denied(s);
   ({username:login,password}=body.passwordCredentials);
  }else{
   if(!body||Object.keys(body).some(k=>!['username','password','totpPasscode'].includes(k)))return denied(s);
   ({username:login,password}=body);
  }
  if(typeof login!=='string'||typeof password!=='string'||password.length>256||!await account(service,login))return denied(s);
  const r=await api(service,service==='memos'?'/api/v1/auth/signin':'/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify(body)});
  if(r.status!==200)return denied(s);if(r.cookies.length)s.setHeader('Set-Cookie',r.cookies);s.set('Cache-Control','no-store').json(r.data);
 }catch{denied(s,503);}});
 app.post('/internal/services/knowledge-refresh',d.internalKey,valid,async(q,s)=>{try{
  const service=q.query.service,path=service==='memos'?'/api/v1/auth/refresh':'/api/v1/user/token/refresh';
  // Validate the resulting identity before returning any refreshed token/cookie.
  const r=await api(service,path,{method:'POST',headers:{Cookie:q.headers.cookie||'','Grpc-Metadata-Cookie':q.headers.cookie||'','Content-Type':'application/json','X-Forwarded-Proto':'https'},body:'{}'});
  const token=service==='memos'?r.data.accessToken:r.data.token;
  if(r.status!==200||typeof token!=='string')return denied(s);
  const me=await api(service,service==='memos'?'/api/v1/auth/me':'/api/v1/user',{headers:{Authorization:'Bearer '+token}});const u=identity(service,me.data);
  if(me.status!==200||!u.login||!await account(service,u.login,u.id))return denied(s,403);
  if(r.cookies.length)s.setHeader('Set-Cookie',r.cookies);s.set('Cache-Control','no-store').json(r.data);
 }catch{denied(s,503);}});
 app.post('/internal/services/knowledge-oauth-token',d.internalKey,d.authRateLimiter,valid,async(q,s)=>{try{
  if(q.query.service!=='vikunja')return denied(s);const b=q.body;
  const fields=b?.grant_type==='authorization_code'?['grant_type','code','client_id','redirect_uri','code_verifier']:b?.grant_type==='refresh_token'?['grant_type','refresh_token']:null;
  if(!fields||!b||Array.isArray(b)||Object.keys(b).some(k=>!fields.includes(k))||fields.some(k=>typeof b[k]!=='string'||!b[k]||b[k].length>4096))return denied(s);
  // PKCE / single-use code or rotating refresh token is validated by Vikunja.
  const r=await api('vikunja','/api/v1/oauth/token',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify(b)});
  if(r.status!==200||typeof r.data.access_token!=='string')return denied(s);
  const me=await api('vikunja','/api/v1/user',{headers:{Authorization:'Bearer '+r.data.access_token}});const u=identity('vikunja',me.data);
  if(me.status!==200||!u.login||!await account('vikunja',u.login,u.id))return denied(s,403);
  s.set('Cache-Control','no-store').json(r.data);
 }catch{denied(s,503);}});
}
module.exports={register,account,identity,nativeCookies};
