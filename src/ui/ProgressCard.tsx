import { AlertCircle, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useRef } from 'react';
import { proportion,type Card, type Component, type Instance } from '../core/model';
import { sourceState, sourceStateLabels, type Snapshot } from '../core/sourceState';
import { codexRequest } from '../core/codex';
import { QuotaView } from './QuotaView';
import { ComponentIcon } from './shared';
import { dateText, duration, MetricView } from './MetricView';
import { CardFill } from './CardFill';
import { isCardBodyActivationTarget } from './activation';
import { useContinuousSurface } from './geometry';
import {ConfiguredContent} from './ConfiguredContent';
import {useCardContentGuard} from './useCardContentGuard';
import {metricLabel,percentageText} from '../core/presentation';

export function ProgressCard({ card, instance, component, snapshot, now, online, density = 'wide', editing = false, supported = true, onEdit, onDetails, onRetry, onLayout }: {
  card: Card; instance: Instance; component: Component; snapshot?: Snapshot; now: number; online: boolean;
  density?: string; editing?: boolean; supported?: boolean;
  onEdit: () => void; onDetails: () => void; onRetry: () => void; onLayout?: () => void;
}) {
  const surface=useRef<HTMLElement>(null);useContinuousSurface(surface,22);
  const metric = snapshot?.metrics.find(item => item.id === card.metricId);
  useCardContentGuard(surface,JSON.stringify([metric,snapshot?.quota,card.display,density]),!card.displayPreferences);
  const codex = ['codex_usage','provider_quota'].includes(component.manifest.runtime.type);
  const title = card.title ?? (!codex && metric && metric.id !== 'main' ? metric.name : instance.name);
  const state = sourceState(component, instance, snapshot, metric, now, online);
  const abnormal = !['fresh', 'refreshing', 'loading'].includes(state);
  const timestamp = metric?.observed_at ? Date.parse(metric.observed_at) : snapshot?.lastSuccess;
  const custom=card.displayPreferences?.fields,showIcon=custom?custom.includes('icon'):true,showTitle=custom?custom.includes('title'):card.display?.title!==false;
  const ratio=metric?proportion(metric,now):null;
  const description=metric?`${metricLabel(metric)} ${ratio===null?metric.value??'暂无数据':percentageText(ratio)+'%'}`:snapshot?.quota?.groups.flatMap(g=>g.windows.map(w=>`${w.label} ${w.remainingPercent===null?'暂不可用':percentageText(w.remainingPercent/100)+'% 剩余'}`)).join('，');
  return <article ref={surface} data-operation-source={card.id} tabIndex={0} aria-label={`${title}，${editing ? '调整布局' : '查看详情'}`} aria-description={description} className={`progress-card continuous-surface ${codex ? 'codex-card' : ''} ${card.renderer==='fill'?'surface-progress':''} layout-${density} ${abnormal ? 'has-warning' : ''} ${!showTitle ? 'hide-card-title' : ''}`} style={{ '--accent': card.color } as React.CSSProperties}
    onClick={event => { if (isCardBodyActivationTarget(event.target)&&window.getSelection()?.isCollapsed!==false) { if (editing) onLayout?.(); else onDetails(); } }}
    onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (editing) onLayout?.(); else onDetails(); } }}>
    {card.renderer==='fill'&&metric&&(!custom||custom.includes('progress'))&&<CardFill metric={metric} color={card.color} direction={card.fillDirection} now={now}/>}
    <header className={`card-header ${custom?'configured-header':''}`}><span className="card-icon" hidden={!showIcon} data-shared="card-icon" style={custom?{order:custom.indexOf('icon')}:undefined}><ComponentIcon component={component} icon={card.icon}/></span><h2 hidden={!showTitle} data-shared="card-title" style={custom?{order:custom.indexOf('title')}:undefined}>{title}</h2>
      {instance.demo && <span className="demo-label">示例</span>}
      <button className="icon-button card-config" aria-label={`编辑 ${title}`} title="编辑配置" onClick={onEdit}><MoreHorizontal size={20}/></button>
    </header>
    {!supported ? <div className="card-missing"><AlertCircle size={20}/><strong>当前空间无法显示</strong><button className="text-button" onClick={onDetails}>查看详情</button></div>
      : custom&&snapshot&&(metric||snapshot.quota)?<ConfiguredContent card={card} snapshot={snapshot} now={now} density={density} centerIcon={<ComponentIcon component={component} icon={card.icon} size={28}/>}/>
      : codex && snapshot?.quota ? <QuotaView usage={snapshot.quota} selected={card.quotaGroups} density={density} color={card.color} now={now} showResets={!abnormal && card.display?.reset !== false}/>
      : metric ? <MetricView metric={metric} renderer={card.renderer} color={card.color} now={now} density={density} display={card.display} ringCenter={card.ringCenter} centerIcon={<ComponentIcon component={component} icon={card.icon} size={28}/>} footerContent={component.manifest.runtime.type==='quota'?card.display?.reset!==false&&instance.config.reset?<span>{dateText(String(instance.config.reset),true)} 重置</span>:null:undefined}/>
      : <div className="card-missing">{state === 'loading' ? <RefreshCw className="spin" size={22}/> : <AlertCircle size={22}/>}<strong>{state === 'loading' ? '正在连接' : '暂无数据'}</strong>{state === 'loading' && <small>等待数据源响应</small>}</div>}
    {supported && abnormal && codex && <div className="quota-warning" role="status"><div><AlertCircle size={13}/><span>{sourceStateLabels[state]}{snapshot?.quota && <small> · {new Date(snapshot.lastSuccess!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 的数据</small>}</span></div><button className="text-button" disabled={snapshot?.loading} onClick={['auth-required', 'account-mismatch', 'incompatible'].includes(state) ? onEdit : () => { if(component.manifest.runtime.type==='codex_usage') void codexRequest('reconnect', 'POST').catch(() => {}).finally(onRetry); else onRetry(); }}>{['auth-required', 'account-mismatch', 'incompatible'].includes(state) ? '连接' : '重试'}</button></div>}
    {supported && abnormal && !codex && <div className="card-alert" role="status"><div><AlertCircle size={15}/><strong>{sourceStateLabels[state]}</strong></div>
      <p>{metric && timestamp ? (state === 'stale' ? `${duration((now - timestamp) / 1000)}前更新` : `保留 ${new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 的数据`) : state === 'permission-required' ? '网络连接尚未授权。' : '未获得可用数据。'}</p>
      <div className="card-recovery">{component.manifest.runtime.type === 'http' && instance.networkConsent && <button className="text-button" disabled={!!snapshot?.loading || !online} onClick={onRetry}>{snapshot?.loading ? '重试中…' : '重试'}</button>}<button className="text-button" onClick={onEdit}>编辑配置</button><button className="text-button" onClick={onDetails}>详情</button></div>
    </div>}
  </article>;
}
