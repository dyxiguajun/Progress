import {useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {MoreHorizontal} from 'lucide-react';
import {proportion,type Card,type Workspace} from '../core/model';
import {groupPresentation,groupIsSimple,type CardGroup} from '../core/cardGroups';
import {sourceState,sourceStateLabels,type Snapshot} from '../core/sourceState';
import {formatQuantity,metricLabel,percentageText} from '../core/presentation';
import {ComponentIcon} from './shared';
import {isCardBodyActivationTarget} from './activation';
import {useContinuousSurface} from './geometry';

export function GroupMetrics({group,workspace,snapshots,now,online,density='large',detailed=false,onMember}:{group:CardGroup;workspace:Workspace;snapshots:Record<string,Snapshot>;now:number;online:boolean;density?:string;detailed?:boolean;onMember?:(card:Card)=>void}) {
  const simple=groupIsSimple(group,workspace);
  const items=group.cardIds.flatMap(id=>{
    const card=workspace.cards.find(c=>c.id===id)!;
    const instance=workspace.instances.find(i=>i.id===card.instanceId)!;
    const component=workspace.components.find(c=>c.manifest.id===instance.componentId)!;
    const snapshot=snapshots[instance.id],metric=snapshot?.metrics.find(m=>m.id===card.metricId);
    const state=sourceState(component,instance,snapshot,metric,now,online),title=card.title??metric?.name??instance.name;
    if(card.renderer==='quota'&&snapshot?.quota) {
      return snapshot.quota.groups.filter(g=>!card.quotaGroups||card.quotaGroups.includes(g.id)).flatMap(g=>g.windows.map(w=>({card,component,key:`${id}-${w.metricId}`,label:`${title} · ${w.label}`,ratio:w.remainingPercent===null?null:w.remainingPercent/100,meaning:'剩余',state,text:undefined as string|undefined})));
    }
    return [{card,component,key:id,label:title,ratio:metric?proportion(metric,now):null,meaning:metric?metricLabel(metric):'暂无数据',state,text:typeof metric?.value==='number'?`${formatQuantity(metric.value,metric.unit).value}${formatQuantity(metric.value,metric.unit).unit?' '+formatQuantity(metric.value,metric.unit).unit:''}`:typeof metric?.value==='string'?metric.value:metric?.kind==='time_range'&&metric.end?now>=Date.parse(metric.end)?'已到达':`${Math.ceil((Date.parse(metric.end)-now)/86400000)} 天`:undefined}];
  });
  const container=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:density==='tall'?170:density==='wide'?340:340,height:density==='compact'?160:density==='wide'?160:340});
  useLayoutEffect(()=>{const node=container.current;if(!node)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(node);return()=>observer.disconnect();},[]);
  const plan=group.style==='bars'?{columns:1,visible:detailed?items.length:Math.min(items.length,Math.max(1,Math.floor(size.height/82))),ringSize:0}:groupPresentation(size.width,size.height,items.length,detailed,!simple),shown=items.slice(0,plan.visible);
  return <><div ref={container} style={{'--group-columns':group.style==='bars'?1:plan.columns,'--group-ring-size':`${plan.ringSize}px`,'--group-peek-type':plan.ringSize<72?'var(--type-footnote)':'var(--type-title2)'} as CSSProperties} className={`group-metrics group-${group.style} ${simple?'group-values-hidden':''} ${density==='compact'?'group-compact':''}`}>
    {shown.map(item=><button className={`group-member ${!['fresh','refreshing','loading'].includes(item.state)?'has-warning':''}`} key={item.key} type="button" style={{'--accent':item.card.color} as CSSProperties} title={`${item.label} · ${sourceStateLabels[item.state]}`} aria-label={`${item.label}，${item.ratio===null?(item.text??'暂无数值'):percentageText(item.ratio)+'% '+item.meaning}，${sourceStateLabels[item.state]}`} onClick={()=>onMember?.(item.card)}>
      {group.style==='rings'?<div className="group-ring"><svg viewBox="0 0 120 120" aria-hidden="true" data-shared={`group-progress-${item.key}`}><g transform="rotate(-90 60 60)"><circle className="ring-track" cx="60" cy="60" r="49"/>{item.ratio!==null&&<circle className="ring-fill" cx="60" cy="60" r="49" strokeDasharray={`${Math.max(0,Math.min(1,item.ratio))*307.88} 307.88`}/>}</g></svg><span className="group-peek-icon"><ComponentIcon component={item.component} icon={item.card.icon} size={28}/></span>{simple&&<span className="group-peek-value" data-shared={`group-value-${item.key}`}>{item.ratio===null?(item.text??'—'):percentageText(item.ratio)}</span>}</div>:<span className="group-member-icon"><span className="group-peek-icon"><ComponentIcon component={item.component} icon={item.card.icon} size={20}/></span>{simple&&<span className="group-peek-value" data-shared={`group-value-${item.key}`}>{item.ratio===null?(item.text??'—'):percentageText(item.ratio)}</span>}</span>}
      {!simple&&<strong data-shared={`group-value-${item.key}`}>{item.ratio===null?(item.text??'—'):<>{percentageText(item.ratio)}<small>%</small></>}</strong>}
      {group.style==='bars'&&<div className="bar-track" data-shared={`group-progress-${item.key}`}><div style={{width:`${Math.max(0,Math.min(1,item.ratio??0))*100}%`}}/></div>}
      <span className="group-member-label">{item.label}</span>
    </button>)}
  </div>{!items.length&&<p className="form-hint">所选指标暂不可用，打开组合可编辑成员配置。</p>}{shown.length<items.length&&<small className="group-more">另 {items.length-shown.length} 项 · 查看组合</small>}</>;
}
export function GroupCard({group,workspace,snapshots,now,online,density,editing,onOpen,onLayout,onMember}:{group:CardGroup;workspace:Workspace;snapshots:Record<string,Snapshot>;now:number;online:boolean;density:string;editing:boolean;onOpen:()=>void;onLayout:()=>void;onMember:(card:Card)=>void}) {
  const surface=useRef<HTMLElement>(null);useContinuousSurface(surface,22);
  return <article ref={surface} data-operation-source={group.cardIds[0]} tabIndex={0} className={`progress-card continuous-surface group-card layout-${density}`} aria-label={`${group.name}，${group.cardIds.length} 张卡片`} onClick={event=>{if(isCardBodyActivationTarget(event.target)){if(editing)onLayout();else onOpen();}}} onKeyDown={event=>{if(event.target===event.currentTarget&&['Enter',' '].includes(event.key)){event.preventDefault();if(editing)onLayout();else onOpen();}}}>
    {editing&&<button className="icon-button group-config" aria-label={`编辑 ${group.name}`} onClick={onOpen}><MoreHorizontal size={20}/></button>}
    <GroupMetrics group={group} workspace={workspace} snapshots={snapshots} now={now} online={online} density={density} onMember={editing?undefined:onMember}/>
  </article>;
}
