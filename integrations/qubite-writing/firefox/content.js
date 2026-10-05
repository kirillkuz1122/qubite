(() => {
 'use strict';
 let target,timer,revision=0,busy=false,config,undo,bubble,panel,root;
 const excluded=new Set(['password','email','tel','number','hidden','button','submit','checkbox','radio','file','date','color']);
 const sensitive=/api.?key|secret|token|authorization|password|current-password|new-password|one-time-code|cc-|credit.?card|cvc|cvv|card.?number/i;
 function editable(node){const e=node?.closest?.('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"]');if(!e||e.disabled||e.readOnly||e.dataset.qubiteWriting==='off')return null;
  if(e.tagName==='INPUT'&&(excluded.has(e.type)||!['text','search','url'].includes(e.type)))return null;
  if(sensitive.test([e.autocomplete,e.name,e.id].join(' ')))return null;return e;}
 function text(e){return e?.isContentEditable?e.innerText:e?.value||'';}
 function selection(e){const value=text(e);if(!e.isContentEditable&&typeof e.selectionStart==='number'&&e.selectionEnd>e.selectionStart)return {text:value.slice(e.selectionStart,e.selectionEnd),start:e.selectionStart,end:e.selectionEnd,whole:value};return {text:value,start:0,end:value.length,whole:value};}
 function dom(tag,value,parent=panel){const e=document.createElement(tag);if(value)e.textContent=value;parent.append(e);return e;}
 function button(label,fn,parent=panel){const b=dom('button',label,parent);b.type='button';b.onclick=e=>{if(e.isTrusted)fn();};return b;}
 function setup(){if(root)return;const host=document.createElement('div');host.style.cssText='all:initial;position:fixed;z-index:2147483646;top:0;left:0';document.documentElement.append(host);root=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=':host{all:initial}*{box-sizing:border-box}.bubble{position:fixed;border:1px solid #657053;border-radius:12px;background:linear-gradient(90deg,#f43f5e,#f59e0b);color:#020617;font:bold 15px system-ui;padding:7px 11px;cursor:pointer;box-shadow:0 3px 18px #0005}.panel{position:fixed;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:#0b1220;color:#e2e8f0;border:1px solid #48556c;border-radius:14px;padding:16px;box-shadow:0 12px 40px #0008;font:14px/1.5 system-ui}.panel button,.panel select,.panel input{background:#263245;color:#e2e8f0;border:1px solid #52617a;border-radius:7px;padding:8px;margin:4px 4px 4px 0;font:inherit;cursor:pointer}.panel p{margin:8px 0;overflow-wrap:anywhere}.panel pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;font:inherit}[hidden]{display:none!important}';root.append(style);
  bubble=document.createElement('button');bubble.className='bubble';bubble.textContent='✓';bubble.title='Qubite: проверить текст';bubble.onclick=e=>{if(e.isTrusted)menu();};root.append(bubble);panel=document.createElement('div');panel.className='panel';panel.hidden=true;root.append(panel);
 }
 function position(){if(!target?.isConnected){if(bubble)bubble.hidden=true;return;}const r=target.getBoundingClientRect();bubble.hidden=r.bottom<0||r.top>innerHeight;bubble.style.left=Math.max(8,Math.min(innerWidth-55,r.right-48))+'px';bubble.style.top=Math.max(8,Math.min(innerHeight-45,r.bottom-39))+'px';panel.style.left=Math.max(12,Math.min(innerWidth-392,r.right-380))+'px';panel.style.top=Math.max(12,Math.min(innerHeight-panel.offsetHeight-12,r.bottom+8))+'px';}
 function note(message){panel.hidden=false;panel.replaceChildren();dom('p',message);button('Закрыть',()=>panel.hidden=true);position();}
 function menu(){if(!target)return;panel.replaceChildren();panel.hidden=false;dom('strong','Qubite Writing');dom('p','Выдели фрагмент для ИИ или проверь всё поле.');
  button('Локальная проверка',()=>check(true));button('ИИ-проверка',()=>rewrite('check'));button('Улучшить в моём стиле',()=>rewrite('improve'));button('Улучшить промпт',()=>rewrite('prompt'));
  const styles=dom('select');styles.setAttribute('aria-label','Стиль');for(const v of ['простой и понятный','дружелюбный разговорный','деловой','академический','краткий и прямой','свой стиль']){const o=dom('option',v,styles);o.value=v;}
  const custom=dom('input');custom.placeholder='Опиши свой стиль';custom.maxLength=200;custom.hidden=true;styles.onchange=()=>{custom.hidden=styles.value!=='свой стиль';};button('Сменить стиль',()=>rewrite('style',styles.value==='свой стиль'?custom.value:styles.value));
  if(undo&&text(target)===undo.after)button('Отменить замену',()=>{setText(target,undo.before);undo=null;note('Замена отменена.');});
  button('Не проверять этот сайт',async()=>{config.blocked.push(location.hostname);await browser.storage.local.set({blocked:config.blocked});bubble.hidden=true;panel.hidden=true;target=null;clearTimeout(timer);});button('Закрыть',()=>panel.hidden=true);position();
 }
 function setText(e,value){e.focus();if(e.isContentEditable){const range=document.createRange();range.selectNodeContents(e);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);if(!document.execCommand('insertText',false,value))throw new Error('Это поле не поддерживает замену. Скопируй результат вручную.');}
  else{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}
 }
 function apply(e,source,result){if(!e.isConnected||text(e)!==source.whole){note('Поле изменилось. Результат не вставлен:');dom('pre',result);return false;}const value=source.whole.slice(0,source.start)+result+source.whole.slice(source.end);if(!e.isContentEditable&&e.maxLength>0&&value.length>e.maxLength){note('Результат превышает лимит поля. Скопируй его вручную:');dom('pre',result);return false;}setText(e,value);undo={before:source.whole,after:value};return true;}
 async function check(show){if(busy||!target)return;const e=target,value=text(e),n=revision;if(!value.trim()||value.length>8000)return;busy=true;bubble.textContent='…';try{
  const data=await browser.runtime.sendMessage({kind:'request',action:'check',body:{text:value,language:config?.language||'ru'}});if(e!==target||n!==revision||text(e)!==value)return;
  bubble.textContent=data.matches.length?String(data.matches.length):'✓';if(!show)return;panel.hidden=false;panel.replaceChildren();dom('strong','Локальная проверка');dom('p',data.matches.length?'Замечаний: '+data.matches.length:'Локальные правила не нашли ошибок. Сложные случаи можно проверить ИИ.');
  for(const m of data.matches){dom('p',m.message+' · «'+value.slice(m.offset,m.offset+m.length)+'»');for(const r of m.replacements.slice(0,3))button(r.value,()=>{if(apply(e,{whole:value,start:m.offset,end:m.offset+m.length},r.value))menu();});}
  button('Назад',menu);position();
 }catch(error){bubble.textContent='!';if(show)note(error.message);}finally{busy=false;}}
 async function rewrite(mode,style){if(busy||!target)return;clearTimeout(timer);const e=target,source=selection(e);if(!source.text.trim())return;busy=true;note('ИИ редактирует…');try{
  const data=await browser.runtime.sendMessage({kind:'request',action:'rewrite',body:{text:source.text,mode,style}});
  if(apply(e,source,data.text)){note('Текст заменён · '+data.model+'.');button('Отменить',()=>{if(text(e)!==undo.after){note('После замены текст изменился. Автоматическая отмена недоступна.');return;}setText(e,undo.before);undo=null;note('Замена отменена.');});}
  for(const s of [...data.notes,...data.questions])dom('p',s);button('Меню',menu);position();
 }catch(error){note(error.message);}finally{busy=false;}}
 function blocked(){return config?.blocked.some(d=>location.hostname===d||location.hostname.endsWith('.'+d));}
 document.addEventListener('focusin',async e=>{if(!config)config=await browser.runtime.sendMessage({kind:'config'});if(!config.configured||blocked())return;const next=editable(e.target);if(!next){if(e.target!==root?.host){target=null;revision++;if(bubble)bubble.hidden=true;if(panel)panel.hidden=true;}return;}if(next!==target){target=next;revision++;undo=null;}setup();position();},true);
 document.addEventListener('input',e=>{if(e.target!==target&&!target?.contains(e.target))return;revision++;clearTimeout(timer);if(config?.automatic&&!blocked())timer=setTimeout(()=>check(false),2000);},true);
 addEventListener('scroll',position,true);addEventListener('resize',position);
 browser.runtime.onMessage.addListener(m=>{if(m.contextAction){target=editable(document.activeElement)||target;if(!target)return;setup();position();if(m.contextAction==='menu')menu();else rewrite(m.contextAction);}});
})();
