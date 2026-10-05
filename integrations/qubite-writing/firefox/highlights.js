/* Shared by the addon and /writing. Paint only; never modify the editor's DOM. */
(() => {
 'use strict';
 const colors={spelling:'#fb7185',punctuation:'#fbbf24',grammar:'#38bdf8',style:'#c084fc'};
 function category(match){
  const rule=match.rule||{},kind=String(rule.issueType||'').toLowerCase(),id=String(rule.category?.id||'').toUpperCase();
  if(kind==='misspelling'||id.includes('TYPO'))return 'spelling';
  if(/PUNCT|CASING|CAPITAL/.test(id)||/punctuation|typographical/.test(kind))return 'punctuation';
  if(/STYLE|REDUNDANCY|COLLOQUIAL/.test(id)||/style|register/.test(kind))return 'style';
  return 'grammar';
 }
 class Marks {
  constructor(onIssue){
   this.onIssue=onIssue;this.rects=[];this.host=document.createElement('div');
   this.host.style.cssText='all:initial;position:fixed;top:0;left:0;pointer-events:none;z-index:2147483645';
   document.documentElement.append(this.host);this.root=this.host.attachShadow({mode:'closed'});
   this.layer=document.createElement('div');this.mirror=document.createElement('div');this.root.append(this.layer,this.mirror);
   this.mirror.style.cssText='all:initial;position:fixed;visibility:hidden;pointer-events:none;overflow:hidden;margin:0;box-sizing:border-box';
   this.refresh=()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});};
   addEventListener('scroll',this.refresh,true);addEventListener('resize',this.refresh);
   this.observer=new ResizeObserver(this.refresh);
   document.addEventListener('click',e=>{
    if(!this.target||!(e.target===this.target||this.target.contains(e.target)))return;
    if(this.target.isContentEditable?!getSelection()?.isCollapsed:this.target.selectionStart!==this.target.selectionEnd)return;
    const hit=this.rects.find(r=>e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom);
    if(hit)this.onIssue(hit.match,{left:hit.left,top:hit.top,bottom:hit.bottom},e);
   },true);
  }
  set(target,value,matches){
   this.observer.disconnect();this.target=target;this.value=value;
   this.matches=matches.filter(m=>Number.isInteger(m.offset)&&Number.isInteger(m.length)&&m.offset>=0&&m.length>=0&&m.offset+m.length<=value.length);
   this.observer.observe(target);this.render();
  }
  clear(){this.target=null;this.matches=[];this.rects=[];this.layer.replaceChildren();this.mirror.replaceChildren();this.observer.disconnect();}
  render(){
   this.layer.replaceChildren();this.rects=[];const e=this.target;
   if(!e?.isConnected||(e.isContentEditable?e.innerText:e.value)!==this.value){this.clear();return;}
   const box=e.getBoundingClientRect(),cs=getComputedStyle(e);
   if(!box.width||!box.height)return;
   const clip={left:Math.max(0,box.left+e.clientLeft),right:Math.min(innerWidth,box.left+e.clientLeft+e.clientWidth),top:Math.max(0,box.top+e.clientTop),bottom:Math.min(innerHeight,box.top+e.clientTop+e.clientHeight)};
   for(let parent=e.parentElement;parent&&parent!==document.documentElement;parent=parent.parentElement){const style=getComputedStyle(parent),r=parent.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(style.overflowX)){clip.left=Math.max(clip.left,r.left+parent.clientLeft);clip.right=Math.min(clip.right,r.left+parent.clientLeft+parent.clientWidth);}if(/hidden|clip|auto|scroll/.test(style.overflowY)){clip.top=Math.max(clip.top,r.top+parent.clientTop);clip.bottom=Math.min(clip.bottom,r.top+parent.clientTop+parent.clientHeight);}}
   let ranges=[];
   if(e.isContentEditable){
    this.mirror.replaceChildren();const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node,cursor=0;const nodes=[];
    while((node=walker.nextNode())){if(!node.textContent||!node.parentElement.getClientRects().length)continue;const start=this.value.indexOf(node.textContent,cursor);if(start<0)continue;nodes.push({node,start,end:start+node.length});cursor=start+node.length;}
    for(const match of this.matches){const length=match.length||1,start=nodes.find(n=>n.start<=match.offset&&n.end>match.offset),end=nodes.find(n=>n.start<match.offset+length&&n.end>=match.offset+length);if(!start||!end)continue;
     const r=document.createRange();r.setStart(start.node,match.offset-start.start);r.setEnd(end.node,match.offset+length-end.start);ranges.push({match,rects:[...r.getClientRects()]});}
   }else{
    for(const p of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing','wordSpacing','textTransform','textIndent','textAlign','direction','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth','borderStyle'])this.mirror.style[p]=cs[p];
    Object.assign(this.mirror.style,{left:box.left+'px',top:box.top+'px',width:(e.clientWidth+e.clientLeft+parseFloat(cs.borderRightWidth))+'px',height:box.height+'px',whiteSpace:e.tagName==='INPUT'||e.wrap==='off'?'pre':'pre-wrap',overflowWrap:e.tagName==='INPUT'?'normal':'break-word',display:e.tagName==='INPUT'?'flex':'block',alignItems:'center',borderColor:'transparent'});
    const content=document.createElement('div');content.style.cssText='margin:0;padding:0;border:0;min-width:0;flex:none';content.style.width='100%';
    content.style.transform=`translate(${-e.scrollLeft}px,${e.tagName==='INPUT'?0:-e.scrollTop}px)`;
    const node=document.createTextNode(this.value+'\u200b');content.append(node);this.mirror.replaceChildren(content);
    for(const match of this.matches){const r=document.createRange();r.setStart(node,match.offset);r.setEnd(node,match.offset+Math.max(1,match.length));ranges.push({match,rects:[...r.getClientRects()]});}
   }
   for(const {match,rects} of ranges)for(const r of rects){
    const left=Math.max(clip.left,r.left),right=Math.min(clip.right,r.right),top=Math.max(clip.top,r.top),bottom=Math.min(clip.bottom,r.bottom);
    if(right<=left||bottom<=top||r.bottom>clip.bottom+2)continue;
    const color=colors[category(match)],mark=document.createElement('div');
    mark.style.cssText=`position:fixed;pointer-events:none;left:${left}px;top:${bottom-2}px;width:${right-left}px;height:3px;border-bottom:2px dotted ${color};box-sizing:border-box`;
    mark.dataset.category=category(match);this.layer.append(mark);this.rects.push({left,right,top,bottom,match});
   }
  }
 }
 window.QubiteWritingMarks=Marks;window.QubiteWritingCategory=category;
})();
