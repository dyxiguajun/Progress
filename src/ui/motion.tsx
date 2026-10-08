import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
export const motionTokens = { pressFast: 90, sharedOpen: 360, sharedClose: 300, contentEnter: 180, contentCover: 70, wizardSlide: 240, searchExpand: 360, addExpand: 300, blurIn: 360, blurOut: 300, surfaceResize: 240, easeOut: 'cubic-bezier(.22,1,.36,1)', easeIn: 'cubic-bezier(.4,0,1,1)' };
export const EXIT_DURATION = 160;
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  return reduced;
}
export function usePresence(open: boolean) {
  const reduced = useReducedMotion(), [retained, setRetained] = useState(open);
  useEffect(() => { if (open) { setRetained(true); return; } const timer = setTimeout(() => setRetained(false), reduced ? 0 : EXIT_DURATION); return () => clearTimeout(timer); }, [open, reduced]);
  return { present: open || retained, closing: !open };
}
export function useRetained<T>(value: T | null | undefined) { const last = useRef(value); if (value != null) last.current = value; return value ?? last.current; }
export function usePageMotion(stage:string) {
  const ref=useRef<HTMLElement>(null),previous=useRef(stage),snapshot=useRef<HTMLElement|null>(null),animation=useRef<Animation|null>(null),exit=useRef<Animation|null>(null),reduced=useReducedMotion();
  const removeSnapshot=()=>{exit.current?.cancel();exit.current=null;snapshot.current?.remove();snapshot.current=null;};
  const capture=(next:string)=>{
    if(next===stage||!ref.current)return;
    removeSnapshot();
    const node=ref.current,bounds=node.getBoundingClientRect(),copy=node.cloneNode(true) as HTMLElement;
    copy.inert=true;copy.setAttribute('aria-hidden','true');copy.dataset.viewSnapshot='';copy.removeAttribute('id');
    copy.querySelectorAll('[id],[data-operation-source]').forEach(child=>{child.removeAttribute('id');child.removeAttribute('data-operation-source');});
    Object.assign(copy.style,{position:'fixed',left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`,margin:'0',pointerEvents:'none',overflow:'hidden',background:'var(--bg)',zIndex:'35'});
    node.parentElement?.append(copy);snapshot.current=copy;
    exit.current=copy.animate([{opacity:1,transform:'none'},{opacity:0,transform:reduced?'none':`translateX(${next==='settings'?-12:12}px)`}],{duration:reduced?120:240,easing:motionTokens.easeOut,fill:'both'});
    exit.current.finished.then(()=>{if(snapshot.current===copy)removeSnapshot();}).catch(()=>{});
  };
  useLayoutEffect(()=>{
    if(previous.current===stage)return;previous.current=stage;
    animation.current?.cancel();animation.current=ref.current?.animate([{opacity:0,transform:reduced?'none':`translateX(${stage==='settings'?12:-12}px)`},{opacity:1,transform:'none'}],{duration:reduced?120:240,easing:motionTokens.easeOut})??null;
  },[stage,reduced]);
  useEffect(()=>{const resized=()=>removeSnapshot();window.addEventListener('resize',resized);return()=>{window.removeEventListener('resize',resized);removeSnapshot();animation.current?.cancel();};},[]);
  return {ref,capture};
}
export function useVeilMotion(ref:RefObject<HTMLDivElement|null>,open:boolean) {
  const reduced=useReducedMotion();
  useLayoutEffect(()=>{
    const node=ref.current;if(!node)return;
    const current=getComputedStyle(node),from={opacity:current.opacity,backdropFilter:current.backdropFilter};
    const blur=getComputedStyle(document.documentElement).getPropertyValue('--context-blur').trim()||'8px';
    const to={opacity:open?1:0,backdropFilter:open?`blur(${blur})`:'blur(0px)'};
    Object.assign(node.style,{opacity:String(to.opacity),backdropFilter:to.backdropFilter});
    const animation=node.animate([from,to],{duration:reduced?1:open?motionTokens.blurIn:EXIT_DURATION,easing:motionTokens.easeOut,fill:'both'});
    return()=>{try{animation.commitStyles();}catch{/* detached or cancelled */}animation.cancel();};
  },[ref,open,reduced]);
}

export function MotionContent({stage,children}:{stage:number|string;children:ReactNode}) {
  const previous=useRef({stage,children}),[outgoing,setOutgoing]=useState<ReactNode>(null),[direction,setDirection]=useState('forward'),reduced=useReducedMotion();
  useLayoutEffect(()=>{
    const old=previous.current;previous.current={stage,children};
    if(old.stage===stage)return;
    setOutgoing(old.children);setDirection(typeof stage==='number'&&typeof old.stage==='number'&&stage<old.stage?'back':'forward');
    const timer=setTimeout(()=>setOutgoing(null),reduced?120:motionTokens.wizardSlide);return()=>clearTimeout(timer);
  },[stage]);
  useLayoutEffect(()=>{previous.current.children=children;});
  return <div className={`motion-content ${outgoing?'is-changing':''} direction-${direction}`}>
    {outgoing&&<div className="motion-outgoing" inert aria-hidden="true">{outgoing}</div>}
    <div key={stage} className="motion-active">{children}</div>
  </div>;
}

export function useToolbarMotion(editing: boolean) {
  type Phase = 'normal' | 'to-edit' | 'editing' | 'to-normal';
  const reduced = useReducedMotion(), [phase, setPhase] = useState<Phase>(editing ? 'editing' : 'normal');
  const phaseRef = useRef(phase); phaseRef.current = phase;
  useEffect(() => {
    if (reduced) { setPhase(editing ? 'editing' : 'normal'); return; }
    const previous = phaseRef.current;
    if (editing && previous === 'editing' || !editing && previous === 'normal') return;
    if (editing && previous === 'to-normal' || !editing && previous === 'to-edit') { setPhase(editing ? 'editing' : 'normal'); return; }
    setPhase(editing ? 'to-edit' : 'to-normal');
    const timer = setTimeout(() => setPhase(editing ? 'editing' : 'normal'), editing ? 280 : 160);
    return () => clearTimeout(timer);
  }, [editing, reduced]);
  return { phase, normal: phase === 'normal' || phase === 'to-edit', done: phase === 'editing' || phase === 'to-normal' };
}
