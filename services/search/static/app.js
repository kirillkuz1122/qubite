'use strict';
const $ = (s) => document.querySelector(s);
const state = {me:null, view:'search', category:'general', page:1, search:null, turns:[], conversation:null, ai:true, generation:0, pending:false, abort:null};
const escapeHTML = (s) => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = (url) => {try {const u=new URL(url); return ['https:','http:'].includes(u.protocol)?u.href:null;} catch {return null;}};
const domain = (url) => {try {return new URL(url).hostname.replace(/^www\./,'');} catch {return 'источник';}};
const node = (tag, cls, text) => {const e=document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e;};
const sleep = (ms) => new Promise(resolve=>setTimeout(resolve,ms));

async function api(path, data, method='POST', signal) {
  const response=await fetch(path,{method:data!==undefined?method:'GET',headers:data!==undefined?{'Content-Type':'application/json'}:{},body:data!==undefined?JSON.stringify(data):undefined,signal});
  let body; try{body=await response.json();}catch{throw Error('Сервер не ответил. Проверь соединение.');}
  if(!response.ok) throw Error(typeof body.detail==='string'?body.detail:'Запрос не удалось выполнить.');
  return body;
}
function toast(text){$('#toast').textContent=text; $('#toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').hidden=true,2400);}
function notice(text){$('#notice').hidden=!text; $('#notice').textContent=text||'';}
function applyCustomColors(){
 const root=document.documentElement,name=root.dataset.theme||'qubite';let colors={};try{colors=JSON.parse(localStorage.getItem('qubite-colors:'+name)||'{}');}catch{}
 for(const [key,css] of [['background','--bg'],['accent','--accent']]){const value=colors[key];if(/^#[a-f0-9]{6}$/i.test(value))root.style.setProperty(css,value);else root.style.removeProperty(css);}
 const styles=getComputedStyle(root);
 for(const [id,css] of [['background-color','--bg'],['accent-color','--accent']]){const el=document.getElementById(id),color=styles.getPropertyValue(css).trim();if(el&&/^#[a-f0-9]{6}$/i.test(color))el.value=color;}
 if(colors.background){root.style.setProperty('--side',`color-mix(in srgb, var(--bg), var(--text) 4%)`);root.style.setProperty('--surface',`color-mix(in srgb, var(--bg), var(--text) 8%)`);}else{root.style.removeProperty('--side');root.style.removeProperty('--surface');}
 if(colors.accent)root.style.setProperty('--accent-soft','color-mix(in srgb,var(--accent) 18%,var(--bg))');else root.style.removeProperty('--accent-soft');
}

function theme(name){
  if(!['calm','violet','pixel','paper','qubite'].includes(name)) name='calm';
  document.documentElement.dataset.theme=name; localStorage.setItem('qubite-theme',name);
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('selected',b.dataset.themeChoice===name));
  applyCustomColors();
}
if(!localStorage.getItem('qubite-brand-v2')){if(!localStorage.getItem('qubite-theme')||localStorage.getItem('qubite-theme')==='calm')localStorage.setItem('qubite-theme','qubite');localStorage.setItem('qubite-brand-v2','1');}
theme(localStorage.getItem('qubite-theme')||'qubite');
applyCustomColors();
document.querySelectorAll('[data-theme-choice]').forEach(b=>b.addEventListener('click',()=>theme(b.dataset.themeChoice)));
$('#style-toggle').addEventListener('click',()=>{const p=$('#style-panel'); p.hidden=!p.hidden; $('#style-toggle').setAttribute('aria-expanded',String(!p.hidden));});
document.addEventListener('click',e=>{if(!e.target.closest('.style-panel,.style-toggle')){$('#style-panel').hidden=true;$('#style-toggle').setAttribute('aria-expanded','false');}});
$('#close-visual').addEventListener('click',()=>{$('#visual-modal').close();$('#visual-content').replaceChildren();});
$('#visual-modal').addEventListener('close',()=>$('#visual-content').replaceChildren());

function setView(view){
  if(view!=='search')QubiteMedia.stop();
  state.view=view;
  $('#search-view').hidden=view!=='search'; $('#ai-view').hidden=view!=='ai';
  $('#categories').hidden=view!=='search'||!state.search;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#view-title').textContent=view==='ai'?'ИИ-ответ':'Поиск';
  $('#query').placeholder=view==='ai'&&state.turns.length?'Уточни или задай следующий вопрос…':'Найти или задать вопрос…';
  $('#ai-toggle').hidden=view==='ai';
  $('#welcome').hidden=!!state.search||view==='ai';
  $('#starter-prompts').hidden=!!state.search||view==='ai';
  document.body.classList.toggle('chat-mode',view==='ai');
  $('#new-chat-tools').hidden=view!=='ai';
  $('#workspace').classList.toggle('empty',!state.search&&view==='search');
  $('#ai-empty').hidden=state.turns.length>0||state.pending;
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#new-chat').onclick=()=>{reset();setView('ai');$('#query').focus();};
$('#chat-history').onclick=()=>showPrivateHistory();

function reset(){
  QubiteMedia.stop();
  history.replaceState({},'', '/');
  state.generation++; state.abort?.abort(); state.search=null; state.turns=[]; state.conversation=null;state.category='general';state.page=1;state.pending=false;
  $('#query').value='';$('#results').replaceChildren();$('#conversation').replaceChildren();$('#overview').hidden=true;
  $('#result-info').textContent='';$('#correction').hidden=true;$('#pagination').hidden=true;$('#suggestions').replaceChildren();$('#engine-status').hidden=true;$('#chat-pending').hidden=true;notice('');
  document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category==='general'));
  setView('search');$('#query').focus();
}
$('#new-search').addEventListener('click',reset);
$('#mobile-new-search').addEventListener('click',()=>{$('#history-modal').close();reset();});
$('#close-mobile-history').addEventListener('click',()=>$('#history-modal').close());
$('#mobile-history').addEventListener('click',()=>showPrivateHistory());
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#query').focus();$('#query').select();}if(e.key==='Escape'){$('#style-panel').hidden=true;}});
$('#ai-toggle').addEventListener('click',()=>{
  state.ai=!state.ai;$('#ai-toggle').textContent=state.ai?'✧ ИИ включён':'✧ Только вопросы с ?';$('#ai-toggle').setAttribute('aria-pressed',String(state.ai));
  if(state.ai&&state.search&&!state.pending&&state.category==='general') startAnswer(state.generation);
});
$('.starter-prompts').addEventListener('click',e=>{if(e.target.tagName==='BUTTON'){$('#query').value=e.target.textContent;submitSearch();}});
document.querySelectorAll('[data-category]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.category;state.page=1;submitSearch({navigation:true});}));
$('#prev-page').addEventListener('click',()=>{if(state.page>1){state.page--;submitSearch({navigation:true});}});
$('#next-page').addEventListener('click',()=>{state.page++;submitSearch({navigation:true});});
$('#search-form').addEventListener('submit',e=>{e.preventDefault();submitSearch();});
$('#model').addEventListener('change',()=>toast('Модель выбрана для следующего ответа'));

async function refreshMe(){
  state.me=await api('/api/me');
  privacy.save=!!state.me.history_enabled&&state.me.history_allowed;
  $('#user-name').textContent=state.me.login;
  $('.avatar').textContent=state.me.owner?'К':'Г';
  $('#user-note').textContent=privacy.save?'История включена':'Без сохранения истории';
  $('#mobile-history').hidden=!state.me.history_allowed;
  if(state.me.owner){
    const budget=state.me.budget, fraction=Math.min(100,100*(budget.spent+budget.reserved)/budget.limit);
    $('#budget').innerHTML='ИИ сегодня · $'+budget.spent.toFixed(4)+' / $'+budget.limit.toFixed(2)+'<div class="budget-track"><div class="budget-fill"></div></div>';
    $('.budget-fill').style.width=fraction+'%';
  }else{$('#budget').textContent='ИИ: осталось '+(state.me.guest_limit===null?'без лимита на день':state.me.guest_remaining+' из '+state.me.guest_limit+' на день')+' · '+(state.me.guest_hourly===null?'без лимита в час':state.me.guest_hourly+' в час');}
}
async function refreshHistory(){
  const parent=$('#history-list');parent.replaceChildren();$('#history-panel').hidden=!state.me?.history_allowed;
  if(!state.me?.history_allowed)return;
  const history=await privateRecords();
  for(const item of history){
    const row=node('div','history-row'),b=node('button','history-item',item.title),del=node('button','history-delete','×');
    b.addEventListener('click',()=>openHistory(item.id));del.title='Удалить этот разговор';del.setAttribute('aria-label','Удалить '+item.title);del.addEventListener('click',()=>deletePrivateRecord(item.id));row.append(b,del);parent.append(row);
  }
  if(!history.length)parent.append(node('p','history-item','Нет сохранённых разговоров'));
}
async function openHistory(cid){
  try{
    const item=await api('/api/history/'+encodeURIComponent(cid));
    state.generation++;state.abort?.abort();state.pending=false;$('#chat-pending').hidden=true;
    state.turns=item.turns;state.conversation=cid;state.search=null;$('#query').value='';notice('');renderChat();setView('ai');
  }catch(e){notice(e.message);}
}
$('#clear-history').addEventListener('click',async()=>{
  if(!confirm('Удалить всю твою сохранённую историю?'))return;
  try{await api('/api/history',{},'DELETE');await refreshHistory();reset();toast('История удалена');}catch(e){notice(e.message);}
});

function directURL(query){
  if(/\s/.test(query)||!(/^(https?:\/\/|www\.)/i.test(query)||/^(?:[a-z0-9а-яё-]+(?:\.[a-z0-9а-яё-]+)*\.[a-zа-яё]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?:[/:?#]|$)/i.test(query)))return null;
  try{const u=new URL(/^https?:\/\//i.test(query)?query:'https://'+query);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
async function submitSearch(options={}){
  const query=$('#query').value.trim()||(options.navigation?state.search?.query:'');if(!query)return;
  const destination=directURL(query);if(destination&&!options.navigation){location.assign(destination);return;}
  const follow=state.view==='ai'&&state.turns.length>0&&!options.navigation;
  if(!follow&&!options.navigation)history.replaceState({},'', '/search?q='+encodeURIComponent(query));
  if(!follow&&!options.navigation){state.conversation=null;state.turns=[];renderChat();}
  QubiteMedia.stop();
  const seq=++state.generation;state.abort?.abort();state.abort=new AbortController();
  state.pending=true;notice('');$('#search-submit').disabled=true;
  $('#search-hint').textContent='Ищем источники…';$('#welcome').hidden=true;$('#starter-prompts').hidden=true;$('#workspace').classList.remove('empty');
  if(!options.navigation){state.page=1;state.category='general';}
  renderEnginePicker();
  $('#overview').hidden=state.view!=='search'||state.category!=='general';
  $('#overview').replaceChildren(pending('Ищем в интернете'));
  $('#chat-pending').hidden=state.view!=='ai';$('#chat-pending').replaceChildren(pending('Ищем источники'));
  try{
    const data=await api('/api/search',{query,category:state.category,page:state.page,correct:options.correct!==false,conversation:null,...searchFilterParams()},'POST',state.abort.signal);
    if(seq!==state.generation)return;
    state.search=data;state.pending=false;renderResults();setView(state.view);
    $('#search-hint').textContent='Короткий ответ, когда он есть. ИИ — когда нужен.';
    if(state.category==='general'&&!options.navigation&&(state.ai||state.view==='ai'||/[?？]$/.test(query)))await startAnswer(seq,follow);
    else{$('#overview').hidden=true;$('#chat-pending').hidden=true;}
  }catch(e){
    if(e.name!=='AbortError'&&seq===state.generation){notice(e.message);$('#overview').hidden=true;$('#chat-pending').hidden=true;}
  }finally{
    if(seq===state.generation){state.pending=false;$('#search-submit').disabled=false;setView(state.view);}
  }
}
function pending(text){const e=node('div','pending-line');e.append(node('span','spinner'),node('span','',text));return e;}

function renderResults(){
  const s=state.search;if(!s)return;const parent=$('#results');QubiteMedia.stop();parent.replaceChildren();parent.className=s.category==='images'?'image-grid':s.category==='videos'?'video-grid':'';renderEnginePicker();
  $('#categories').hidden=state.view!=='search';document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===s.category));
  const correction=$('#correction');correction.replaceChildren();correction.hidden=true;
  if(s.corrected!==s.query){
    correction.hidden=false;correction.append(document.createTextNode('Исправлено: '+s.corrected+'. '));
    const original=node('button','','Искать «'+s.query+'»');original.addEventListener('click',()=>{$('#query').value=s.query;submitSearch({correct:false});});correction.append(original);
  }else if(s.corrections.length){
    correction.hidden=false;correction.append(document.createTextNode('Возможно, ты имел в виду: '));
    for(const q of s.corrections){const b=node('button','',q);b.addEventListener('click',()=>{$('#query').value=q;submitSearch();});correction.append(b);}
  }
  $('#result-info').textContent=s.results.length?'Источники · страница '+s.page+' · '+seconds(s.elapsed_ms):'По этому запросу ничего не найдено. Попробуй другие слова.';
  for(const item of s.results){
    const href=safeURL(item.url);if(!href)continue;
    const article=node('article',s.category==='images'?'image-result':s.category==='videos'?'result video-result':'result');
    if(s.category==='images'){
      const image=safeURL(item.image||item.thumbnail);
      if(image){const img=node('img');QubiteMedia.image(img,image,filters.direct);img.alt=item.title;article.append(img);}
      const title=node('a','',item.title);title.href=href;title.target='_blank';title.rel='noopener noreferrer';article.append(title,node('small','',domain(href)));
    }else{
      if(s.category==='videos')QubiteMedia.mount(article,item,filters.direct);
      if(s.category!=='videos'&&item.thumbnail&&safeURL(item.thumbnail)){const img=node('img','result-thumb');QubiteMedia.image(img,item.thumbnail,filters.direct);img.alt='';article.append(img);}
      const top=node('div','result-domain');top.append(node('span','domain-avatar',domain(href)[0].toUpperCase()),node('span','',domain(href)));article.append(top);
      const title=node('a','result-title',item.title);title.href=href;title.target='_blank';title.rel='noopener noreferrer';article.append(title,node('p','',item.content));
    }
    const origins=node('div','engine-badges');for(const name of item.engines||[item.engine])if(name)origins.append(node('span','engine-badge',engineName(name)));article.append(origins);
    parent.append(article);
  }
  $('#pagination').hidden=!s.results.length;$('#page-number').textContent='Страница '+s.page;$('#prev-page').disabled=s.page===1;$('#next-page').disabled=s.page>=20;
  $('#suggestions').replaceChildren();for(const suggestion of s.suggestions){const b=node('button','',suggestion);b.addEventListener('click',()=>{$('#query').value=suggestion;submitSearch();});$('#suggestions').append(b);}
  const errors=$('#engine-status');errors.hidden=false;const detail=errors.querySelector('div');detail.replaceChildren();
  errors.querySelector('summary').textContent='Поисковые системы · '+seconds(s.elapsed_ms);
  const table=node('table','engine-table'),head=node('tr');for(const text of ['Движок','Время','Результаты','Состояние'])head.append(node('th','',text));table.append(head);
  for(const e of s.engine_timings||[]){const row=node('tr');for(const text of [engineName(e.engine),e.elapsed_ms==null?'—':seconds(e.elapsed_ms),String(e.results),e.error||(e.elapsed_ms==null?'Время не передано':'Ответ получен')])row.append(node('td','',text));table.append(row);}
  detail.append(table,node('p','filter-note','Движки работают параллельно: их времена не складываются. Общее время включает исправление запроса и краткий источник. Число результатов учитывает показанные ссылки; одна ссылка может быть найдена несколькими движками.'));
  for(const warning of s.filter_warnings||[])detail.append(node('p','filter-note',warning));
}
function modelName(result){
  if(result.kind==='extract')return 'Готовый ответ · '+domain(result.sources[0]?.url);
  if(!result.model)return 'ИИ-ответ';
  const names={'google/gemini-3.5-flash-lite':'Gemini 3.5 Flash-Lite','google/gemma-4-26b-a4b-it:free':'Gemma 4 · бесплатно','qwen/qwen3.8-27b:free':'Qwen 3.8 · бесплатно','thinkingmachines/inkling-small:free':'Inkling Small · бесплатно','nvidia/nemotron-3.5-lightning:free':'Nemotron 3.5 · бесплатно','inclusionai/ling-3.1-flash':'Ling 3.1 · бесплатно','mistralai/mistral-nemo':'Mistral Nemo','inclusionai/ling-3.0-flash':'Ling 3.0 Flash','z-ai/glm-5.3-flash':'GLM 5.3 Flash'};
  return names[result.model]||result.model;
}
function renderOverview(result){
  const box=$('#overview');box.hidden=false;box.replaceChildren();
  const header=node('div','overview-head');header.append(node('span','',result.kind==='extract'?'◈ Коротко из источника':result.kind==='translation'?'⇄ Перевод':'✧ ИИ-обзор'),node('small','',modelName(result)+(result.elapsed_ms?' · '+seconds(result.elapsed_ms):'')));box.append(header);
  if(result.translation){
    const card=node('div','translation-card');
    const from=node('section'),to=node('section');
    from.append(node('small','section-label',result.translation.target==='ru'?'АНГЛИЙСКИЙ':'РУССКИЙ'),node('p','',result.translation.text));
    to.append(node('small','section-label',result.translation.target==='ru'?'РУССКИЙ':'АНГЛИЙСКИЙ'),node('p','',result.answer_markdown));
    const actions=node('div','translation-actions'),copy=node('button','text-button','Копировать перевод'),swap=node('button','text-button','⇄ Обратно');
    copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(result.answer_markdown);toast('Перевод скопирован');});
    swap.addEventListener('click',()=>{$('#query').value=result.answer_markdown+(result.translation.target==='ru'?' на английском':' на русском');submitSearch();});
    actions.append(copy,swap);to.append(actions);card.append(from,to);box.append(card);
  }else box.append(node('div','overview-text',result.overview.replace(/\[\d+\]/g,'').replace(/\s+([.,;:!?])/g,'$1')));
  const foot=node('div','overview-footer'),chips=node('div','source-chips');
  for(const source of result.sources.slice(0,3)){const a=node('a','source-chip',domain(source.url));a.href=safeURL(source.url);a.target='_blank';a.rel='noopener noreferrer';chips.append(a);}
  const button=node('button','more-button','Подробнее ↗');button.addEventListener('click',()=>{setView('ai');if(!result.detail){startAnswer(state.generation,false,true);return;}$('#conversation').lastElementChild?.scrollIntoView({behavior:'smooth',block:'start'});});
  foot.append(chips,button);box.append(foot);renderVerification(box,result,()=>regenerateTurn(state.turns.at(-1)));
}

async function startAnswer(seq,follow=false,force=false,options={}){
  if(!state.search||seq!==state.generation)return;
  state.pending=true;$('#search-submit').disabled=true;$('#ai-empty').hidden=true;
  $('#overview').hidden=state.view!=='search';$('#overview').replaceChildren(pending('Проверяем краткий ответ'));
  $('#chat-pending').hidden=state.view!=='ai';$('#chat-pending').replaceChildren(pending('Готовим ответ'));
  const query=state.search.query;
  try{
    const body={search_id:state.search.id,model:state.me.paid?$('#model').value:'free',conversation:null,
      context:[],history_available:privacy.context&&(state.turns.length>0||privacy.save&&state.me.history_allowed),recent_questions:privacy.context?state.turns.slice(-2).map(t=>t.query.slice(0,120)):[],force:force||state.view==='ai',detail:options.detail??(force||state.view==='ai'),verify:state.me.verification_enabled,regenerate:!!options.regenerate};
    let job=await api('/api/answer',body);
    let result;
    for(let count=0;count<200;count++){
      await sleep(count?1200:300);if(seq!==state.generation)return;
      const progress=await api('/api/jobs/'+job.id);
      if(progress.status==='error')throw Error(progress.error);
      if(progress.status==='needs_history'){
        $('#chat-pending').replaceChildren(pending('Ищем нужный прошлый разговор'));
        body.context=await resolveRequestedHistory(job.id,progress.history_request);
        if(seq!==state.generation)return;
        body.history_parent=job.id;body.history_available=false;job=await api('/api/answer',body);continue;
      }
      if(progress.status==='done'){result=progress.result;break;}
      if(state.view==='search'){$('#overview').hidden=false;$('#overview').replaceChildren(pending(progress.stage));}
      $('#chat-pending').replaceChildren(pending(progress.stage));
    }
    if(!result)throw Error('Ответ ещё готовится. Попробуй через минуту.');
    if(seq!==state.generation)return;

    if(body.detail&&state.turns.at(-1)?.query===query&&state.turns.at(-1)?.result.detail===false)state.turns.pop();
    state.turns.push({query,result});
    await savePrivateHistory();renderChat();renderOverview(result);$('#chat-pending').hidden=true;
    if(state.view==='ai')$('#query').value='';
    await refreshMe();await refreshHistory();
  }catch(e){
    if(seq!==state.generation)return;
    $('#overview').hidden=state.view!=='search';$('#overview').replaceChildren(node('p','',e.message));
    const retry=node('button','more-button','Попробовать ещё');retry.addEventListener('click',()=>startAnswer(state.generation,follow,force));$('#overview').append(retry);
    $('#chat-pending').replaceChildren(node('div','notice',e.message),retry.cloneNode(true));
    $('#chat-pending').lastChild.addEventListener('click',()=>startAnswer(state.generation,follow,true));
    $('#chat-pending').hidden=state.view!=='ai';
  }finally{if(seq===state.generation){state.pending=false;$('#search-submit').disabled=false;$('#ai-empty').hidden=!!state.turns.length;}}
}
function renderVerification(parent,result,retry){
  const v=result.verification;if(!v)return;
  const box=node('section','verification verification-'+v.status);box.setAttribute('aria-label','Проверка ответа');
  box.append(node('p','',v.label));
  for(const warning of v.warnings||[])box.append(node('small','',warning));
  if(v.cost_usd)box.append(node('small','','Проверка: $'+Number(v.cost_usd).toFixed(6)));
  if(v.retry_recommended){const b=node('button','more-button','Перегенерировать');b.title='Новый ответ и проверка расходуют лимит';b.addEventListener('click',retry);box.append(b);}
  if(v.status==='not_checked'&&state.me.paid&&result.verification_id){const b=node('button','more-button','Проверить Jev');b.title='Один платный вызов проверки, без новой генерации';b.addEventListener('click',()=>checkExistingAnswer(result,b));box.append(b);}
  parent.append(box);
}
async function checkExistingAnswer(result,button){
  if(button.disabled)return;button.disabled=true;button.textContent='Jev проверяет…';
  try{const checked=await api('/api/verify',{job_id:result.verification_id});Object.assign(result,checked);await savePrivateHistory();renderChat();if(state.view==='search')renderOverview(result);await refreshMe();}
  catch(e){toast(e.message);button.disabled=false;button.textContent='Проверить Jev';}
}
async function regenerateTurn(turn){
  if(!turn||state.pending)return;
  const seq=++state.generation;state.pending=true;
  try{
    if(!state.search||state.search.query!==turn.query){state.search=await api('/api/search',{query:turn.query,category:'general',page:1,correct:false});}
    if(seq!==state.generation)return;
    await startAnswer(seq,false,true,{regenerate:true,detail:turn.result.detail!==false});
  }catch(e){notice(e.message);}finally{if(seq===state.generation)state.pending=false;}
}
function visualFrame(v){
  const iframe=node('iframe');iframe.src='/api/visual/'+encodeURIComponent(v.id);iframe.title=v.title;iframe.setAttribute('sandbox','allow-scripts');iframe.setAttribute('referrerpolicy','no-referrer');iframe.loading='lazy';return iframe;
}
function renderChat(){
  const parent=$('#conversation');parent.replaceChildren();
  state.turns.forEach((turn,index)=>{
    const r=turn.result,article=node('article','turn');article.append(node('h2','turn-question',turn.query));
    const meta=node('div','answer-meta');meta.append(node('span','',r.kind==='extract'?'◈':'✧'),node('span','',modelName(r)));if(r.elapsed_ms)meta.append(node('span','',seconds(r.elapsed_ms)));if(r.cost)meta.append(node('span','','$'+r.cost.toFixed(5)));article.append(meta);
    const answer=node('div','answer');answer.innerHTML=r.answer_html.replaceAll('href="#source-','href="#turn-'+index+'-source-');article.append(answer);
    renderVerification(article,r,()=>regenerateTurn(turn));
    if(r.truncated)article.append(node('p','notice','Ответ прервался на лимите модели. Можно запросить продолжение в чате.'));
    if(r.images?.length){
      const images=node('div','answer-images');for(const image of r.images){const figure=node('figure'),a=node('a');a.href=safeURL(image.source_url);a.target='_blank';a.rel='noopener noreferrer';const img=node('img');QubiteMedia.image(img,image.url,filters.direct);img.alt=image.title;a.append(img);figure.append(a,node('figcaption','',image.title));images.append(figure);}article.append(images);
    }
    for(const v of r.visuals||[]){
      const visual=node('section','answer-visual'),header=node('div','visual-header');header.append(node('span','',v.title));const expand=node('button','','Развернуть ↗');expand.addEventListener('click',()=>{$('#visual-title').textContent=v.title;$('#visual-content').replaceChildren(visualFrame(v));$('#visual-modal').showModal();});header.append(expand);visual.append(header,visualFrame(v));article.append(visual);
    }
    if(r.sources.length){
      const sources=node('details','sources');sources.append(node('summary','','Источники · '+r.sources.length));
      for(const s of r.sources){
        const row=node('div','source-row'+(s.status==='read'?'':' unread'));row.id='turn-'+index+'-source-'+s.id;
        row.append(node('span','source-number',String(s.id)));const data=node('div'),a=node('a','',s.title);a.href=safeURL(s.url);a.target='_blank';a.rel='noopener noreferrer';data.append(a,node('small','',domain(s.url)+' · '+(s.status==='read'?'Текст прочитан':'Только поисковый фрагмент')));row.append(data);sources.append(row);
      }
      article.append(sources);
    }
    const actions=node('div','turn-actions'),copy=node('button','','Копировать');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(r.answer_markdown);toast('Ответ скопирован');}catch{toast('Копирование недоступно');}});
    actions.append(copy);
    if(index===state.turns.length-1&&(r.kind==='extract'||r.detail===false)&&state.search){const ai=node('button','',r.detail===false?'Подробнее':'Спросить ИИ');ai.addEventListener('click',()=>startAnswer(state.generation,false,true));actions.append(ai);}
    article.append(actions);parent.append(article);
  });
  $('#ai-empty').hidden=state.turns.length>0||state.pending;
}
$('#conversation').addEventListener('click',e=>{
  const a=e.target.closest('a[href^="#turn-"]');if(!a)return;
  e.preventDefault();const source=document.getElementById(a.getAttribute('href').slice(1));if(source){source.closest('details').open=true;source.scrollIntoView({behavior:'smooth',block:'center'});}
});
document.addEventListener('DOMContentLoaded',async()=>{
  try{
    await refreshMe();await initSearchFilters();const select=$('#model');select.replaceChildren();
    if(state.me.paid)select.append(new Option('Авто · по сложности','auto'));
    for(const m of state.me.models)select.append(new Option(m.label,m.id));
    select.disabled=!state.me.paid;$('#chat-history').hidden=!state.me.history_allowed;initPrivacy();await refreshHistory();setView('search');
    const q=new URL(location.href).searchParams.get('q');if(q){$('#query').value=q;await submitSearch();}
  }catch(e){notice(e.message);$('#user-name').textContent='Нет соединения';}
},{once:true});

const filters={catalogue:[],engines:{},safe:1,language:'all',time:'',direct:true};
const seconds=ms=>Number.isFinite(ms)?(ms/1000).toFixed(2)+' с':'время недоступно';
function engineName(name){const names={google:'Google','google cse':'Google CSE',bing:'Bing',duckduckgo:'DuckDuckGo',yandex:'Яндекс',yahoo:'Yahoo',brave:'Brave',wikipedia:'Wikipedia',wikidata:'Wikidata',youtube:'YouTube',vimeo:'Vimeo',dailymotion:'Dailymotion'};return names[name]||name;}
function filterStorage(){return 'qubite-search-filters:'+state.me.user;}
function saveSearchFilters(){localStorage.setItem(filterStorage(),JSON.stringify({engines:filters.engines,safe:filters.safe,language:filters.language,time:filters.time,direct:filters.direct}));}
function categoryEngines(){return filters.catalogue.filter(e=>e.categories.includes(state.category));}
function chosenEngines(){const available=categoryEngines();const saved=filters.engines[state.category];return Array.isArray(saved)? saved.filter(n=>available.some(e=>e.name===n)) :available.filter(e=>e.enabled).map(e=>e.name);}
function searchFilterParams(){return {safesearch:filters.safe,language:filters.language,time_range:filters.time||null,engines:filters.catalogue.length?chosenEngines():null};}
function renderEnginePicker(){
  const parent=$('#engine-options');parent.replaceChildren();const chosen=chosenEngines();
  for(const engine of categoryEngines()){
    const label=node('label'),input=node('input');input.type='checkbox';input.value=engine.name;input.checked=chosen.includes(engine.name);input.disabled=filters.safe===2&&!engine.safesearch;
    label.append(input,document.createTextNode(engineName(engine.name)));if(!engine.safesearch)label.title='Не поддерживает фильтр безопасного поиска';
    input.addEventListener('change',()=>{filters.engines[state.category]=[...parent.querySelectorAll('input:checked')].map(e=>e.value);saveSearchFilters();});parent.append(label);
  }
}
async function initSearchFilters(){
  try{Object.assign(filters,JSON.parse(localStorage.getItem(filterStorage())||'{}'));}catch{}
  if(![0,1,2].includes(filters.safe))filters.safe=1;if(!['all','ru-RU','en'].includes(filters.language))filters.language='all';if(!['','day','week','month','year'].includes(filters.time))filters.time='';if(!filters.engines||typeof filters.engines!=='object')filters.engines={};filters.direct=filters.direct!==false;
  $('#safe-search').value=String(filters.safe);$('#search-language').value=filters.language;$('#search-time').value=filters.time;$('#direct-images').checked=filters.direct;
  try{filters.catalogue=(await api('/api/search/config')).engines;renderEnginePicker();}catch{$('#filters-note').textContent='Список движков временно недоступен';}
}
for(const [id,key] of [['safe-search','safe'],['search-language','language'],['search-time','time'],['direct-images','direct']])$('#'+id).addEventListener('change',event=>{filters[key]=key==='direct'?event.target.checked:key==='safe'?Number(event.target.value):event.target.value;saveSearchFilters();renderEnginePicker();if(key==='direct'&&state.search)renderResults();});
$('#apply-filters').addEventListener('click',()=>{if(state.search){state.page=1;submitSearch({navigation:true});}else toast('Параметры применятся к следующему поиску');});
$('#reset-filters').addEventListener('click',()=>{localStorage.removeItem(filterStorage());Object.assign(filters,{engines:{},safe:1,language:'all',time:'',direct:true});initSearchFilters();toast('Параметры сброшены');});
