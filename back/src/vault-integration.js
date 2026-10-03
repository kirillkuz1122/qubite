const https=require('https');
const http=require('http');
const fs=require('fs');
function manage(action,login,extra={}){
 return new Promise((resolve,reject)=>{
  if(!process.env.VAULT_MANAGEMENT_SOCKET)return reject(Object.assign(new Error('Управление AliasVault не подключено.'),{status:503}));
  const body=JSON.stringify({action,login,...extra});
  const req=http.request({socketPath:process.env.VAULT_MANAGEMENT_SOCKET,path:'/manage',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const d=JSON.parse(data);res.statusCode===200?resolve(d):reject(Object.assign(new Error(d.error||'AliasVault недоступен'),{status:503}));}catch(e){reject(e);}});});
  req.setTimeout(20000,()=>req.destroy(new Error('AliasVault management timeout')));req.on('error',reject);req.end(body);
 });
}
function nativePost(path,body){
 return new Promise((resolve,reject)=>{
  if(!process.env.VAULT_ORIGIN_CA)return reject(new Error('AliasVault TLS CA is required'));
  const data=JSON.stringify(body);
  const req=https.request({hostname:'127.0.0.1',port:Number(process.env.VAULT_ORIGIN_PORT||9082),path,method:'POST',ca:fs.readFileSync(process.env.VAULT_ORIGIN_CA),headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'X-Forwarded-Proto':'https'}},res=>{
   let data='';res.on('data',c=>{data+=c;if(data.length>65536)req.destroy(new Error('AliasVault response too large'));});res.on('end',()=>resolve({status:res.statusCode,body:data,cookies:res.headers['set-cookie']}));
  });req.setTimeout(20000,()=>req.destroy(new Error('AliasVault timeout')));req.on('error',reject);req.end(data);
 });
}
function register(app,d){
 app.get('/api/services/vault/enroll',d.requireAuth,async(req,res,next)=>{try{
  const p=await d.permissions(req.auth.user);if(!p.services.vault.enabled)return res.status(403).json({error:'Владелец ещё не выдал доступ к хранилищу.'});
  res.json({login:p.login,url:(process.env.SERVICES_VAULT_BASE_URL||'https://vault.qubiteapp.online')+'/user/register',instructions:'В AliasVault укажи этот же логин и придумай отдельный мастер-пароль. Он не передаётся в Qubite.'});
 }catch(e){next(e);}});
 app.post('/internal/services/vault/:action',d.internalKey,d.requireAuth,async(req,res,next)=>{try{
  const action=req.params.action;if(!['register','validate-username'].includes(action))return res.status(404).end();
  const p=await d.permissions(req.auth.user);
  const username=String(req.body.username??req.body.Username??'').trim().toLowerCase();
  if(!p.services.vault.enabled||username!==p.login.toLowerCase())return res.status(403).json({error:'Создать хранилище можно только для своего логина Qubite после выдачи доступа.'});
  const result=await nativePost('/api/v1/Auth/'+action,req.body);
  if(result.cookies)res.setHeader('Set-Cookie',result.cookies);
  res.status(result.status).type('application/json').send(result.body);
  if(action==='register'&&result.status<300)await d.audit(req.auth.user.id,req.auth.user.id,'vault:created');
 }catch(e){next(e);}});
 app.delete('/api/owner/services/users/:id/vault',d.requireAuth,d.requireOwner,async(req,res,next)=>{try{
  const u=await d.getUserById(Number(req.params.id));if(!u||u.role==='owner')return res.status(400).json({error:'Хранилище владельца здесь удалить нельзя.'});
  if(req.body.confirm!==u.login)return res.status(400).json({error:'Для подтверждения укажи логин пользователя.'});
  res.json(await require('./services').deleteVault(req.auth.user,u,req.body.confirm));
 }catch(e){next(e);}});
}
module.exports={manage,register};
