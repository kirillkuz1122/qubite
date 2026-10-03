'use strict';
const privacy={save:false,context:true};
function initPrivacy(){
 try{privacy.context=JSON.parse(localStorage.getItem('qubite-privacy:'+state.me.user)||'{}').context!==false;}catch{}
 privacy.save=!!state.me.history_enabled&&state.me.history_allowed;
 $('#save-history').checked=privacy.save;$('#save-history').disabled=!state.me.history_allowed;
 $('#use-context').checked=privacy.context;
 $('#save-history').onchange=async e=>{try{const result=await api('/api/history/settings',{enabled:e.target.checked},'PUT');privacy.save=result.enabled;await refreshMe();await refreshHistory();}catch(error){e.target.checked=privacy.save;notice(error.message);}};
 $('#use-context').onchange=e=>{privacy.context=e.target.checked;localStorage.setItem('qubite-privacy:'+state.me.user,JSON.stringify({context:privacy.context}));};
 $('#privacy-status').textContent='История '+(privacy.save?'включена и синхронизируется между устройствами.':'выключена. Новые запросы не сохраняются.');
}
async function privateRecords(){if(!state.me?.history_allowed)return [];return (await api('/api/history')).records;}
async function savePrivateHistory(){
 if(!privacy.save||!state.me.history_allowed||!state.turns.length)return;
 state.conversation ||= crypto.randomUUID().replaceAll('-','');
 try{await api('/api/history/'+state.conversation,{title:state.turns[0].query.slice(0,90),turns:state.turns.slice(-100)},'PUT');await refreshHistory();}catch(e){notice('Ответ готов, но история не сохранилась: '+e.message);}
}
async function deletePrivateRecord(id){await api('/api/history/'+id,{},'DELETE');if(state.conversation===id)state.conversation=null;await refreshHistory();}
async function showPrivateHistory(){
 try{const list=$('#mobile-history-list');list.replaceChildren();for(const item of await privateRecords()){const row=node('div','history-row'),b=node('button','history-item',item.title),del=node('button','history-delete','×');b.onclick=()=>{$('#history-modal').close();openHistory(item.id);};del.onclick=async()=>{await deletePrivateRecord(item.id);showPrivateHistory();};row.append(b,del);list.append(row);}$('#history-modal').showModal();}catch(e){notice(e.message);}
}
$('#privacy-toggle').onclick=()=>$('#privacy-modal').showModal();
$('#close-privacy').onclick=()=>$('#privacy-modal').close();
$('#open-private-history').onclick=showPrivateHistory;
$('#import-legacy-history').onclick=async()=>{
 if(!state.me.history_allowed)return;
 try{
  const envelope=await api('/api/history/encrypted-legacy');
  if(!envelope.records.length){$('#privacy-status').textContent='Старых зашифрованных записей нет.';return;}
  const phrase=prompt('Для переноса старых чатов введи прежнюю секретную фразу. Она остаётся в браузере.');if(phrase===null)return;
  const enc=new TextEncoder(),dec=new TextDecoder(),material=await crypto.subtle.importKey('raw',enc.encode(phrase),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:250000,salt:enc.encode(envelope.salt)},material,{name:'AES-GCM',length:256},false,['decrypt']);
  const decoded=[];
  for(const record of envelope.records){const bytes=Uint8Array.from(atob(record.ciphertext),c=>c.charCodeAt(0)),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:enc.encode(state.me.user+':'+record.id)},key,bytes.slice(12));const data=JSON.parse(dec.decode(plain));decoded.push({...data,id:record.id});}
  await api('/api/history/settings',{enabled:true},'PUT');privacy.save=true;$('#save-history').checked=true;
  // Delete old copies individually only after a successful write; a failure preserves remaining records.
  for(const item of decoded){await api('/api/history/'+item.id,{title:item.title,turns:item.turns},'PUT');await api('/api/history/encrypted-legacy/'+item.id,{},'DELETE');}
  $('#privacy-status').textContent='Старые чаты перенесены в синхронизируемую историю.';await refreshHistory();
 }catch(e){$('#privacy-status').textContent=e.name==='OperationError'?'Прежняя фраза не подходит. Старые записи сохранены.':e.message;}
};
async function resolveRequestedHistory(jobId,request){
 if(!privacy.context)return [];
 const envelope=state.me.history_allowed&&privacy.save?await api('/api/history'):{records:[],searches:[]};
 const current={id:'current',title:state.turns[0]?.query||'Текущий разговор',description:state.turns.slice(-4).map(t=>t.query.slice(0,90)).join(' · ')};
 const candidates=[...(state.turns.length?[current]:[]),...envelope.records.filter(x=>x.id!==state.conversation).map(x=>({id:x.id,title:x.title,description:'Сохранённый чат: '+x.title})),...envelope.searches.map(x=>({id:x.id,title:x.query,description:'Предыдущий поисковый запрос: '+x.query}))].slice(0,60);
 if(!candidates.length){toast('История выключена или пуста: уточни тему в чате');return [];}
 let ids=[];
 if(state.me.paid){try{ids=(await api('/api/history/select',{job_id:jobId,candidates:candidates.map(c=>({id:c.id,title:c.title.slice(0,120),description:c.description.slice(0,400)}))})).ids;}catch{toast('Не удалось выбрать прошлый контекст');}}
 else if(state.turns.length)ids=['current'];
 const chosen=candidates.find(c=>ids.includes(c.id));if(!chosen)return [];
 toast('Контекст: '+chosen.title);
 if(chosen.id==='current')return state.turns.slice(-4).map(t=>({query:t.query.slice(0,700),answer:t.result.answer_markdown.slice(0,3000)}));
 return (await api('/api/history/context/'+encodeURIComponent(chosen.id))).context;
}

for(const [id,key] of [['background-color','background'],['accent-color','accent']])document.getElementById(id)?.addEventListener('input',e=>{const name=document.documentElement.dataset.theme;let c={};try{c=JSON.parse(localStorage.getItem('qubite-colors:'+name)||'{}');}catch{}c[key]=e.target.value;localStorage.setItem('qubite-colors:'+name,JSON.stringify(c));applyCustomColors();});
document.getElementById('reset-colors')?.addEventListener('click',()=>{localStorage.removeItem('qubite-colors:'+document.documentElement.dataset.theme);applyCustomColors();});
