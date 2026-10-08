import { builtins } from '../core/components';
import { type Component } from '../core/model';

export const isPreset = (component: Component) => builtins.some(item => item.manifest.id === component.manifest.id);
const descriptions: Record<string, string> = {
  'dev.progress.countdown': '距目标时间的剩余天数。',
  'dev.progress.date-range': '开始与结束时间之间的进度。',
  'dev.progress.manual': '手动填写当前值和目标总量。',
  'dev.progress.quota': '剩余额度与重置时间。',
  'dev.progress.codex-usage': 'Codex 账户的剩余配额与重置时间。',
  'dev.progress.http': '填写只读 URL，显示进度、任务、数值或状态。',
};
export const componentDescription = (component: Component) => descriptions[component.manifest.id] ?? component.manifest.description;
export const componentName = (component: Component) => component.manifest.id === 'dev.progress.http' ? 'URL 进度' : component.manifest.name;
