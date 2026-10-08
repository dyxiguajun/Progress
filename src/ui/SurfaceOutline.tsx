import { useLayoutEffect, useRef, useState } from 'react';
import { continuousPath } from './geometry';

// A single stroke follows the same superellipse as the card material. Keeping
// it outside the clipped card avoids overlapping CSS outlines at the corners.
export function SurfaceOutline({kind='focus'}:{kind?:'focus'|'group'}={}) {
  const ref=useRef<SVGSVGElement>(null),[size,setSize]=useState({width:0,height:0});
  useLayoutEffect(()=>{
    const parent=ref.current?.parentElement;if(!parent)return;
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(parent);return()=>observer.disconnect();
  },[]);
  const expansion=kind==='group'?20:8,width=size.width+expansion,height=size.height+expansion;
  return <svg ref={ref} className={kind==='group'?'group-ready-outline':'surface-outline'} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
    {size.width>0&&<path d={continuousPath(width-(kind==='group'?8:3),height-(kind==='group'?8:3),kind==='group'?28:24.5)} transform={kind==='group'?'translate(4 4)':'translate(1.5 1.5)'} fill="none" stroke="currentColor" strokeWidth={kind==='group'?8:2}/>}
  </svg>;
}
