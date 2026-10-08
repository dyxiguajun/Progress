import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import type {Card} from '../core/model';
import type {Snapshot} from '../core/sourceState';
import {contentFields,fitDisplayFields,type DisplayField} from '../core/display';
import {percentageText} from '../core/presentation';

export function ConfiguredContent({card,snapshot,now,centerIcon,density}:{card:Card;snapshot:Snapshot;now:number;centerIcon:ReactNode;density:string}){
  const fields=contentFields(card,snapshot,now,density),signature=JSON.stringify(fields),host=useRef<HTMLDivElement>(null),previous=useRef<string[]>([]),columns=useRef(1),[visible,setVisible]=useState<string[]>([]);
  useLayoutEffect(()=>{
    const node=host.current;if(!node)return;
    const measure=()=>{const width=node.clientWidth,height=node.clientHeight;const cols=columns.current===2?width<404?1:2:width>436?2:1;columns.current=cols;node.style.setProperty('--display-columns',String(cols));node.style.setProperty('--display-graphic-budget',`${Math.max(32,height-6)}px`);
      const probes=Array.from(node.querySelectorAll<HTMLElement>('.display-probe>.display-field')).map(el=>({id:el.dataset.field!,height:el.offsetHeight,width:Math.max(...Array.from(el.querySelectorAll<HTMLElement>('.display-atomic')).map(text=>text.scrollWidth),el.scrollWidth)}));
      const next=fitDisplayFields(probes,width,height,cols,previous.current);if(next.join('|')!==previous.current.join('|')){previous.current=next;setVisible(next);}
    };measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[signature,card.renderer,card.ringCenter]);
  const render=(field:DisplayField,probe=false)=><div key={field.id} data-field={field.id} className={`display-field display-${field.kind}`}>
    {field.items.map((item,index)=><div className="display-item" key={index}>
      {field.kind==='graphic'?(card.renderer==='ring'?<div className="ring" data-shared={probe?undefined:'primary-progress'}><svg className="ring-graphic" viewBox="0 0 120 120" role="img" aria-label={`${item.label} ${percentageText(item.ratio!)}%`}><g transform="rotate(-90 60 60)"><circle className="ring-track" cx="60" cy="60" r="49"/><circle className="ring-fill" cx="60" cy="60" r="49" strokeDasharray={`${item.ratio!*307.88} 307.88`}/></g></svg>{item.text?<span className="ring-number" data-shared={probe?undefined:'primary-value'}>{item.text.replace(/%$/,'')}<span>%</span></span>:card.displayPreferences?.fields.includes('icon')&&<span className="ring-center-icon" aria-hidden="true">{centerIcon}</span>}</div>:<><span className="display-graphic-label">{snapshot.quota?item.label:null}</span><div className="bar-track" data-shared={probe?undefined:`primary-progress-${index}`} role="progressbar" aria-label={item.label} aria-valuenow={item.ratio!*100} aria-valuemin={0} aria-valuemax={100}><div style={{width:`${item.ratio!*100}%`}}/></div></>)
        :<>{item.label&&<span className="display-field-label">{item.label}</span>}<span className="display-atomic" data-shared={!probe&&field.id==='value'?`primary-value-${index}`:undefined}>{item.text}</span></>}
    </div>)}
  </div>;
  return <div ref={host} className="configured-content" style={{'--accent':card.color} as React.CSSProperties}><div className="display-probe" aria-hidden="true" inert>{fields.map(field=>render(field,true))}</div><div className="display-visible">{fields.filter(field=>visible.includes(field.id)).map(field=>render(field))}</div></div>;
}
