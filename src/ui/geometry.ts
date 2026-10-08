import { useLayoutEffect, type RefObject } from 'react';

// A local superellipse approximation, not Apple's private corner geometry.
// One path is used by resting, moving and expanded surfaces.
export function continuousPath(width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2), points: string[] = [];
  const corners = [[width-r,r,-Math.PI/2,0],[width-r,height-r,0,Math.PI/2],[r,height-r,Math.PI/2,Math.PI],[r,r,Math.PI,Math.PI*1.5]];
  for (const [cx,cy,start,end] of corners) for (let i=0;i<=16;i++) {
    const angle=start+(end-start)*i/16;
    const power=(v:number)=>Math.sign(v)*Math.pow(Math.abs(v),2/4);
    points.push(`${(cx+r*power(Math.cos(angle))).toFixed(2)} ${(cy+r*power(Math.sin(angle))).toFixed(2)}`);
  }
  return `M${points.join(' L')} Z`;
}
export function applyContinuousGeometry(element: HTMLElement, radius: number) {
  element.style.setProperty('--surface-radius', `${radius}px`);
  if (CSS.supports('corner-shape', 'squircle')) return;
  const width=element.offsetWidth,height=element.offsetHeight;
  if(width>0&&height>0)element.style.setProperty('--surface-clip', `path('${continuousPath(width,height,radius)}')`);
}
export function useContinuousSurface<T extends HTMLElement>(ref:RefObject<T|null>, radius=22,active=true) {
  useLayoutEffect(()=>{
    const element=ref.current;if(!element||!active)return;
    const update=()=>applyContinuousGeometry(element,radius);update();
    const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();
  },[ref,radius,active]);
}
export function useContinuousChildren<T extends HTMLElement>(ref:RefObject<T|null>,selector:string,active=true) {
  useLayoutEffect(()=>{
    const root=ref.current;if(!root||!active)return;
    const seen=new Set<HTMLElement>();
    const paint=(node:HTMLElement)=>applyContinuousGeometry(node,parseFloat(getComputedStyle(node).borderRadius)||14);
    const resize=new ResizeObserver(entries=>entries.forEach(entry=>paint(entry.target as HTMLElement)));
    const scan=()=>root.querySelectorAll<HTMLElement>(selector).forEach(node=>{if(!seen.has(node)){seen.add(node);node.classList.add('continuous-surface');paint(node);resize.observe(node);}});
    scan();const mutation=new MutationObserver(scan);mutation.observe(root,{childList:true,subtree:true});
    return()=>{resize.disconnect();mutation.disconnect();};
  },[ref,selector,active]);
}
