import {proportion,type Card,type Metric} from './model';
import {formatQuantity,formatRange,metricLabel,percentageText} from './presentation';
import type {Snapshot} from './sourceState';

export type DisplayOption={id:string;label:string};
export type DisplayField={id:string;kind:'value'|'text'|'graphic';items:{label?:string;text?:string;ratio?:number}[]};
const basic:DisplayOption[]=[{id:'icon',label:'图标'},{id:'title',label:'名称'},{id:'value',label:'主数值 / 百分比'},{id:'progress',label:'进度条 / 圆环 / 填充'},{id:'status',label:'状态 / 数值含义'},{id:'details',label:'当前值 / 总量与说明'},{id:'reset',label:'重置时间'},{id:'updated',label:'观测时间'}];
export function secondaryOptions(metric?:Metric){const seen=new Map<string,number>();return (metric?.secondary??[]).map(s=>{const occurrence=seen.get(s.role)??0;seen.set(s.role,occurrence+1);return {id:`secondary:${s.id??`${s.role}:${occurrence}`}`,label:s.label??({eta:'预计时间',speed:'速度'}[s.role]??s.role),source:s};});}
export function displayOptions(card:Card,metric?:Metric,metrics:Metric[]=[],quota=false):DisplayOption[]{return [...basic.filter(o=>quota?!['status','details'].includes(o.id):!['reset'].includes(o.id)||!!metric?.reset_at),...(quota?[{id:'credits',label:'余额'},{id:'account',label:'账户'}]:secondaryOptions(metric)),...metrics.filter(m=>m.id!==card.metricId).map(m=>({id:`metric:${m.id}`,label:m.name})),...(card.displayPreferences?.fields??[]).filter(id=>!basic.some(o=>o.id===id)&&!['credits','account'].includes(id)&&!secondaryOptions(metric).some(o=>o.id===id)&&!metrics.some(m=>`metric:${m.id}`===id)).map(id=>({id,label:`${id.replace(/^(metric|secondary):/,'')}（暂不可用）`}))];}
export function defaultDisplayFields(card:Card,metric?:Metric,quota=false){return ['icon',...(card.display?.title!==false?['title']:[]),...(card.display?.status!==false&&!quota?['status']:[]),'value',...(card.renderer!=='number'?['progress']:[]),...(!quota&&card.display?.details!==false?['details']:[]),...(card.display?.reset!==false&&(quota||!!metric?.reset_at)?['reset']:[]),...(quota?['credits','account']:card.display?.secondary!==false?secondaryOptions(metric).slice(0,2).map(s=>s.id):[])];}
export function selectedDisplayFields(card:Card,metric?:Metric,quota=false){return card.displayPreferences?.fields??defaultDisplayFields(card,metric,quota);}
export function metricText(metric:Metric){if(typeof metric.value==='number'){const quantity=formatQuantity(metric.value,metric.unit);return `${quantity.value}${quantity.unit?' '+quantity.unit:''}`;}return metric.value??'—';}
export function contentFields(card:Card,snapshot:Snapshot,now:number,density='large'):DisplayField[]{
  const metric=snapshot.metrics.find(m=>m.id===card.metricId),quota=snapshot.quota,selected=selectedDisplayFields(card,metric,!!quota),fields:DisplayField[]=[];
  const valueInRing=!quota&&card.renderer==='ring'&&selected.includes('value')&&selected.includes('progress')&&(card.ringCenter==='value'||card.ringCenter!=='icon'&&density!=='compact');
  const push=(id:string,kind:DisplayField['kind'],items:DisplayField['items'])=>{if(items.length)fields.push({id,kind,items});};
  const windows=quota?.groups.filter(g=>!card.quotaGroups||card.quotaGroups.includes(g.id)).flatMap(g=>g.windows.map(w=>({label:quota.groups.length>1?`${g.name} · ${w.label}`:w.label,w})))??[];
  for(const id of selected){
    if(id==='icon'||id==='title')continue;
    if(id==='value'){
      if(quota)push(id,'value',windows.map(({label,w})=>({label,text:w.remainingPercent===null?'暂不可用':`${percentageText(w.remainingPercent/100)}% 剩余`})));
      else if(metric){const ratio=proportion(metric,now);const text=ratio!==null&&(card.renderer!=='number'||metric.kind==='time_range'&&!!metric.start)?`${percentageText(ratio)}%`:metric.kind==='time_range'?metric.end&&now>=Date.parse(metric.end)?'已到达':`${Math.ceil((Date.parse(metric.end!)-now)/86400000)} 天`:String(metricText(metric));push(id,valueInRing&&ratio!==null?'graphic':'value',[{text,...(valueInRing&&ratio!==null?{ratio,label:metric.name}:{})}]);}
    }else if(id==='progress'){
      if(card.renderer==='number'||card.renderer==='fill'||valueInRing)continue;
      if(quota)push(id,'graphic',windows.filter(({w})=>w.remainingPercent!==null).map(({label,w})=>({label,ratio:w.remainingPercent!/100})));
      else if(metric){const ratio=proportion(metric,now);if(ratio!==null)push(id,'graphic',[{label:metric.name,ratio}]);}
    }else if(id==='status'&&metric)push(id,'text',[{text:metricLabel(metric)}]);
    else if(id==='details'&&metric){const text=metric.kind==='range'?formatRange(metric):metric.kind==='time_range'&&metric.end?new Date(metric.end).toLocaleString('zh-CN'):undefined;if(text)push(id,'text',[{text}]);}
    else if(id==='reset'){if(quota)push(id,'text',windows.filter(({w})=>w.resetsAt).map(({label,w})=>({label,text:`${new Date(w.resetsAt!*1000).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} 重置`})));else if(metric?.reset_at)push(id,'text',[{text:`${new Date(metric.reset_at).toLocaleString('zh-CN')} 重置`}]);}
    else if(id==='credits'&&quota)push(id,'text',quota.groups.filter(g=>g.credits&&(g.credits.unlimited||g.credits.balance!==null)).map(g=>({label:g.name,text:g.credits!.unlimited?'不限额':`${formatQuantity(g.credits!.balance!,'credits').value} credits`})));
    else if(id==='account'&&quota)push(id,'text',[{text:`${quota.account.maskedEmail} · ${quota.account.plan}`}]);
    else if(id==='updated'){const timestamp=metric?.observed_at??quota?.observedAt;if(timestamp)push(id,'text',[{label:'观测时间',text:new Date(timestamp).toLocaleString('zh-CN')}]);}
    else if(id.startsWith('metric:')){const auxiliary=snapshot.metrics.find(m=>m.id===id.slice(7));if(auxiliary)push(id,'text',[{label:auxiliary.name,text:String(metricText(auxiliary))}]);}
    else if(id.startsWith('secondary:')){const option=secondaryOptions(metric).find(o=>o.id===id);if(option)push(id,'text',[{label:option.label,text:String(metricText({id:option.id,name:option.label,kind:'counter',value:option.source.value,unit:option.source.unit}))}]);}
  }
  return fields;
}
// Sizes come from rendered probes. Whole fields are selected without changing saved preferences.
export function fitDisplayFields(measured:{id:string;height:number;width:number}[],width:number,height:number,columns=1,previous:string[]=[]){
  const selected:string[]=[],rows:number[]=[];const cell=(width-(columns-1)*12)/columns;
  for(const field of measured){if(field.width>cell+1||!Number.isFinite(field.height))continue;const index=selected.length,row=Math.floor(index/columns),next=[...rows];next[row]=Math.max(next[row]??0,field.height);const required=next.reduce((a,b)=>a+b,0)+Math.max(0,next.length-1)*8;
    if(required+(previous.includes(field.id)?0:6)<=height){selected.push(field.id);rows.splice(0,rows.length,...next);}
  }
  return selected;
}
