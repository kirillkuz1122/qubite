const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function context(){
 let timers=new Map(),seq=0;
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attributes={};this.isConnected=true;}
  append(child){this.children.push(child);child.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.isConnected=false;}
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return k==='src'?this.src:this.attributes[k];}
  addEventListener(k,v){this.events[k]=v;}
 }
 const document={hidden:false,events:{},createElement:t=>new Element(t),addEventListener(k,v){this.events[k]=v;}};
 const c=vm.createContext({URL,document,window:{addEventListener(){}},matchMedia:()=>({matches:false}),setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync('services/search/static/search-tools.js','utf8')+'\nthis.media=QubiteMedia;',c);
 return {media:c.media,document,Element,tick(){const [id,fn]=timers.entries().next().value||[];if(fn){timers.delete(id);fn();}}};
}
test('Players accept exact hosts and validated IDs only',()=>{
 const {media}=context();assert.ok(media.video('https://youtu.be/WBLpaS86Z9c').url.startsWith('https://www.youtube-nocookie.com/embed/'));
 assert.ok(media.video('https://vimeo.com/1234'));
 for(const url of ['https://youtube.com.evil.org/watch?v=WBLpaS86Z9c','javascript:alert(1)','https://evil.org/video.mp4','https://youtube.com/watch?v=../evil','https://user:pass@youtube.com/watch?v=WBLpaS86Z9c'])assert.equal(media.video(url),null);
});
test('Preview is lazy, single, stops on leave, timeout and background',()=>{
 const c=context(),a=new c.Element('article'),b=new c.Element('article');const item={url:'https://youtu.be/WBLpaS86Z9c',title:'Video'};
 c.media.mount(a,item);c.media.mount(b,item);
 assert.equal(a.children[0].children.filter(x=>x.tag==='iframe').length,0);
 a.events.pointerenter({pointerType:'mouse'});c.tick();assert.equal(a.children[0].children.at(-1).tag,'iframe');assert.equal(a.children[0].children.at(-1).referrerPolicy,'strict-origin-when-cross-origin');
 b.children[1].events.click();assert.equal(a.children[0].children.some(x=>x.tag==='iframe'),false);assert.equal(b.children[0].children.at(-1).tag,'iframe');
 b.events.pointerleave({pointerType:'mouse'});assert.equal(b.children[0].children.some(x=>x.tag==='iframe'),false);
 a.children[1].events.click();c.tick();assert.equal(a.children[0].children.some(x=>x.tag==='iframe'),false);
 a.children[1].events.click();c.document.hidden=true;c.document.events.visibilitychange();assert.equal(a.children[0].children.some(x=>x.tag==='iframe'),false);
});
test('Images load directly with no referrer, fall back once, HTTP uses proxy',()=>{
 const {media,Element}=context(),img=new Element('img');media.image(img,'https://example.org/image.jpg');assert.equal(img.src,'https://example.org/image.jpg');assert.equal(img.referrerPolicy,'no-referrer');img.events.error();assert.ok(img.src.startsWith('/api/image?'));img.events.error();assert.equal(img.hidden,true);
 const http=new Element('img');media.image(http,'http://example.org/image.jpg');assert.ok(http.src.startsWith('/api/image?'));
 const proxy=new Element('img');media.image(proxy,'https://example.org/image.jpg',false);assert.ok(proxy.src.startsWith('/api/image?'));
});
