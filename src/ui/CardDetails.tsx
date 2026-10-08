import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { refreshInterval, type Card, type Component, type Instance } from '../core/model';
import { sourceState, sourceStateLabels, type Snapshot } from '../core/sourceState';
import { templateUrl } from '../core/validation';
import { taskLabels, terminalTask } from '../core/presentation';
import { QuotaView } from './QuotaView';
import { MetricView } from './MetricView';
import { ComponentIcon, Modal } from './shared';
import { IconPicker } from './IconPicker';
import {metricText,secondaryOptions} from '../core/display';

export function CardDetails({ card, instance, component, snapshot, now, online, onClose, onEdit, onRetry, onChangeCard }: {
  card: Card; instance: Instance; component: Component; snapshot?: Snapshot; now: number; online: boolean;
  onClose: () => void; onEdit: () => void; onRetry: () => void; onChangeCard:(change:Partial<Card>)=>void;
}) {
  const codex=['codex_usage','provider_quota'].includes(component.manifest.runtime.type),usage=snapshot?.quota;
  const metric = snapshot?.metrics.find(item => item.id === card.metricId);
  const title = card.title ?? (!codex&&metric&&metric.id!=='main'?metric.name:instance.name);
  const [renaming,setRenaming]=useState(false),[draft,setDraft]=useState(title),[picker,setPicker]=useState(false);
  const titleButton=useRef<HTMLButtonElement>(null),titleInput=useRef<HTMLInputElement>(null),edited=useRef(false);
  useEffect(()=>{if(renaming){titleInput.current?.focus({preventScroll:true});titleInput.current?.select();}else if(edited.current){titleButton.current?.focus({preventScroll:true});edited.current=false;}},[renaming]);
  const commit=(restoreFocus=false)=>{if(draft.trim()&&draft.trim()!==title)onChangeCard({title:draft.trim()});edited.current=restoreFocus;setRenaming(false);};
  const runtime=component.manifest.runtime,network=runtime.type==='http';
  const state=sourceState(component,instance,snapshot,codex?undefined:metric,now,online);
  const timestamp=(value?:number|string)=>value?new Date(value).toLocaleString('zh-CN'):'尚未获取';
  const source=network?templateUrl(runtime.url,instance.config):runtime.type==='time_range'?'设备时间计算':runtime.type==='static'?'组件内置数据':codex?snapshot?.sourceDevice??'配额服务':'手动填写';
  const header=<span className="detail-identity">
    <button className="detail-icon icon-button" data-shared="card-icon" aria-label="更改卡片图标" onClick={()=>setPicker(true)} style={{color:card.color}}><ComponentIcon component={component} icon={card.icon} size={24}/></button>
    {renaming?<span className="inline-title"><input data-autofocus="" ref={titleInput} aria-label="卡片标题" value={draft} maxLength={100} onChange={e=>setDraft(e.target.value)} onBlur={()=>commit()} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commit(true);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();edited.current=true;setRenaming(false);}}}/></span>
      :<button ref={titleButton} className="detail-title" data-shared="card-title" title="点击修改标题" onClick={()=>{edited.current=false;setDraft(title);setRenaming(true);}}>{title}</button>}
  </span>;
  return <><Modal title={header} accessibleTitle={title} onClose={onClose}>
    <div className="modal-body details-body">
      {codex&&usage?<div className="detail-metric"><QuotaView usage={usage} color={card.color} now={now} details/></div>:metric?<div className="detail-metric"><MetricView metric={metric} renderer={card.renderer==='fill'?'bar':card.renderer} color={card.color} now={now} density="expanded" ringCenter={card.ringCenter} centerIcon={<ComponentIcon component={component} icon={card.icon} size={28}/>}/></div>:<p>尚未获取数据</p>}
      {snapshot?.error&&<div className="form-errors" role="alert">{snapshot.error}{(metric||usage)&&<p>正在显示最后一次成功获取的数据。</p>}</div>}
      <details className="advanced-details source-details" open={!['fresh','refreshing','loading'].includes(state)||undefined}><summary>连接与来源</summary><dl>
        <div><dt>连接状态</dt><dd>{sourceStateLabels[state]}</dd></div>
        {metric?.status&&<div><dt>任务状态</dt><dd>{taskLabels[metric.status]??metric.status}</dd></div>}
        {terminalTask(metric)&&<div><dt>记录</dt><dd>终态记录保留；连接状态独立显示。</dd></div>}
        <div><dt>来源</dt><dd>{source}</dd></div><div><dt>组件</dt><dd>{component.manifest.name}</dd></div>
        {usage&&<><div><dt>账户</dt><dd>{usage.account.maskedEmail} · {usage.account.plan}</dd></div><div><dt>采样时间</dt><dd>{timestamp(usage.observedAt)}</dd></div></>}
        {network&&<div><dt>刷新间隔</dt><dd>{refreshInterval(component,instance)} 秒</dd></div>}
        <div><dt>最近成功连接</dt><dd>{timestamp(snapshot?.lastSuccess)}</dd></div>
        {metric?.observed_at&&<div><dt>记录时间</dt><dd>{timestamp(metric.observed_at)}</dd></div>}
        {runtime.type==='quota'&&instance.config.reset&&<div><dt>重置时间</dt><dd>{timestamp(String(instance.config.reset))}</dd></div>}
        {metric?.stale_after!==undefined&&<div><dt>过期阈值</dt><dd>{metric.stale_after} 秒</dd></div>}
        {instance.demo&&<div><dt>示例</dt><dd>此卡片使用演示配置。</dd></div>}
        <div><dt>接收时间</dt><dd>{timestamp(snapshot?.receivedAt)}</dd></div>
      </dl></details>
      {metric&&<details className="advanced-details"><summary>完整指标记录</summary><pre className="metric-record">{JSON.stringify(metric,null,2)}</pre></details>}
      {(snapshot?.metrics.some(m=>m.id!==card.metricId)||!!metric?.secondary?.length)&&<details className="advanced-details"><summary>更多指标</summary><dl>{snapshot?.metrics.filter(m=>m.id!==card.metricId).map(m=><div key={m.id}><dt>{m.name}</dt><dd>{metricText(m)}</dd></div>)}{secondaryOptions(metric).map(option=><div key={option.id}><dt>{option.label}</dt><dd>{metricText({id:option.id,name:option.label,kind:'counter',value:option.source.value,unit:option.source.unit})}</dd></div>)}</dl></details>}
      <details className="advanced-details"><summary>组件信息</summary><dl><div><dt>作者</dt><dd>{component.manifest.author}</dd></div><div><dt>版本</dt><dd>{component.manifest.version}</dd></div><div><dt>组件 ID</dt><dd>{component.manifest.id}</dd></div><div><dt>指标 ID</dt><dd>{card.metricId}</dd></div></dl>{usage&&<pre className="metric-record">{JSON.stringify({version:usage.version,groups:usage.groups},null,2)}</pre>}</details>
    </div><div className="modal-actions"><button className="button secondary" onClick={onEdit}><Settings size={16}/>编辑配置</button>{network||codex?<button className="button primary" disabled={!!snapshot?.loading||network&&(!instance.networkConsent||!online)} onClick={onRetry}><RefreshCw size={16} className={snapshot?.loading?'spin':''}/>{snapshot?.loading?'刷新中…':'刷新'}</button>:<button className="button primary" onClick={onClose}>完成</button>}</div>
  </Modal>{picker&&<IconPicker current={card.icon??(component.manifest.runtime.type==='codex_usage'?'gpt':component.icon)} onClose={()=>setPicker(false)} onConfirm={icon=>{onChangeCard({icon});setPicker(false);}}/>}</>;
}
