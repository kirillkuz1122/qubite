'use strict';
const form=document.querySelector('#login-form');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button'),error=document.querySelector('#login-error');button.disabled=true;error.hidden=true;
  try{
    const next=new URL(location.href).searchParams.get('next')||'/';
    const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.querySelector('#login-user').value.trim(),password:document.querySelector('#login-password').value,next})});
    const data=await response.json();if(!response.ok)throw Error(data.detail||'Войти не удалось');
    location.assign(data.next);
  }catch(e){error.textContent=e.message;error.hidden=false;button.disabled=false;}
});
