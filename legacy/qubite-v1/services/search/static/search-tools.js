'use strict';
// Only recognized provider URLs become players; never use HTML supplied by a result.
const QubiteMedia=(()=>{
  let active=null,armed=null,finish=null;
  function video(url){
    try{
      const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
      const host=u.hostname.toLowerCase();let id=null;
      if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host))id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)?.[1];
      else if(host==='youtu.be')id=u.pathname.slice(1);
      if(id&&/^[A-Za-z0-9_-]{11}$/.test(id))return {url:'https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1&mute=1&controls=0&playsinline=1&start=0&end=8',cover:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',name:'YouTube'};
      if(['vimeo.com','www.vimeo.com'].includes(host)&&/^\/\d+\/?$/.test(u.pathname))return {url:'https://player.vimeo.com/video/'+u.pathname.replaceAll('/','')+'?autoplay=1&muted=1&controls=0&dnt=1',name:'Vimeo'};
      if(['www.dailymotion.com','dailymotion.com'].includes(host)&&/^\/video\/x[a-z0-9]+$/i.test(u.pathname))return {url:'https://www.dailymotion.com/embed/video/'+u.pathname.split('/')[2]+'?autoplay=1&mute=1&controls=0',name:'Dailymotion'};
    }catch{}
    return null;
  }
  function stop(){clearTimeout(armed);clearTimeout(finish);armed=finish=null;if(active){active.frame.remove();active.button.textContent='▶ Предпросмотр · 8 сек';active.button.setAttribute('aria-pressed','false');active=null;}}
  function image(img,url,direct=true){
    try{
      const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();
      const proxy='/api/image?url='+encodeURIComponent(u.href),isDirect=direct&&u.protocol==='https:';
      img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.src=isDirect?u.href:proxy;
      img.addEventListener('error',()=>{if(isDirect&&img.getAttribute('src')!==proxy)img.src=proxy;else img.hidden=true;});
    }catch{img.hidden=true;}
  }
  function mount(card,item,direct=true){
    const provider=video(item.url),wrap=document.createElement('div');wrap.className='video-cover';
    const placeholder=document.createElement('span');placeholder.className='video-placeholder';placeholder.textContent='▶';wrap.append(placeholder);
    const cover=item.thumbnail||provider?.cover;
    if(cover){const img=document.createElement('img');img.alt=item.title||'Обложка видео';image(img,cover,direct);wrap.append(img);}
    if(item.duration){const badge=document.createElement('span');badge.className='video-duration';badge.textContent=item.duration;wrap.append(badge);}
    card.append(wrap);
    const button=document.createElement('button');button.type='button';button.className='video-preview';button.textContent=provider?'▶ Предпросмотр · 8 сек':'Предпросмотр недоступен';button.disabled=!provider;button.setAttribute('aria-pressed','false');
    button.title=provider?'Загружается напрямую с '+provider.name+'. Если автор запретил встраивание, открой видео на сайте.':'Открой видео по ссылке на исходном сайте';card.append(button);
    if(!provider)return;
    function play(){
      stop();if(!wrap.isConnected)return;
      const frame=document.createElement('iframe');frame.src=provider.url;frame.title='Предпросмотр: '+item.title;frame.allow='autoplay; fullscreen';frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
      wrap.append(frame);button.textContent='■ Остановить';button.setAttribute('aria-pressed','true');active={frame,button};finish=setTimeout(stop,8000);
    }
    button.addEventListener('click',()=>active?.button===button?stop():play());
    card.addEventListener('pointerenter',event=>{if(event.pointerType!=='mouse'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;stop();armed=setTimeout(play,400);});
    card.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&(active?.button===button||armed))stop();});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('pagehide',stop);
  return {video,image,mount,stop};
})();
