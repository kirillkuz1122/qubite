'use strict';
(() => {
 const trigger=document.getElementById('mobile-menu-toggle'),dialog=document.getElementById('mobile-menu');
 const sidebar=document.querySelector('.sidebar'),closeButton=document.getElementById('mobile-menu-close');
 const mobile=matchMedia('(max-width:760px)'),anchor=document.createComment('sidebar home');
 sidebar.before(anchor);
 function restore(){
  anchor.after(sidebar);trigger.setAttribute('aria-expanded','false');
  document.documentElement.classList.remove('mobile-menu-open');
 }
 function close(){if(dialog.open)dialog.close();restore();}
 trigger.addEventListener('click',()=>{
  if(!mobile.matches)return;
  if(dialog.open){close();return;}
  dialog.append(sidebar);dialog.showModal();closeButton.focus();
  trigger.setAttribute('aria-expanded','true');document.documentElement.classList.add('mobile-menu-open');
 });
 closeButton.addEventListener('click',close);
 dialog.addEventListener('close',restore);
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const r=dialog.getBoundingClientRect();
  if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();
 });
 // Close before an existing handler opens Settings or focuses the search field.
 dialog.addEventListener('click',event=>{
  if(event.target.closest('a.brand,.nav-item,#new-search,#privacy-toggle'))close();
 },true);
 mobile.addEventListener('change',event=>{if(!event.matches)close();});
})();
