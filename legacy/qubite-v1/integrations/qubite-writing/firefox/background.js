'use strict';
const api=browser;
api.browserAction.onClicked.addListener(()=>api.runtime.openOptionsPage());
for(const [id,title] of [['check','ИИ-проверка'],['improve','Улучшить в моём стиле'],['prompt','Улучшить промпт'],['menu','Редактор Qubite']])api.contextMenus.create({id,title,contexts:['editable']});
api.contextMenus.onClicked.addListener((info,tab)=>api.tabs.sendMessage(tab.id,{contextAction:info.menuItemId},{frameId:info.frameId}).catch(()=>{}));
api.runtime.onMessage.addListener(async(message,sender)=>{
 const c=await api.storage.local.get({base:'https://qubiteapp.online',token:'',automatic:true,blocked:[],language:'ru'});
 if(message.kind==='config')return {automatic:c.automatic,blocked:c.blocked,configured:Boolean(c.token),language:c.language};
 if(message.kind!=='request'||!['me','check','rewrite'].includes(message.action))throw new Error('Неизвестная команда.');
 // options_ui opens in a tab too; tab presence does not identify a content script.
 const ownOptions=sender.id===api.runtime.id&&typeof sender.url==='string'&&sender.url.split(/[?#]/,1)[0]===api.runtime.getURL('options.html');
 if(message.action==='me'&&!ownOptions)throw new Error('Недоступная команда.');
 if(!c.token)throw new Error('Открой настройки расширения и вставь ключ Qubite Writing.');
 const base=new URL(c.base);if(base.protocol!=='https:'||base.username||base.password)throw new Error('Сервер должен использовать HTTPS.');
 const text=message.body?.text;if(message.action!=='me'&&(typeof text!=='string'||!text.trim()||text.length>8000))throw new Error('Текст: от 1 до 8000 символов.');
 const response=await fetch(base.origin+'/api/writing/v1/'+message.action,{method:message.action==='me'?'GET':'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:message.action==='me'?undefined:JSON.stringify(message.body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(message.action==='rewrite'?40000:28000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Qubite недоступен.');return data;
});
