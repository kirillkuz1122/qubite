const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {APP_BASE_URL}=require('./config');
function validateTarget(value){
 const main=new URL(APP_BASE_URL);
 const allowed=[main.origin,...['SERVICES_SEARCH_BASE_URL','SERVICES_VAULT_BASE_URL','SERVICES_MEMOS_BASE_URL','SERVICES_VIKUNJA_BASE_URL'].map(k=>process.env[k]).filter(Boolean).map(v=>new URL(v).origin)];
 try{const u=new URL(value||'/',main);if(u.username||u.password||!allowed.includes(u.origin)||!['http:','https:'].includes(u.protocol)||/^\/auth(?:\/|$)/.test(u.pathname)||u.pathname==='/services/return')return null;return u.href;}catch{return null;}
}
function register(app,deps){
 app.get('/api/auth/destination',deps.requireAuth,async(q,s,n)=>{try{
  const target=validateTarget(q.query.url);if(!target)return s.status(400).end();
  const main=new URL(APP_BASE_URL),u=new URL(target);
  const paused=u.origin===main.origin&&['/','/index.html'].includes(u.pathname)&&await require('./db').getSystemSettingValue('workspace_enabled',true)===false;
  const p=await require('./services').permissions(q.auth.user);
  s.set('Cache-Control','no-store').json({target,paused,login:p.login,services:Object.entries(p.urls).filter(([name])=>p.services[name]?.enabled).map(([name,url])=>({name,url}))});
 }catch(e){n(e);}});
 app.get('/auth',(q,s)=>{
  const target=validateTarget(q.query.return_to);if(!target)return s.status(400).send('Недопустимый адрес возврата.');
  s.set({'Cache-Control':'no-store','Referrer-Policy':'same-origin'});
  // Reuse the existing forms and their validation/2FA/OAuth handlers, not a second implementation.
  const root=path.join(__dirname,'../..');
  const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'front/js/app.js'))).update(fs.readFileSync(path.join(root,'front/css/styles.css'))).update(fs.readFileSync(path.join(root,'front/auth.css'))).digest('hex').slice(0,12);
  let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  html=html.replace('<title>','<title>Вход · ').replace('</head>',`<link rel="stylesheet" href="/front/auth.css?v=${version}"></head>`);
  html=html.replace(/<body([^>]*)>/,'<body$1 data-auth-surface="true">');
  html=html.replace(/((?:\.\/|\/)front\/[^"?]+\.(?:js|css))(?:\?[^"\s]*)?(?=")/g,'$1?v='+version);
  s.type('html').send(html);
 });
 app.get('/internal/services/browser-access',deps.internalKey,async(q,s,n)=>{try{
  if(!['memos','vikunja'].includes(q.query.service))return s.status(400).end();
  const target=validateTarget(process.env['SERVICES_'+q.query.service.toUpperCase()+'_BASE_URL']);
  if(!q.auth?.user)return s.redirect(APP_BASE_URL+'/auth?return_to='+encodeURIComponent(target));
  const p=await require('./knowledge-services').access(q.auth.user,q.query.service);
  if(!p.enabled)return s.status(403).send('Доступ к сервису не выдан владельцем Qubite.');
  if(process.env.KNOWLEDGE_MANAGEMENT_SOCKET){const info=await require('./knowledge-enrollment').manage('info',q.auth.user,q.query.service);if(!info.ready)return s.redirect(APP_BASE_URL+'/service-enroll?service='+q.query.service);}
  return s.status(200).end();
 }catch(e){n(e);}});
}
module.exports={validateTarget,register};
