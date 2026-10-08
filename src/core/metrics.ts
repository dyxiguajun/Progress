import type {Metric} from './model';
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const date = (v: unknown) => {
  if (typeof v !== 'string') return false;
  const parts = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!parts || !Number.isFinite(Date.parse(v))) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour <= 23 && minute <= 59 && second <= 59;
};
const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
export function assertMetrics(value: unknown): asserts value is Metric[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('数据源需要返回 1–100 个指标。');
  const ids = new Set<string>();
  for (const m of value) {
    if (!object(m) || !text(m.id) || !text(m.name) || ids.has(m.id)) throw new Error('指标必须有唯一 ID 和名称。');
    ids.add(m.id);
    if (!['range', 'gauge', 'counter', 'time_range', 'state', 'indeterminate'].includes(m.kind)) throw new Error('暂不支持这个指标类型。');
    if (['range', 'gauge', 'counter'].includes(m.kind) && !finite(m.value)) throw new Error('指标数值必须是有限数字。');
    if (m.kind === 'range' && (!finite(m.max) || (m.min !== undefined && !finite(m.min)) || m.max <= (m.min ?? 0))) throw new Error('范围上限必须大于下限。');
    if (m.kind === 'time_range' && (!date(m.end) || (m.start !== undefined && (!date(m.start) || Date.parse(m.start) >= Date.parse(m.end))))) throw new Error('时间范围无效，结束时间必须晚于开始时间。');
    if (m.kind === 'state' && !text(m.value)) throw new Error('状态值必须是非空文字。');
    if (m.kind === 'indeterminate' && m.value !== undefined && !finite(m.value)) throw new Error('不确定进度的计数必须是数字。');
    if (m.observed_at !== undefined && !date(m.observed_at)) throw new Error('观测时间无效。');
    if (m.reset_at !== undefined && !date(m.reset_at)) throw new Error('重置时间无效。');
    if (m.window_minutes !== undefined && (!finite(m.window_minutes) || m.window_minutes <= 0)) throw new Error('配额窗口时长无效。');
    if (m.stale_after !== undefined && (!finite(m.stale_after) || m.stale_after < 0)) throw new Error('过期时间必须是非负秒数。');
    for (const key of ['unit', 'meaning', 'status']) if (m[key] !== undefined && typeof m[key] !== 'string') throw new Error('指标文字字段格式无效。');
    if (m.secondary !== undefined && (!Array.isArray(m.secondary) || m.secondary.length > 20 || m.secondary.some((s: any) => !object(s) || !text(s.role) || !finite(s.value) || (s.unit !== undefined && typeof s.unit !== 'string') || s.id!==undefined&&!text(s.id) || s.label!==undefined&&!text(s.label)) || new Set(m.secondary.filter((s:any)=>s.id!==undefined).map((s:any)=>s.id)).size!==m.secondary.filter((s:any)=>s.id!==undefined).length)) throw new Error('辅助指标格式无效。');
  }
}
export function normalizeMetrics(value: unknown): Metric[] {
  let metrics: unknown;
  if (Array.isArray(value)) metrics = value;
  else if (object(value) && Array.isArray(value.metrics)) metrics = value.metrics;
  else if (object(value)) metrics = [{ ...value, id: value.id ?? 'main', name: value.name ?? '当前进度' }];
  assertMetrics(metrics);
  const keys = ['id','name','kind','value','min','max','unit','meaning','start','end','status','observed_at','reset_at','window_minutes','stale_after'];
  return metrics.map(m => ({
    ...Object.fromEntries(keys.filter(key => m[key as keyof Metric] !== undefined).map(key => [key,m[key as keyof Metric]])),
    ...(m.secondary ? {secondary: m.secondary.map(s => ({role:s.role,value:s.value,...(s.unit !== undefined ? {unit:s.unit} : {}),...(s.id!==undefined?{id:s.id}:{}),...(s.label!==undefined?{label:s.label}:{})}))} : {}),
  })) as Metric[];
}
