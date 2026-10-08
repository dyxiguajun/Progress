import { refreshInterval, type Component, type Instance, type Metric } from './model';
import { normalizeMetrics, templateUrl } from './validation';

export class DataSourceError extends Error {
  constructor(public code: 'permission' | 'connection' | 'invalid', message: string) { super(message); }
}

export function localMetrics(component: Component, instance: Instance): Metric[] {
  const config = instance.config;
  const base = { id: 'main', name: instance.name };
  switch (component.manifest.runtime.type) {
    case 'time_range': return [{ ...base, kind: 'time_range', end: String(config.end), ...(config.start ? { start: String(config.start) } : {}) }];
    case 'manual': return [{ ...base, kind: 'range', value: Number(config.value), min: 0, max: Number(config.max), unit: String(config.unit), meaning: String(config.meaning) }];
    case 'quota': return [{ ...base, kind: 'range', value: Number(config.value), min: 0, max: Number(config.max), unit: String(config.unit), meaning: 'remaining' }];
    case 'static': return structuredClone(component.metrics ?? []);
    case 'http': case 'provider_quota': case 'codex_usage': return [];
  }
}
export async function fetchMetrics(component: Component, instance: Instance, signal?: AbortSignal): Promise<Metric[]> {
  if (component.manifest.runtime.type !== 'http') return localMetrics(component, instance);
  if (!instance.networkConsent) throw new DataSourceError('permission', '需要允许此连接访问网络。');
  const url = templateUrl(component.manifest.runtime.url, instance.config);
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new DataSourceError('connection', `服务暂时不可用（${response.status}）。`);
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > 2_000_000) throw new Error('服务返回的数据过大。');
  if (!response.body) throw new Error('服务没有返回数据。');
  const reader = response.body.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) { await reader.cancel(); throw new Error('服务返回的数据过大。'); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size); let offset = 0;
  chunks.forEach(chunk => { joined.set(chunk, offset); offset += chunk.byteLength; });
  let metrics: Metric[];
  try { metrics = normalizeMetrics(JSON.parse(new TextDecoder().decode(joined))); }
  catch { throw new DataSourceError('invalid', '服务返回的数据格式不受支持。请检查数据源或更换组件。'); }
  const observed_at = new Date().toISOString();
  return metrics.map(metric => ({ ...metric, observed_at: metric.observed_at ?? observed_at, stale_after: metric.stale_after ?? refreshInterval(component, instance) * 3 }));
}
export function runtimeError(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '连接超时。稍后会自动重试。';
  if (error instanceof TypeError) return '无法连接。请检查地址、网络，以及服务是否允许跨域访问。';
  return error instanceof Error ? error.message : '获取数据失败。';
}
