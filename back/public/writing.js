'use strict';
const $=id=>document.getElementById(id),draft=$('draft'),status=$('status');
let before='',after='',timer,ticket=0,aiBusy=false,access;
async function request(path,body,method=body?'POST':'GET') {
 const response=await fetch('/api/writing/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось выполнить запрос.');return data;
}
function changed(){ticket++;$('issues').replaceChildren();$('count').textContent=draft.value.length+' / 8000';clearTimeout(timer);if($('automatic').checked&&draft.value.trim()&&!aiBusy)timer=setTimeout(localCheck,1800);$('undo').disabled=!before||draft.value!==after;}
function replace(text){before=draft.value;draft.value=text;after=text;changed();$('undo').disabled=false;}
async function localCheck(){if(!draft.value.trim())return;const text=draft.value,n=++ticket;status.textContent='Проверяем локально…';try{
 const data=await request('check',{text,language:$('language').value});if(n!==ticket||text!==draft.value)return;
 $('issues').replaceChildren();status.textContent=data.matches.length?'Найдено замечаний: '+data.matches.length:'Локальные правила не нашли ошибок. Это не гарантирует, что текст безупречен.';
 for(const m of data.matches){const row=document.createElement('div');row.className='issue';const p=document.createElement('p');p.textContent=m.message;const q=document.createElement('code');q.textContent=text.slice(m.offset,m.offset+m.length);row.append(q,p);
  for(const r of m.replacements.slice(0,5)){const b=document.createElement('button');b.className='btn btn--muted btn--sm';b.textContent=r.value;b.onclick=()=>{if(draft.value!==text){status.textContent='Текст изменился. Проверь ещё раз.';return;}replace(text.slice(0,m.offset)+r.value+text.slice(m.offset+m.length));};row.append(b);} $('issues').append(row);
 }
 }catch(e){if(n===ticket)status.textContent=e.message;}}
async function ai(mode){if(aiBusy)return;const text=draft.value;if(!text.trim())return;clearTimeout(timer);const n=++ticket;aiBusy=true;document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=true);status.textContent='ИИ редактирует…';try{
 const data=await request('rewrite',{text,mode,style:$('style').value==='custom'?$('custom-style').value:$('style').value});
 $('issues').replaceChildren();
 if(text===draft.value&&n===ticket&&data.text.length<=8000){replace(data.text);status.textContent='Текст заменён · '+data.model+' · $'+data.cost_usd.toFixed(6)+'. Можно отменить.';}
 else{$('result').hidden=false;$('result-text').textContent=data.text;$('apply-result').disabled=data.text.length>8000;status.textContent=data.text.length>8000?'Результат длиннее поля. Скопируй его из блока ниже.':'Ты изменил текст во время запроса. Результат показан отдельно.';}
 for(const note of [...data.notes,...data.questions]){const p=document.createElement('p');p.textContent=note;$('issues').append(p);}
 }catch(e){status.textContent=e.message;}finally{aiBusy=false;document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=!access?.ai);}}
draft.addEventListener('input',changed);$('check').onclick=localCheck;$('automatic').onchange=changed;$('language').onchange=changed;
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>ai(b.dataset.mode));
$('style').onchange=()=>{$('custom-style').hidden=$('style').value!=='custom';};
$('undo').onclick=()=>{if(draft.value!==after)return;draft.value=before;before='';after='';changed();status.textContent='Замена отменена.';};
$('apply-result').onclick=()=>{replace($('result-text').textContent);$('result').hidden=true;};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(draft.value);status.textContent='Скопировано.';}catch{status.textContent='Выдели текст и скопируй вручную.';}};
$('clear').onclick=()=>{draft.value='';before='';after='';$('result').hidden=true;changed();};
async function keys(){const data=await request('keys');$('keys').replaceChildren();for(const k of data.keys){const p=document.createElement('p');p.textContent=k.name+' · '+k.prefix+'… · '+(k.revoked?'отозван':'активен');if(!k.revoked){const b=document.createElement('button');b.className='btn btn--muted btn--sm';b.textContent='Отозвать';b.onclick=async()=>{try{await request('keys/'+k.id,{},'DELETE');await keys();}catch(e){status.textContent=e.message;}};p.append(b);}$('keys').append(p);}}
$('key-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const k=await request('keys',{name:f.get('name'),ai:f.has('ai')});$('key-result').replaceChildren();const p=document.createElement('p');p.textContent='Скопируй сейчас: ключ показывается один раз.';const input=document.createElement('input');input.className='input';input.readOnly=true;input.value=k.token;input.onclick=()=>input.select();$('key-result').append(p,input);await keys();}catch(e){status.textContent=e.message;}};
async function load(){try{const info=await request('me');access=info.access;const me=await fetch('/api/services/me').then(r=>r.json());$('account').textContent=me.login||'';if(!access.enabled)throw new Error('Доступ к редактору ещё не выдан. Попроси владельца Qubite.');
 document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=!access.ai||!info.ai_configured);status.textContent='Готово. Текст не сохраняется в историю.';
 if(me.owner){$('owner-settings').hidden=false;$('budget').value=info.budget_rub;$('budget-info').textContent='Сегодня: '+info.today_rub.toFixed(4)+' ₽. Расчётный курс: '+info.rub_per_usd+' ₽/$ ('+info.rate_date+').';}
 await keys();
 }catch(e){status.textContent=e.message;$('draft').disabled=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);const a=document.createElement('a');a.href='/';a.textContent='Войти в Qubite';status.append(' ',a);}}
$('budget-form').onsubmit=async e=>{e.preventDefault();try{const r=await fetch('/api/owner/services/writing-budget',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:Number($('budget').value)})});const d=await r.json();if(!r.ok)throw new Error(d.error);status.textContent='Бюджет сохранён.';await load();}catch(e){status.textContent=e.message;}};
load();
