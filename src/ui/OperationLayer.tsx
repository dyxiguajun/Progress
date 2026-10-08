import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { visibleSurface, type SurfaceRect } from '../core/motionGeometry';
import { applyContinuousGeometry } from './geometry';
import { motionTokens, useReducedMotion } from './motion';

type Phase='opening'|'open'|'closing';
export const OperationContext=createContext<{phase:Phase}|null>(null);
export const useOperation=()=>useContext(OperationContext);
type Kind='card'|'search'|'add';
const rectOf=(element:HTMLElement):SurfaceRect=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
const frameOf=(r:SurfaceRect)=>({left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
const valid=(element:HTMLElement|null)=>!!element?.isConnected&&visibleSurface(rectOf(element),{width:innerWidth,height:innerHeight});

// Shared shell and high-value elements; the source keeps receiving live data.
// Nothing depends on View Transitions support or on a provider transport.
export function OperationLayer({open,source,kind='card',mode,children,onClosed}:{open:boolean;source:string;kind?:Kind;mode?:string;children:ReactNode;onClosed?:()=>void}) {
  const [present,setPresent]=useState(open),[phase,setPhase]=useState<Phase>('opening');
  const reduced=useReducedMotion();
  const sourceSelector=useRef(source);if(open)sourceSelector.current=source;
  const retained=useRef(children);if(open)retained.current=children;
  const root=useRef<HTMLDialogElement>(null),shell=useRef<HTMLDivElement>(null),material=useRef<HTMLDivElement>(null),overlay=useRef<HTMLDivElement>(null),veil=useRef<HTMLDivElement>(null);
  const sourceNode=useRef<HTMLElement|null>(null),trigger=useRef<HTMLElement|null>(null),sourceState=useRef<{visibility:string;inert:boolean}>({visibility:'',inert:false});
  const animations=useRef<Animation[]>([]),restores=useRef<Array<()=>void>>([]),timer=useRef<ReturnType<typeof setTimeout>>(undefined),generation=useRef(0);
  const openRef=useRef(open);openRef.current=open;const closed=useRef(onClosed);closed.current=onClosed;
  const previousRect=useRef<SurfaceRect|null>(null),previousMode=useRef(mode);
  const localClosing=useRef(false);
  function clearMotion(commit=false) {
    clearTimeout(timer.current);generation.current++;
    animations.current.forEach(a=>{if(commit)try{a.commitStyles();}catch{/* already finished */}a.cancel();});animations.current=[];
    restores.current.splice(0).forEach(restore=>restore());overlay.current?.replaceChildren();
  }
  function releaseSource() {
    const node=sourceNode.current;if(node){node.style.visibility=sourceState.current.visibility;node.inert=sourceState.current.inert;}
  }
  function focusSurface() { const node=material.current; (node?.querySelector<HTMLElement>('[data-autofocus]')??node?.querySelector<HTMLElement>('input:not([disabled])')??node)?.focus({preventScroll:true}); }
  function finishClose() {
    releaseSource();setPresent(false);root.current?.close();
    const node=sourceNode.current;
    const fallback=['.search-trigger','.breadcrumb button','.folder-main[aria-current="page"]','.page-content'].map(selector=>document.querySelector<HTMLElement>(selector)).find(n=>n&&!n.closest('[inert]')&&valid(n));
    (valid(node)?node:valid(trigger.current)&&!trigger.current?.closest('[inert]')?trigger.current:fallback)?.focus({preventScroll:true});
    closed.current?.();
  }
  function localClose() {
    if(localClosing.current)return;localClosing.current=true;clearMotion(true);
    const token=generation.current,node=shell.current!,backdrop=veil.current!,style=getComputedStyle(backdrop);
    const from={opacity:style.opacity,backdropFilter:style.backdropFilter};
    backdrop.style.opacity='0';backdrop.style.backdropFilter='blur(0px)';
    animate(backdrop,[from,{opacity:0,backdropFilter:'blur(0px)'}],120);
    animate(node,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.97)'}],120);
    timer.current=setTimeout(()=>{if(token!==generation.current)return;clearMotion();finishClose();},120);
  }
  function naturalRect():SurfaceRect {
    const node=material.current!, frame=shell.current!;
    const wide=!!node.querySelector('.modal-content.wide'),width=Math.min(innerWidth-24,kind==='search'?680:kind==='add'?288:wide?860:660);
    const priorTransform=frame.style.transform,priorHeight=node.style.height;
    frame.style.transform='none';frame.style.width=`${width}px`;frame.style.height='auto';node.style.height='auto';
    // Include fractional pixels and material borders. scrollHeight loses both,
    // which otherwise creates a two-pixel jump at every DOM handoff.
    const height=Math.min(node.getBoundingClientRect().height,innerHeight-24);
    node.style.height=priorHeight;frame.style.transform=priorTransform;
    const sourceBounds=document.querySelector<HTMLElement>(sourceSelector.current)?.getBoundingClientRect();
    const left=kind==='add'&&sourceBounds?Math.max(12,Math.min(sourceBounds.right-width,innerWidth-width-12)):(innerWidth-width)/2;
    const top=kind==='search'?Math.min(96,Math.max(12,(innerHeight-height)/3)):kind==='add'&&sourceBounds?Math.max(12,Math.min(sourceBounds.top,innerHeight-height-12)):Math.max(12,(innerHeight-height)/2);
    return {left,top,width,height};
  }
  function place(rect:SurfaceRect){Object.assign(shell.current!.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,opacity:'1',transform:'none'});applyContinuousGeometry(material.current!,kind==='add'?18:24);}
  function animate(node:HTMLElement,frames:Keyframe[],duration:number,delay=0){const a=node.animate(frames,{duration,delay,easing:motionTokens.easeOut,fill:'both'});animations.current.push(a);return a;}
  function localRect(bounds:SurfaceRect,frame:SurfaceRect):SurfaceRect {return {...bounds,left:bounds.left-frame.left-material.current!.clientLeft,top:bounds.top-frame.top-material.current!.clientTop};}
  function copyPaint(original:HTMLElement) {
    const clone=original.cloneNode(true) as HTMLElement;
    const originals=[original,...original.querySelectorAll<HTMLElement>('*')],copies=[clone,...clone.querySelectorAll<HTMLElement>('*')];
    originals.forEach((n,i)=>{const computed=getComputedStyle(n);for(const name of computed)copies[i].style.setProperty(name,computed.getPropertyValue(name));copies[i].style.visibility='visible';});
    clone.removeAttribute('id');clone.removeAttribute('data-operation-source');clone.querySelectorAll('[id],[data-operation-source]').forEach(n=>{n.removeAttribute('id');n.removeAttribute('data-operation-source');});
    clone.setAttribute('aria-hidden','true');clone.inert=true;clone.tabIndex=-1;
    Object.assign(clone.style,{margin:'0',transform:'none',translate:'none',rotate:'none',scale:'none',transformOrigin:'0 0',pointerEvents:'none',visibility:'visible',animation:'none',transition:'none',minWidth:'0',minHeight:'0',maxWidth:'none',maxHeight:'none'});
    return clone;
  }
  function sourceExtras(source:HTMLElement,entering:boolean,duration:number,delay:number,startFrame:SurfaceRect,endFrame:SurfaceRect) {
    const clone=copyPaint(source),bounds=rectOf(source);clone.classList.add('shared-source-extras');
    Object.assign(clone.style,{position:'absolute',...frameOf(localRect(bounds,startFrame)),background:'transparent',borderColor:'transparent',boxShadow:'none',filter:'none'});
    // These elements already have their own moving copies. The remaining
    // labels, footers and controls crossfade instead of flashing at handoff.
    const sharedNames=new Set(Array.from(overlay.current!.children).map(n=>(n as HTMLElement).dataset.shared));
    clone.querySelectorAll<HTMLElement>('[data-shared]').forEach(n=>{if(sharedNames.has(n.dataset.shared)){const graphic=n.classList.contains('ring')?n.querySelector<HTMLElement>('.ring-graphic'):n;if(graphic)graphic.style.opacity='0';}n.removeAttribute('data-shared');});
    clone.querySelector<HTMLElement>('.card-fill')?.style.setProperty('opacity','0');
    overlay.current!.prepend(clone);
    animate(clone,[frameOf(localRect(bounds,startFrame)),frameOf(localRect(bounds,endFrame))],duration,delay);
    animate(clone,[{opacity:entering?1:0},{opacity:entering?0:1}],entering?90:duration*.45,entering?0:delay+duration*.55);
  }
  function shared(from:HTMLElement,to:HTMLElement,duration:number,startFrame:SurfaceRect,endFrame:SurfaceRect,delay=0) {
    const destinations=new Map(Array.from(to.querySelectorAll<HTMLElement>('[data-shared]')).map(n=>[n.dataset.shared,n]));
    for(const sharedNode of from.querySelectorAll<HTMLElement>('[data-shared]')) {
      const name=sharedNode.dataset.shared!,destinationNode=destinations.get(name);if(!destinationNode)continue;
      // Icons share their actual square SVG, rather than differently padded
      // button/header boxes. Rings share their SVG; the number is independent.
      const useSvg=name.includes('icon')||sharedNode.classList.contains('ring');
      const original=(useSvg?sharedNode.querySelector('svg'):sharedNode) as HTMLElement|null;
      const target=(useSvg?destinationNode.querySelector('svg'):destinationNode) as HTMLElement|null;
      if(!original||!target)continue;
      const graphicRect=(node:HTMLElement)=>{const bounds=rectOf(node);if(name!=='add-icon')return bounds;const s=getComputedStyle(node),width=parseFloat(s.width),height=parseFloat(s.height);return {left:bounds.left+(bounds.width-width)/2,top:bounds.top+(bounds.height-height)/2,width,height};};
      const a=localRect(graphicRect(original),startFrame),b=localRect(graphicRect(target),endFrame),style=getComputedStyle(original);
      if(a.width<3||a.height<3||b.width<3||b.height<3||style.display==='none'||style.clipPath.includes('50%'))continue;
      const clone=copyPaint(original);clone.dataset.shared=name;
      if(name==='card-title'||name==='search-input')Object.assign(clone.style,{overflow:'visible',textOverflow:'clip',whiteSpace:'nowrap',overflowWrap:'normal',wordBreak:'normal'});
      if(useSvg&&!sharedNode.classList.contains('ring')) {
        // Preserve the icon's inherited colour during motion instead of freezing
        // each path to the source's computed RGB value.
        const originals=[original,...original.querySelectorAll<HTMLElement>('*')];
        [clone,...clone.querySelectorAll<HTMLElement>('*')].forEach((node,index)=>{const paint=getComputedStyle(originals[index]);node.style.color='inherit';if(paint.stroke!=='none')node.style.stroke='currentColor';if(paint.fill!=='none')node.style.fill='currentColor';});
        clone.style.color=style.color;
        Object.assign(clone.style,{background:'transparent',backgroundImage:'none',boxShadow:'none',border:'0',outline:'0'});
      }
      Object.assign(clone.style,{position:'absolute',left:`${a.left}px`,top:`${a.top}px`,width:`${a.width}px`,height:`${a.height}px`,margin:'0',transformOrigin:'0 0',pointerEvents:'none',visibility:'visible'});
      const prior=target.style.visibility,sourceVisibility=original.style.visibility;
      target.style.visibility='hidden';original.style.visibility='hidden';
      restores.current.push(()=>{target.style.visibility=prior;original.style.visibility=sourceVisibility;});overlay.current!.append(clone);
      const graphic=useSvg||name.includes('progress');
      if(graphic){const fromAngle=Number(original.dataset.motionAngle??0),toAngle=Number(target.dataset.motionAngle??0);if(name==='add-icon')clone.style.transformOrigin='center';animate(clone,[{transform:`rotate(${fromAngle}deg)`,opacity:1,color:style.color},{transform:`translate(${b.left-a.left}px,${b.top-a.top}px) rotate(${toAngle}deg) scale(${b.width/a.width},${b.height/a.height})`,opacity:1,color:getComputedStyle(target).color}],duration,delay);}
      else {
        const typography=(s:CSSStyleDeclaration)=>({fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,color:s.color,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,textAlign:s.textAlign});
        const destinationStyle=getComputedStyle(target);animate(clone,[{...frameOf(a),...typography(style)},{...frameOf(b),...typography(destinationStyle)}],duration,delay);
        const destinationChildren=Array.from(target.querySelectorAll<HTMLElement>('span,small'));
        const unitTypography=(s:CSSStyleDeclaration)=>({...typography(s),marginLeft:s.marginLeft,marginRight:s.marginRight,verticalAlign:s.verticalAlign});
        Array.from(clone.querySelectorAll<HTMLElement>('span,small')).forEach((unit,index)=>{if(destinationChildren[index])animate(unit,[unitTypography(getComputedStyle(original.querySelectorAll('span,small')[index])),unitTypography(getComputedStyle(destinationChildren[index]))],duration,delay);});
      }
    }
  }
  function transition(entering:boolean) {
    localClosing.current=false;
    clearMotion(true);const token=generation.current;const frame=shell.current!,content=material.current!,currentFrame=rectOf(frame);
    setPhase(entering?'opening':'closing');
    const sourceElement=document.querySelector<HTMLElement>(sourceSelector.current),destination=naturalRect();
    const page=Array.from(content.querySelectorAll<HTMLElement>('.modal-content')).find(n=>!n.closest('.motion-outgoing'))??content;
    const from=entering&&valid(sourceElement)?rectOf(sourceElement!):currentFrame;
    place(destination);
    const canShare=valid(sourceElement)&&!reduced;
    const duration=reduced?120:entering?motionTokens.sharedOpen:motionTokens.sharedClose;
    const delay=!entering&&kind==='search'&&!reduced?motionTokens.contentCover:0;
    const targetRadius=kind==='add'?18:24,sourceRect=sourceElement?rectOf(sourceElement):destination;
    const sourceRadius=Math.min(parseFloat(sourceElement?getComputedStyle(sourceElement).borderRadius:'22')||22,sourceRect.width/2,sourceRect.height/2);
    animate(content,[{borderRadius:`${entering?sourceRadius:targetRadius}px`},{borderRadius:`${entering?targetRadius:sourceRadius}px`}],duration,delay);
    const surfaceShadow=getComputedStyle(frame).filter;
    const restingShadow=kind==='card'&&sourceElement?.closest('.grid-widget')?getComputedStyle(sourceElement.closest('.grid-widget')!).filter:'drop-shadow(0px 0px 0px #142c3200)';
    animate(frame,[{filter:entering?restingShadow:surfaceShadow},{filter:entering?surfaceShadow:restingShadow}],duration,delay);
    const backdrop=veil.current!,backdropStyle=getComputedStyle(backdrop);
    const priorBlur=backdropStyle.backdropFilter,priorOpacity=backdropStyle.opacity;
    const blur=getComputedStyle(document.documentElement).getPropertyValue('--modal-blur').trim()||'8px';
    Object.assign(backdrop.style,{opacity:entering?'1':'0',backdropFilter:entering?`blur(${kind==='add'?'3px':blur})`:'blur(0px)'});
    animate(backdrop,[{opacity:priorOpacity,backdropFilter:priorBlur},{opacity:entering?1:0,backdropFilter:entering?`blur(${kind==='add'?'3px':blur})`:'blur(0px)'}],duration,delay);
    const sourceFill=sourceElement?.querySelector<HTMLElement>('.card-fill');
    if(sourceFill&&canShare){const tint=sourceFill.cloneNode(true) as HTMLElement;tint.classList.add('continuous-surface');Object.assign(tint.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'2'});frame.append(tint);const observer=new ResizeObserver(()=>applyContinuousGeometry(tint,entering?24:22));observer.observe(tint);restores.current.push(()=>{observer.disconnect();tint.remove();});animate(tint,[{opacity:entering?1:0},{opacity:entering?0:1}],duration,delay);}
    if(entering) {
      if(sourceElement){sourceNode.current=sourceElement;sourceState.current={visibility:sourceElement.style.visibility,inert:sourceElement.inert};sourceElement.style.visibility='hidden';sourceElement.inert=true;}
      if(canShare){shared(sourceElement!,content,duration,from,destination);sourceExtras(sourceElement!,true,duration,0,from,destination);animate(frame,[{...frameOf(from)},{...frameOf(destination)}],duration);animate(content,[{backgroundColor:getComputedStyle(sourceElement!).backgroundColor},{backgroundColor:getComputedStyle(content).backgroundColor}],duration);}
      else animate(frame,[{opacity:0,transform:'scale(.985)'},{opacity:1,transform:'none'}],duration);
      animate(page,[{opacity:0},{opacity:0,offset:.45},{opacity:1}],duration);

    } else {
      const to=canShare?rectOf(sourceElement!):from;
      if(canShare){shared(content,sourceElement!,duration,from,to,delay);sourceExtras(sourceElement!,false,duration,delay,from,to);animate(frame,[{...frameOf(from),opacity:1},{...frameOf(to),opacity:1}],duration,delay);animate(content,[{backgroundColor:getComputedStyle(content).backgroundColor},{backgroundColor:getComputedStyle(sourceElement!).backgroundColor}],duration,delay);}
      else animate(frame,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.97)'}],duration,delay);
      animate(page,[{opacity:1},{opacity:0,offset:.45},{opacity:0}],duration,delay);
    }
    timer.current=setTimeout(()=>{
      if(token!==generation.current)return;
      clearMotion();
      if(entering){place(destination);previousRect.current=destination;setPhase('open');}
      else finishClose();
    },duration+delay);
  }
  useLayoutEffect(()=>{if(open){setPresent(true);if(present&&root.current?.open&&phase==='closing'){releaseSource();transition(true);}}else if(present&&root.current?.open)transition(false);},[open]);
  useLayoutEffect(()=>{
    if(!present||!open||root.current?.open)return;
    previousMode.current=mode;trigger.current=document.activeElement as HTMLElement;root.current!.showModal();place(naturalRect());transition(true);
  },[present,open]);
  useLayoutEffect(()=>{const node=material.current;if(!present||!node)return;const observer=new ResizeObserver(()=>applyContinuousGeometry(node,parseFloat(getComputedStyle(node).borderRadius)||24));observer.observe(node);return()=>observer.disconnect();},[present]);
  useLayoutEffect(()=>{if(present&&phase==='open')focusSurface();},[present,phase]);
  useLayoutEffect(()=>{
    if(!present||!open||!root.current?.open||previousMode.current===mode)return;
    previousMode.current=mode;clearMotion(true);setPhase('open');
    const before=previousRect.current??rectOf(shell.current!),after=naturalRect();place(after);
    if(!reduced)animate(shell.current!,[frameOf(before),frameOf(after)],motionTokens.surfaceResize);
    previousRect.current=after;focusSurface();
  },[mode]);
  useEffect(()=>{
    if(!present)return;
    let scheduled=0;
    const resize=()=>{cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(()=>{if(!openRef.current){localClose();return;}clearMotion();place(naturalRect());previousRect.current=rectOf(shell.current!);setPhase('open');});};
    window.addEventListener('resize',resize);
    const observer=new ResizeObserver(()=>{if(phase!=='open'||!openRef.current)return;const before=previousRect.current,after=naturalRect();place(after);if(before&&(Math.abs(before.height-after.height)>1||Math.abs(before.width-after.width)>1)&&!reduced)animate(shell.current!,[frameOf(before),frameOf(after)],motionTokens.surfaceResize);previousRect.current=after;});
    const content=Array.from(material.current?.querySelectorAll('.modal-content')??[]).find(node=>!node.closest('.motion-outgoing'));
    if(content){observer.observe(content);content.querySelectorAll('.editor-body .motion-active,.details-body>details').forEach(node=>observer.observe(node));}
    const sourceElement=sourceNode.current,initial=sourceElement?rectOf(sourceElement):null;
    const sourceObserver=new ResizeObserver(()=>{if(phase!=='closing'||!sourceElement||!initial)return;const current=rectOf(sourceElement);if(!valid(sourceElement)||Math.abs(initial.width-current.width)>2||Math.abs(initial.height-current.height)>2)localClose();});
    if(sourceElement)sourceObserver.observe(sourceElement);
    return()=>{observer.disconnect();sourceObserver.disconnect();window.removeEventListener('resize',resize);cancelAnimationFrame(scheduled);};
  },[present,phase,mode,reduced]);
  useEffect(()=>()=>{clearMotion();releaseSource();root.current?.close();},[]);
  useEffect(()=>{if(!present||!reduced)return;if(phase==='closing')localClose();else {clearMotion();place(naturalRect());setPhase('open');focusSurface();}},[reduced]);
  if(!present)return null;
  return <dialog ref={root} className={`operation-root operation-${kind}`} data-phase={phase} aria-label={kind==='card'?'卡片操作':kind==='search'?'搜索卡片':'添加'} onCancel={event=>{event.preventDefault();document.dispatchEvent(new Event('progress:request-close'));}}>
    <div ref={veil} className="operation-backdrop" aria-hidden="true" onClick={()=>document.dispatchEvent(new Event('progress:request-close'))}/>
    <div ref={shell} className="operation-shell"><div ref={material} className="operation-material continuous-surface" tabIndex={-1}><OperationContext.Provider value={{phase}}>{open?children:retained.current}</OperationContext.Provider><div ref={overlay} className="shared-elements" aria-hidden="true"/></div></div>
  </dialog>;
}
