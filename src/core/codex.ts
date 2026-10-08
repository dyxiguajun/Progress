import { Capacitor } from '@capacitor/core';
import type { Metric } from './model';
export const CODEX_COMPONENT_ID = 'dev.progress.codex-usage';
export type CodexErrorCode = 'auth' | 'unavailable' | 'not-installed' | 'account-mismatch' | 'incompatible' | 'unsupported-account' | 'connection' | 'invalid' | 'timeout';
export class CodexError extends Error { constructor(public code: CodexErrorCode, message: string) { super(message); } }
export type QuotaWindow = { id: string; metricId: string; label: string; durationMinutes: number | null; usedPercent: number | null; remainingPercent: number | null; resetsAt: number | null; invalid?: boolean };
export type QuotaGroup = { id: string; limitId: string | null; name: string; windows: QuotaWindow[]; credits?: { hasCredits: boolean | null; unlimited: boolean | null; balance: number | null } };
export type CodexUsage = { account: { key: string; maskedEmail: string; plan: string }; groups: QuotaGroup[]; metrics: Metric[]; observedAt: string; version?: string };
export type CodexStatus = { state: 'ready' | 'signed-out' | 'unsupported-account'; account?: { maskedEmail: string; plan: string }; version?: string };
const obj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function windowLabel(minutes: number | null) {
  if (minutes === 300) return '5 小时';
  if (minutes === 10080) return '每周';
  if (minutes === null) return '配额窗口';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}
// This is a Codex adapter, separate from the generic PDM schema. Missing values stay null.
export function adaptCodexUsage(raw: unknown): CodexUsage {
  if (!obj(raw) || !obj(raw.account) || !/^[a-f0-9]{64}$/.test(raw.account.key) || typeof raw.account.maskedEmail !== 'string' || typeof raw.account.plan !== 'string'
    || typeof raw.observedAt !== 'string' || !Number.isFinite(Date.parse(raw.observedAt)) || !obj(raw.limits)) throw new CodexError('invalid', 'Codex 返回的数据格式不受支持，请更新 Codex 后重试。');
  const limits = raw.limits;
  const entries = obj(limits.rateLimitsByLimitId) ? Object.entries(limits.rateLimitsByLimitId) : obj(limits.rateLimits) ? [[limits.rateLimits.limitId ?? 'codex', limits.rateLimits]] : [];
  if (!entries.length || entries.length > 64) throw new CodexError('incompatible', 'Codex 暂未提供配额组，请重试或更新 Codex。');
  const groups: QuotaGroup[] = [], metrics: Metric[] = [];
  for (const [key, value] of entries) {
    if (!obj(value) || typeof key !== 'string' || key.length > 200) throw new CodexError('invalid', 'Codex 配额组格式不受支持。');
    // Use the map key for stable selection, even when metadata limitId is unavailable.
    const id = key;
    const limitId = typeof value.limitId === 'string' ? value.limitId.slice(0, 200) : null;
    const name = typeof value.limitName === 'string' && value.limitName.trim() ? value.limitName.slice(0, 200) : id === 'codex' ? 'Codex' : id;
    const supplied: [string, any][] = Array.isArray(value.windows) ? value.windows.map((w: any, i: number) => [typeof w?.id === 'string' ? w.id : String(i), w]) : [['primary', value.primary], ['secondary', value.secondary]];
    if (supplied.length > 16) throw new CodexError('invalid', 'Codex 配额窗口数量不受支持。');
    const seen = new Set<string>();
    const windows: QuotaWindow[] = [];
    for (const [slot, w] of supplied) {
      if (w == null) continue; // No manufactured window or percentage.
      if (!obj(w) || seen.has(slot) || slot.length > 200) throw new CodexError('invalid', 'Codex 配额窗口格式不受支持。');
      seen.add(slot);
      const invalid = w.usedPercent != null && (!finite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100);
      const usedPercent = finite(w.usedPercent) && !invalid ? w.usedPercent : null;
      const durationMinutes = finite(w.windowDurationMins) && w.windowDurationMins > 0 ? w.windowDurationMins : null;
      const resetsAt = finite(w.resetsAt) && w.resetsAt > 0 && w.resetsAt * 1000 <= 8.64e15 ? w.resetsAt : null;
      const metricId = `codex:${encodeURIComponent(id)}:${encodeURIComponent(slot)}`;
      const label = windowLabel(durationMinutes);
      const remainingPercent = usedPercent === null ? null : 100 - usedPercent;
      windows.push({ id: slot, metricId, label, durationMinutes, usedPercent, remainingPercent, resetsAt, ...(invalid ? { invalid: true } : {}) });
      metrics.push({ id: metricId, name: `${name} · ${label}`, kind: remainingPercent === null ? 'state' : 'range', value: remainingPercent ?? (invalid ? '数据异常' : '暂不可用'),
        ...(remainingPercent === null ? {} : { min: 0, max: 100, unit: '%', meaning: 'remaining' }), observed_at: raw.observedAt, stale_after: 900 });
    }
    const credits = obj(value.credits) ? { hasCredits: typeof value.credits.hasCredits === 'boolean' ? value.credits.hasCredits : null,
      unlimited: typeof value.credits.unlimited === 'boolean' ? value.credits.unlimited : null,
      balance: (finite(value.credits.balance) || typeof value.credits.balance === 'string' && /^\d+(\.\d+)?$/.test(value.credits.balance)) && Number.isFinite(Number(value.credits.balance)) && Number(value.credits.balance) >= 0 ? Number(value.credits.balance) : null } : undefined;
    groups.push({ id, limitId, name, windows, ...(credits ? { credits } : {}) });
  }
  return { account: { key: raw.account.key, maskedEmail: raw.account.maskedEmail.slice(0, 200), plan: raw.account.plan.slice(0, 60) }, groups, metrics, observedAt: raw.observedAt, ...(typeof raw.version === 'string' ? { version: raw.version.slice(0, 100) } : {}) };
}
export async function codexRequest<T>(path: string, method = 'GET', signal?: AbortSignal): Promise<T> {
  if (Capacitor.isNativePlatform() || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new CodexError('unavailable', '需要在运行 Codex 的电脑上打开 Progress。此设备暂不支持直接读取。');
  let response: Response;
  try { response = await fetch(`/api/codex/${path}`, { method, signal: signal ?? AbortSignal.timeout(15000), headers: { 'X-Progress-Client': 'usage-v1' }, credentials: 'omit', cache: 'no-store', redirect: 'error' }); }
  catch (e) { if (signal?.aborted) throw e; throw new CodexError('unavailable', '无法连接本机服务，请重新启动 Progress 后重试。'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new CodexError('unavailable', '请使用电脑上的 Progress 启动器打开应用，再重新连接。');
  const value = await response.json();
  if (!response.ok) throw new CodexError(value.code ?? 'connection', value.message ?? '无法读取 Codex 配额。');
  return value as T;
}
export async function readCodexUsage(accountKey?: string, signal?: AbortSignal) {
  const usage = adaptCodexUsage(await codexRequest<unknown>('usage', 'GET', signal));
  if (!accountKey || usage.account.key !== accountKey) throw new CodexError('account-mismatch', '此卡片的账户尚未确认或已改变。请编辑配置并确认当前账户。');
  return usage;
}
// Notifications only request a full read; sparse updates are never mistaken for complete snapshots.
export function watchCodex(onUpdate: () => void) {
  const controller = new AbortController(); let connected = false; let reconnect: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    if (connected || controller.signal.aborted || document.hidden || Capacitor.isNativePlatform() || !['localhost', '127.0.0.1'].includes(location.hostname)) return;
    connected = true;
    try {
      const response = await fetch('/api/codex/events', { headers: { 'X-Progress-Client': 'usage-v1' }, signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Event stream unavailable');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let pos; while ((pos = buffer.indexOf('\n\n')) !== -1) { const event = buffer.slice(0, pos); buffer = buffer.slice(pos + 2); if (event.startsWith('data:')) onUpdate(); }
      }
    } catch { /* Connection state is reported by the next ordinary read. */ }
    connected = false;
    if (!controller.signal.aborted) reconnect = setTimeout(() => void connect(), 15000);
  };
  void connect(); const visible = () => { if (!document.hidden) { clearTimeout(reconnect); if (!connected) void connect(); onUpdate(); } };
  document.addEventListener('visibilitychange', visible);
  return () => { controller.abort(); clearTimeout(reconnect); document.removeEventListener('visibilitychange', visible); };
}

const CACHE_PREFIX = 'progress.codex.sample.v1.';
export function cacheCodexUsage(usage: CodexUsage) {
  // Store only the adapter's whitelisted, masked data, independently of workspace exports.
  const value = { account: usage.account, observedAt: usage.observedAt, version: usage.version, limits: { rateLimitsByLimitId: Object.fromEntries(usage.groups.map(g => [g.id, {
    limitId: g.limitId, limitName: g.name, windows: g.windows.map(w => ({ id: w.id, usedPercent: w.invalid ? -1 : w.usedPercent, windowDurationMins: w.durationMinutes, resetsAt: w.resetsAt })), credits: g.credits,
  }])) } };
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    if (keys.length >= 16 && !keys.includes(CACHE_PREFIX + usage.account.key)) localStorage.removeItem(keys[0]);
    localStorage.setItem(CACHE_PREFIX + usage.account.key, JSON.stringify(value));
  } catch { /* Live data remains usable if local storage is full. */ }
}
export function cachedCodexUsage(accountKey?: string): CodexUsage | undefined {
  if (!accountKey || Capacitor.isNativePlatform()) return;
  try { const value = localStorage.getItem(CACHE_PREFIX + accountKey); if (!value || value.length > 200000) return;
    const usage = adaptCodexUsage(JSON.parse(value)); return usage.account.key === accountKey ? usage : undefined;
  } catch { return; }
}
export function clearCodexCache(accountKey?: string) { if (accountKey) try { localStorage.removeItem(CACHE_PREFIX + accountKey); } catch {} }
