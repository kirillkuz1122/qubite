// Outer Qubite access does not grant access to somebody else's native notes/tasks.
const native=require('./db');
const NAMES=['memos','vikunja'];
const owner=u=>(u?.actual_role||u?.role)==='owner';
async function access(u,name){
 if(!NAMES.includes(name))throw new Error('Неизвестный сервис.');
 return {enabled:owner(u)||await native.getSystemSettingValue('knowledge_'+name+'_'+u.id,false)===true};
}
async function set(actor,u,name,enabled){
 if(!owner(actor)||!u||owner(u)||!NAMES.includes(name)||typeof enabled!=='boolean')throw new Error('Изменение доступа запрещено.');
 await native.updateSystemSetting('knowledge_'+name+'_'+u.id,enabled);
 return {ok:true};
}
function urls(){return {memos:process.env.SERVICES_MEMOS_BASE_URL||'https://memos.qubiteapp.online',vikunja:process.env.SERVICES_VIKUNJA_BASE_URL||'https://vikunja.qubiteapp.online'};}
function register(app,d){
 app.put('/api/owner/services/users/:id/knowledge/:name',d.requireAuth,d.requireOwner,async(q,s,n)=>{try{
  const u=await d.getUserById(Number(q.params.id));await set(q.auth.user,u,q.params.name,q.body.enabled);
  await d.audit(q.auth.user.id,u.id,q.params.name+':'+(q.body.enabled?'grant':'revoke'));s.json({ok:true});
 }catch(e){s.status(400).json({error:e.message});}});
}
module.exports={NAMES,access,set,urls,register};
