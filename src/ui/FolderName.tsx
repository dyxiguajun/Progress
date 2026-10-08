import {useLayoutEffect,useRef} from 'react';
export function FolderName({name}:{name:string}) {
  const ref=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{const node=ref.current!;const measure=()=>{const overflow=Math.max(0,node.firstElementChild!.scrollWidth-node.clientWidth);node.style.setProperty('--name-overflow',`${overflow}px`);node.dataset.overflow=String(overflow>1);};measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[name]);
  return <span ref={ref} className="folder-label"><span className="folder-name">{name}</span></span>;
}
