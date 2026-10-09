const http=require('http'),path=require('path');
const {APP_BASE_URL}=require('./config');
const grants=require('./knowledge-services');
function rpc(payload){
 return new Promise((resolve,reject)=>{
  const socketPath=process.env.KNOWLEDGE_MANAGEMENT_SOCKET;if(!socketPath)return reject(Object.assign(Error('Создание аккаунтов ещё не настроено.'),{status:503}));
  const raw=JSON.stringify(payload);
  const q=http.request({socketPath,path:'/manage',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}},s=>{let text='';s.on('data',c=>{text+=c;if(text.length>8192)q.destroy();});s.on('end',()=>{try{const r=JSON.parse(text);s.statusCode===200?resolve(r):reject(Object.assign(Error(r.error||'Регистрация недоступна.'),{status:s.statusCode}));}catch{reject(Object.assign(Error('Менеджер регистрации недоступен.'),{status:503}));}});});
  q.setTimeout(45000,()=>q.destroy());q.on('error',()=>reject(Object.assign(Error('Не удалось подтвердить регистрацию. Проверь состояние перед повтором.'),{status:503})));q.end(raw);
 });
}
function manage(action,user,service,password){return rpc({action,service,user_id:user.id,login:user.login.toLowerCase(),email:user.email,...(action==='enroll'?{password}:{})});}
function lookup(service,login){return rpc({action:'lookup',service,login});}
async function permitted(user,name){if(!grants.NAMES.includes(name))throw Object.assign(Error('Неизвестный сервис.'),{status:400});if(!(await grants.access(user,name)).enabled)throw Object.assign(Error('Владелец ещё не выдал доступ к сервису.'),{status:403});}
function failure(e,s,n){if([400,403,409,503].includes(e.status))return s.status(e.status).set('Cache-Control','no-store').json({error:e.message});n(e);}
function register(app,d){
 app.get('/service-enroll',(q,s)=>{
  if(!grants.NAMES.includes(q.query.service))return s.status(400).end();
  if(!q.auth?.user)return s.redirect(APP_BASE_URL+'/auth?return_to='+encodeURIComponent(APP_BASE_URL+'/service-enroll?service='+q.query.service));
  s.set('Cache-Control','no-store').sendFile(path.join(__dirname,'../public/knowledge-enroll.html'));
 });
 app.get('/knowledge-enroll.js',(q,s)=>s.set('Cache-Control','no-store').type('application/javascript').sendFile(path.join(__dirname,'../public/knowledge-enroll.js')));
 app.get('/api/services/knowledge/:name/enroll',d.requireAuth,async(q,s,n)=>{try{await permitted(q.auth.user,q.params.name);s.set('Cache-Control','no-store').json({...await manage('info',q.auth.user,q.params.name),url:grants.urls()[q.params.name]});}catch(e){failure(e,s,n);}});
 app.post('/api/services/knowledge/:name/enroll',d.requireAuth,d.authRateLimiter,async(q,s,n)=>{try{
  await permitted(q.auth.user,q.params.name);if((!q.body||Array.isArray(q.body)||typeof q.body!=='object')||Object.keys(q.body).some(k=>k!=='password')||typeof q.body.password!=='string'||!require('./security').isStrongPassword(q.body.password)||Buffer.byteLength(q.body.password,'utf8')>72)return s.status(400).json({error:'Пароль: 8–72 байта UTF-8, латинская буква и цифра, без пробелов.'});
  const result=await manage('enroll',q.auth.user,q.params.name,q.body.password);await d.audit(q.auth.user.id,q.auth.user.id,q.params.name+':enrolled');s.set('Cache-Control','no-store').json({...result,url:grants.urls()[q.params.name]});
 }catch(e){failure(e,s,n);}});
}
module.exports={manage,lookup,permitted,register};
