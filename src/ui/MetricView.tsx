import { ArrowUpRight, Clock3, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { compatibleRenderers, proportion, type Card, type Metric, type Renderer } from '../core/model';
import { numberText, percentageText, metricLabel, formatQuantity, formatRange } from '../core/presentation';

export const number = numberText;
export const dateText = (value: string, withTime = false) => new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
export function duration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  if (total >= 86400) return `${Math.ceil(total / 86400)} 天`;
  if (total >= 3600) return `${Math.floor(total / 3600)} 小时 ${Math.floor(total % 3600 / 60)} 分`;
  if (total >= 60) return `${Math.floor(total / 60)} 分 ${total % 60} 秒`;
  return `${total} 秒`;
}
export function MetricView({ metric, renderer, color, now, density = 'large', display,footerContent,ringCenter='auto',centerIcon }: { metric: Metric; renderer: Renderer; color: string; now: number; density?: string; display?: Card['display'];footerContent?:ReactNode;ringCenter?:Card['ringCenter'];centerIcon?:ReactNode }) {
  const ratio = proportion(metric, now), percent = percentageText(metric.kind === 'range' ? (Number(metric.value) - (metric.min ?? 0)) / (metric.max! - (metric.min ?? 0)) : ratio ?? 0);
  const graphicPercent = (ratio ?? 0) * 100;
  const actualRenderer = compatibleRenderers(metric).includes(renderer) ? renderer : 'number';
  const iconCenter=!!centerIcon&&(ringCenter==='icon'||ringCenter==='auto'&&density==='compact');
  const isTime = metric.kind === 'time_range';
  const done = isTime && metric.end ? now >= Date.parse(metric.end) : metric.status === 'completed';
  const quantity = typeof metric.value === 'number' ? formatQuantity(metric.value, metric.unit) : null;
  const headline = isTime ? (metric.start ? `${percent}` : done ? '已到达' : `${Math.ceil((Date.parse(metric.end!) - now) / 86400000)}`)
    : quantity ? quantity.value : metric.value ?? '—';
  const suffix = isTime ? (metric.start ? '%' : done ? '' : '天') : quantity?.unit ?? '';
  const label = isTime ? metric.start ? '时间已过' : done ? '目标时间已到' : '还有' : metricLabel(metric);
  const percentOnly = metric.unit === '%' && metric.max === 100 && (metric.min ?? 0) === 0;
  const fraction = ['bar','fill'].includes(actualRenderer) && metric.kind === 'range';
  const footer=display?.details!==false&&density!=='compact'?<div className="metric-details">
    {isTime && metric.start ? <span>{dateText(metric.end!)} · {done ? '已结束' : `剩余 ${duration((Date.parse(metric.end!) - now) / 1000)}`}</span>
      : isTime ? <span><Clock3 size={13}/>{dateText(metric.end!, true)}</span>
      : metric.kind === 'range' && actualRenderer !== 'ring' ? <><span>{formatRange(metric)}</span>{Number(metric.value)>metric.max!&&<span>已超出范围</span>}{metric.meaning==='used'&&<span>可用 {formatQuantity(Math.max(0,metric.max!-Number(metric.value)),metric.unit).value} {formatQuantity(Math.max(0,metric.max!-Number(metric.value)),metric.unit).unit}</span>}</>
      : metric.kind === 'indeterminate' ? <span><LoaderCircle size={14}/>总量尚未确定</span>:null}
  </div>:null;
  return <div className={`metric-view renderer-${actualRenderer}`} style={{ '--accent': color } as React.CSSProperties}>
    {actualRenderer === 'ring' && ratio !== null ? <div className={`ring-layout ${iconCenter?'ring-with-icon':''}`}><div className="ring-figure"><div className="ring" data-shared="primary-progress">
      <svg className="ring-graphic" viewBox="0 0 120 120" role="img" aria-label={`${label} ${percent}%`}><g transform="rotate(-90 60 60)"><circle className="ring-track" cx="60" cy="60" r="49"/><circle className="ring-fill" cx="60" cy="60" r="49" strokeDasharray={`${ratio * 307.88} 307.88`}/></g></svg>
      {iconCenter?<span className="ring-center-icon" data-shared="ring-center-icon" aria-hidden="true">{centerIcon}</span>:<div className="ring-number" data-shared="primary-value">{percent}<span>%</span></div>}
    </div>{iconCenter&&<div className="ring-below-value" data-shared="primary-value">{percent}<span>%</span></div>}</div><div className="ring-caption">{display?.status !== false && <span className="metric-label">{label}</span>}{display?.details !== false && <><strong>{isTime ? duration((Date.parse(metric.end!) - now) / 1000) : percentOnly ? `总量 ${number(metric.max!)}%` : `${headline} ${suffix}`}</strong>
      {!percentOnly && <small>{isTime ? '距结束' : `共 ${formatQuantity(metric.max!, metric.unit).value} ${formatQuantity(metric.max!, metric.unit).unit}`}</small>}</>}</div></div>
      : <>{display?.status !== false && <div className="metric-label">{label}</div>}<div className="metric-headline" data-shared="primary-value">{fraction ? percent : headline}<span>{fraction ? '%' : suffix}</span></div></>}
    {display?.secondary !== false && ['large', 'expanded', 'tall'].includes(density) && !!metric.secondary?.length && <div className="secondary">{metric.secondary.slice(0, 2).map((secondary, index) => <span key={index}>
      {secondary.role === 'eta' ? <Clock3 size={13}/> : <ArrowUpRight size={13}/>}
      {secondary.role === 'eta' ? `约 ${duration(secondary.value)}` : `${formatQuantity(secondary.value, secondary.unit).value} ${formatQuantity(secondary.value, secondary.unit).unit}`}
    </span>)}</div>}
    {actualRenderer==='bar'&&ratio!==null&&<div className="bar-track" data-shared="primary-progress" role="progressbar" aria-label={metric.name} aria-valuenow={graphicPercent} aria-valuemin={0} aria-valuemax={100}><div style={{width:`${graphicPercent}%`}}/></div>}
    <div className="metric-footer">{footerContent===undefined?footer:footerContent&&<div className="metric-details">{footerContent}</div>}</div>
  </div>;
}
