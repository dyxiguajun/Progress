import {extensionAvailable,backgroundMetrics} from './extension';
import { refreshInterval, type Component, type Instance, type Metric } from './model';
import { templateUrl } from './validation';

export {DataSourceError} from './httpResponse';
import {DataSourceError,readProgressResponse} from './httpResponse';
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
  if(instance.backgroundCollection&&await extensionAvailable())return backgroundMetrics(instance.id,url,signal);
  if(typeof location!=='undefined'&&location.protocol==='https:'&&new URL(url).protocol==='http:')throw new DataSourceError('connection','HTTPS 页面无法读取 HTTP 接口。请使用 HTTPS，或安装并授权后台插件。');
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  return readProgressResponse(response,refreshInterval(component,instance));
}
export function runtimeError(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '连接超时。稍后会自动重试。';
  if (error instanceof TypeError) return '无法连接。请检查地址、网络，以及服务是否允许跨域访问。';
  return error instanceof Error ? error.message : '获取数据失败。';
}
