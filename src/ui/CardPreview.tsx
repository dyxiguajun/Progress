import {useLayoutEffect,useRef,useState} from 'react';
import type {Card,Component,Instance,LayoutVariant} from '../core/model';
import type {Snapshot} from '../core/sourceState';
import {variantDensity} from '../core/grid';
import {ProgressCard} from './ProgressCard';
export function CardPreview({card,component,instance,snapshot,variant,now}:{card:Card;component:Component;instance:Instance;snapshot:Snapshot;variant:LayoutVariant;now:number}){
  const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(180),span=variant.span;
  useLayoutEffect(()=>{const node=ref.current;if(!node)return;const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(node);return()=>observer.disconnect();},[]);
  const cell=(width-(span.columns-1)*16)/span.columns,height=cell*span.rows+(span.rows-1)*16;
  return <div ref={ref} style={{maxWidth:span.columns*180+(span.columns-1)*16}}><div className="grid-slot preview-grid-slot" style={{height}}><div className="grid-widget"><ProgressCard card={card} component={component} instance={instance} snapshot={snapshot} now={now} online density={variantDensity(span)} onEdit={()=>{}} onDetails={()=>{}} onRetry={()=>{}}/></div></div></div>;
}
