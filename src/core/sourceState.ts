import type { CodexUsage, CodexErrorCode } from './codex';
import { isStale, type Component, type Instance, type Metric } from './model';
import { terminalTask } from './presentation';

export type Snapshot = { metrics: Metric[]; loading?: boolean; manualLoading?: boolean; error?: string; errorCode?: 'permission' | 'connection' | 'invalid' | 'timeout' | CodexErrorCode; observedAt?: string; receivedAt?: string; sourceDevice?: string; connectionId?: string; quota?: CodexUsage; lastSuccess?: number };
export type SourceState = 'fresh' | 'refreshing' | 'loading' | 'stale' | 'offline' | 'error' | 'permission-required' | 'invalid' | 'missing' | 'auth-required' | 'unavailable' | 'account-mismatch' | 'incompatible';
export function sourceState(component: Component, instance: Instance, snapshot: Snapshot | undefined, metric: Metric | undefined, now: number, online = true): SourceState {
  const network = component.manifest.runtime.type === 'http';
  if (network && !instance.networkConsent) return 'permission-required';
  if (network && !online) return 'offline';
  if (snapshot?.errorCode === 'auth') return 'auth-required';
  if (['unavailable', 'not-installed'].includes(snapshot?.errorCode ?? '')) return 'unavailable';
  if (snapshot?.errorCode === 'account-mismatch') return 'account-mismatch';
  if (['incompatible', 'unsupported-account'].includes(snapshot?.errorCode ?? '')) return 'incompatible';
  if (snapshot?.errorCode === 'invalid') return 'invalid';
  if (snapshot?.error) return 'error';
  if (['codex_usage','provider_quota'].includes(component.manifest.runtime.type) && snapshot?.quota) {
    if (now - Date.parse(snapshot.quota.observedAt) > 900000 || snapshot.metrics.some(m => isStale(m, now))) return 'stale';
    if (snapshot.quota.groups.some(g => g.windows.some(w => w.invalid))) return 'invalid';
    return snapshot.loading ? 'refreshing' : 'fresh';
  }
  if (!metric) return snapshot?.loading ? 'loading' : 'missing';
  if (!terminalTask(metric) && isStale(metric, now)) return 'stale';
  return snapshot?.loading ? 'refreshing' : 'fresh';
}
export const sourceStateLabels: Record<SourceState, string> = {
  'auth-required': '需要重新登录', unavailable: '本机连接不可用', 'account-mismatch': '需要确认账户', incompatible: '连接不兼容',
  fresh: '最新数据', refreshing: '正在刷新', loading: '正在连接', stale: '数据已过期', offline: '设备离线',
  error: '连接失败', 'permission-required': '需要网络权限', invalid: '数据格式不兼容', missing: '指标不可用',
};
