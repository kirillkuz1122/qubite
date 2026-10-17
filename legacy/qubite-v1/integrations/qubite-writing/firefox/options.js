'use strict';
const form=document.getElementById('settings'),status=document.getElementById('status');
browser.storage.local.get({base:'https://qubiteapp.online',token:'',automatic:true,blocked:[],language:'ru'}).then(c=>{form.elements.base.value=c.base;form.elements.token.value=c.token;form.elements.automatic.checked=c.automatic;form.elements.language.value=c.language;form.elements.blocked.value=c.blocked.join('\n');});
form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{
 const base=new URL(form.elements.base.value);if(base.protocol!=='https:'||base.username||base.password)throw new Error('Нужен HTTPS-адрес Qubite.');
 const token=form.elements.token.value.trim();if(!/^qbw_[a-f0-9]{64}$/.test(token))throw new Error('Нужен ключ qbw_… из редактора Qubite.');
 if(base.origin!=='https://qubiteapp.online'&&!await browser.permissions.request({origins:[base.origin+'/*']}))throw new Error('Не разрешено подключение к этому серверу.');
 const blocked=form.elements.blocked.value.split(/\s+/).map(x=>x.toLowerCase()).filter(Boolean);
 await browser.storage.local.set({base:base.origin,token,automatic:form.elements.automatic.checked,blocked,language:form.elements.language.value});
 const data=await browser.runtime.sendMessage({kind:'request',action:'me'});status.textContent='Подключено. '+(data.access.ai?'ИИ разрешён.':'Только локальная проверка.')+' Настройки применятся после обновления открытых страниц.';
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
