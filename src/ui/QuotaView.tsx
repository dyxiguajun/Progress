import type { CodexUsage, QuotaGroup, QuotaWindow } from '../core/codex';
import { dateText } from './MetricView';
export const percentText = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
export function resetText(window: QuotaWindow, now = Date.now()) {
  if (!window.resetsAt) return '重置时间暂不可用';
  if (window.durationMinutes !== null && window.durationMinutes <= 1440) {
    const minutes = Math.ceil((window.resetsAt * 1000 - now) / 60000);
    if (minutes <= 0) return '等待更新重置时间';
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    return `${hours ? `${hours} 小时` : ''}${rest ? ` ${rest} 分钟` : ''}后重置`.trim();
  }
  return `${dateText(new Date(window.resetsAt * 1000).toISOString(), true)} 重置`;
}
export function QuotaView({ usage, selected, density = 'wide', color, details = false, showResets = true, now = Date.now() }: { usage: CodexUsage; selected?: string[]; density?: string; color: string; details?: boolean; showResets?: boolean; now?: number }) {
  const groups = details || !selected ? usage.groups : usage.groups.filter(g => selected.includes(g.id));
  const max = details ? Infinity : density === 'compact' ? 1 : ['wide', 'large', 'tall'].includes(density) ? 2 : 6;
  const all = groups.flatMap(g => g.windows.map(w => ({ group: g, window: w })));
  const shown = all.slice(0, max), hidden = all.length - shown.length;
  const availableCredits = details || ['large', 'expanded'].includes(density) ? groups.filter(g => g.credits && (g.credits.unlimited === true || g.credits.balance !== null)) : [];
  const credits = details ? availableCredits : availableCredits.slice(0, 2);
  function creditsLabel(g: QuotaGroup) { return g.credits?.unlimited === true ? '不限额' : `${percentText(g.credits!.balance!)} credits`; }
  return <div className={`quota-view quota-${details ? 'details' : density}`}>
    {!groups.length ? <p className="quota-unavailable">所选配额组暂不可用，编辑配置可重新选择。</p> : shown.length ? <div className="quota-windows">{shown.map(({ group, window: w }) => <div className={`quota-window ${w.invalid ? 'invalid-window' : ''}`} key={w.metricId}>
      <div className="quota-row"><strong data-shared={`quota-value-${w.metricId}`}>{w.remainingPercent === null ? w.invalid ? '数据异常' : '暂不可用' : <>{percentText(w.remainingPercent)}<small>% 剩余</small></>}</strong><span title={w.label}>{groups.length > 1 && <small>{group.name} · </small>}{w.label}</span></div>
      {w.remainingPercent !== null && <div className="quota-track" data-shared={`quota-progress-${w.metricId}`} role="meter" aria-label={`${group.name} ${w.label} 剩余配额`} aria-valuenow={w.remainingPercent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${percentText(w.remainingPercent)}% 剩余，${resetText(w, now)}`}><span style={{ width: `${w.remainingPercent}%`, background: color }}/></div>}
      <div className="quota-footer">{(details || showResets && density !== 'compact') && <p className="quota-reset-time" title={resetText(w, now)}>{density === 'wide' && !details ? resetText(w, now).replaceAll(' ', '').replace('分钟', '分') : resetText(w, now)}</p>}</div>
    </div>)}</div> : <p className="quota-unavailable">配额窗口暂不可用</p>}
    {hidden > 0 && <p className="quota-more">另 {hidden} 个窗口 · 查看详情</p>}
    {credits.map(g => <p className="quota-credits" key={g.id}>{groups.length > 1 ? `${g.name} · ` : ''}余额 <strong>{creditsLabel(g)}</strong></p>)}
    {!details && density === 'expanded' && <p className="quota-account">{usage.account.maskedEmail} · {usage.account.plan}</p>}
    {details && groups.filter(g => !g.windows.length).map(g => <p className="quota-unavailable" key={g.id}>{g.name}：配额窗口暂不可用</p>)}
  </div>;
}
