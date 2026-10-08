import type { Metric, GridSpan } from './model';

export const numberText = (value: number, digits = 2, locale = 'zh-CN') => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
export const taskLabels: Record<string, string> = { running: '进行中', completed: '已完成', failed: '失败', stopped: '已停止', interrupted: '已中断', cancelled: '已取消', paused: '已暂停', unknown: '状态未知', connecting: '正在连接', stale: '等待最新数据' };
export const terminalTask = (metric?: Metric) => !!metric?.status && ['completed', 'failed', 'stopped', 'interrupted', 'cancelled'].includes(metric.status);
export function metricLabel(metric: Metric) {
  const meaning: Record<string, string> = { completed: '完成量', used: '已使用', remaining: '剩余', available: '可用', utilization: '使用率' };
  const task = taskLabels[metric.status ?? ''];
  if (metric.meaning === 'completed' || terminalTask(metric) || metric.status === 'paused') return task ?? meaning[metric.meaning ?? ''] ?? '当前';
  return meaning[metric.meaning ?? ''] ?? task ?? (metric.kind === 'counter' ? '累计' : '当前');
}
export function percentageText(fraction: number) {
  const value = fraction * 100;
  // A rounded label must never announce a full range before the actual bound is reached.
  return value >= 99 && value < 100 ? numberText(Math.min(99.9, Math.round(value * 10) / 10), 1) : numberText(Math.round(value), 0);
}
const byteUnits = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const isBytes = (unit = '') => ['By', 'B', 'bytes', 'byte'].includes(unit);
const isRate = (unit = '') => ['By/s', 'B/s', 'bytes/s', 'bytes_per_second'].includes(unit);
export function formatQuantity(value: number, unit = '', scaleValue = value) {
  if (isBytes(unit) || isRate(unit)) {
    const scale = Math.min(5, Math.max(0, Math.floor(Math.log2(Math.max(1, Math.abs(scaleValue))) / 10)));
    return { value: numberText(value / 1024 ** scale, scale ? 2 : 0), unit: `${byteUnits[scale]}${isRate(unit) ? '/s' : ''}` };
  }
  const units: Record<string, string> = { seconds: '秒', s: '秒', files: '文件', '{file}': '文件', percent: '%', credits: 'credits' };
  const formatted=value!==0&&Math.abs(value)<.005?new Intl.NumberFormat('zh-CN',{notation:'scientific',maximumFractionDigits:3}).format(value):numberText(value);
  return { value: formatted, unit: units[unit] ?? unit };
}
export function formatRange(metric: Metric) {
  const target = formatQuantity(metric.max!, metric.unit), value = formatQuantity(Number(metric.value), metric.unit, metric.max);
  return `${value.value} / ${target.value}${target.unit ? ` ${target.unit}` : ''}`;
}
export function sizeDescription(span: GridSpan) {
  if (span.columns === 1 && span.rows === 1) return '主要显示图标、主数值和状态；完整标题、辅助指标与说明在详情中查看。';
  if (span.rows === 1) return '显示图标、标题与主进度；保留总量或独立配额窗口，辅助信息按空间收起。';
  if (span.columns === 1) return '纵向显示标题、主进度和辅助信息；配额窗口依次排列。';
  return '显示标题、主进度、辅助指标及时间信息；配额窗口按空间分区呈现。';
}
