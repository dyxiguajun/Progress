import { migrateFolders } from './folders';
import { CODEX_COMPONENT_ID } from './codex';
import { officialLayouts } from './grid';
import { colors, type Component, type Workspace } from './model';

export const builtins: Component[] = [
  {
    manifest: { schema: 'progress/module/v1', id: 'dev.progress.countdown', name: '倒计时', version: '0.1.0',
      description: '下一个值得期待的日子，还有多久？', author: 'Progress', runtime: { type: 'time_range' },
      configuration: { schema: 'config.schema.json' }, renderer: 'number' },
    configSchema: { type: 'object', required: ['end'], additionalProperties: false, properties: {
      end: { type: 'string', title: '目标时间', format: 'date-time' },
      start: { type: 'string', title: '开始时间（可选）', format: 'date-time', description: '设置后可以显示时间进度。' },
    } }, category: 'time', icon: 'timer', builtin: true,
  },
  {
    manifest: { schema: 'progress/module/v1', id: 'dev.progress.date-range', name: '时间进度', version: '0.1.0',
      description: '学期、旅程、年度，把时间看得更清楚。', author: 'Progress', runtime: { type: 'time_range' },
      configuration: { schema: 'config.schema.json' }, renderer: 'bar' },
    configSchema: { type: 'object', required: ['start', 'end'], additionalProperties: false, properties: {
      start: { type: 'string', title: '开始时间', format: 'date-time' },
      end: { type: 'string', title: '结束时间', format: 'date-time' },
    } }, category: 'time', icon: 'calendar', builtin: true,
  },
  {
    manifest: { schema: 'progress/module/v1', id: 'dev.progress.manual', name: '手动进度', version: '0.1.0',
      description: '阅读目标、存储容量，记录任何可度量的事。', author: 'Progress', runtime: { type: 'manual' },
      configuration: { schema: 'config.schema.json' }, renderer: 'bar' },
    configSchema: { type: 'object', required: ['value', 'max', 'unit', 'meaning'], additionalProperties: false, properties: {
      value: { type: 'number', title: '当前值', default: 0, minimum: 0 },
      max: { type: 'number', title: '目标 / 总量', default: 100, minimum: 0.000001 },
      unit: { type: 'string', title: '单位', default: '%', maxLength: 20 },
      meaning: { type: 'string', title: '数值含义', enum: ['completed', 'used', 'remaining', 'available'], default: 'completed' },
    } }, category: 'manual', icon: 'target', builtin: true,
  },
  {
    manifest: { schema: 'progress/module/v1', id: 'dev.progress.quota', name: '配额', version: '0.1.0',
      description: '管理剩余额度，以及下一次重置的时间。', author: 'Progress', runtime: { type: 'quota' },
      configuration: { schema: 'config.schema.json' }, renderer: 'ring' },
    configSchema: { type: 'object', required: ['value', 'max', 'unit'], additionalProperties: false, properties: {
      value: { type: 'number', title: '剩余额度', default: 37, minimum: 0 },
      max: { type: 'number', title: '总额度', default: 100, minimum: 0.000001 },
      unit: { type: 'string', title: '单位', default: '%', maxLength: 20 },
      reset: { type: 'string', title: '重置时间（可选）', format: 'date-time' },
    } }, category: 'manual', icon: 'layers', builtin: true,
  },
  {
    manifest: { schema: 'progress/module/v1', id: 'dev.progress.http', name: 'URL 进度', version: '0.1.0',
      description: '通过只读 URL 获取 Progress JSON 的进度、任务、数值或状态。', author: 'Progress',
      runtime: { type: 'http', url: '{{endpoint}}', refresh_interval: 15 }, permissions: ['network'],
      configuration: { schema: 'config.schema.json' }, renderer: 'bar' },
    configSchema: { type: 'object', required: ['endpoint'], additionalProperties: false, properties: {
      endpoint: { type: 'string', title: '服务地址', default: 'https://', minLength: 8, maxLength: 2048 },
    } }, category: 'services', icon: 'activity', builtin: true,
  },
  {
    manifest: { schema: 'progress/module/v1', id: CODEX_COMPONENT_ID, name: 'Codex Usage', version: '0.4.0',
      description: '查看本机 Codex 账户的剩余配额与重置时间。', author: 'Progress', runtime: { type: 'codex_usage' },
      configuration: { schema: 'config.schema.json' }, renderer: 'quota',
      cardLayouts: structuredClone(officialLayouts) },
    configSchema: { type: 'object', additionalProperties: false, properties: {
      accountKey: { type: 'string', title: '本机账户绑定', default: '', maxLength: 64 },
    } }, category: 'services', icon: 'gpt', builtin: true,
  },
  {manifest:{schema:'progress/module/v1',id:'dev.progress.connected-quota',name:'配额连接',version:'0.5.0',description:'读取服务或设备的真实配额。',author:'Progress',runtime:{type:'provider_quota'},configuration:{schema:'config.schema.json'},renderer:'quota',permissions:['network']},configSchema:{type:'object',properties:{},additionalProperties:false},category:'services',icon:'layers',builtin:true},
];

export function emptyWorkspace(): Workspace {
  return migrateFolders({ schema: 'progress/workspace/v1', name: '我的工作区', components: structuredClone(builtins), instances: [], cards: [], theme: 'system' });
}
export function demoWorkspace(now = new Date()): Workspace {
  const workspace = emptyWorkspace();
  const after = (days: number) => new Date(+now + days * 86400000).toISOString();
  const transfer: Component = {
    manifest: { schema: 'progress/module/v1', id: 'dev.progress.demo-transfer', name: '文件传输示例', version: '0.1.0',
      description: '用于演示传输数据与多指标卡片的固定样本。', author: 'Progress',
      runtime: { type: 'static', entry: 'data.json' }, configuration: { schema: 'config.schema.json' } },
    configSchema: { type: 'object', properties: {}, additionalProperties: false }, category: 'services', icon: 'download',
    metrics: [
      { id: 'transfer', name: 'OneDrive → NAS', kind: 'range', value: 1180, max: 1630, unit: 'GB', meaning: 'completed',
        status: 'running', secondary: [{ role: 'rate', value: 38.2, unit: 'MB/s' }, { role: 'eta', value: 13320, unit: 's' }] },
      { id: 'files', name: '已传输文件', kind: 'counter', value: 8421, unit: '个文件' },
    ],
  };
  workspace.components.push(transfer);
  workspace.instances = [
    { id: 'demo-semester', componentId: 'dev.progress.date-range', name: '秋季学期', createdAt: now.toISOString(), demo: true, config: { start: after(-13), end: after(66) } },
    { id: 'demo-transfer', componentId: transfer.manifest.id, name: 'OneDrive → NAS', createdAt: now.toISOString(), demo: true, config: {} },
    { id: 'demo-quota', componentId: 'dev.progress.quota', name: '手动配额', createdAt: now.toISOString(), demo: true, config: { value: 37, max: 100, unit: '%', reset: after(0.18) } },
    { id: 'demo-holiday', componentId: 'dev.progress.countdown', name: '距离冬季假期', createdAt: now.toISOString(), demo: true, config: { end: after(66), start: '' } },
    { id: 'demo-storage', componentId: 'dev.progress.manual', name: 'NAS 存储空间', createdAt: now.toISOString(), demo: true, config: { value: 1.24, max: 2, unit: 'TB', meaning: 'used' } },
    { id: 'demo-books', componentId: 'dev.progress.manual', name: '今年的阅读计划', createdAt: now.toISOString(), demo: true, config: { value: 7, max: 12, unit: '本', meaning: 'completed' } },
  ];
  workspace.cards = workspace.instances.map((instance, index) => ({ id: `card-${instance.id}`, instanceId: instance.id,
    metricId: instance.id === 'demo-transfer' ? 'transfer' : 'main', renderer: index === 2 || index === 5 ? 'ring' : index === 3 ? 'number' : 'bar', color: colors[index] }));
  return migrateFolders(workspace);
}

// Upgrade the available presets without overwriting installed definitions or user data.
export function upgradeWorkspace(workspace: Workspace): Workspace {
  const next = structuredClone(workspace);
  next.connections ??= [];
  for (const instance of next.instances) if (instance.componentId === CODEX_COMPONENT_ID && !instance.connectionIds?.length) { const id=`connection-${instance.id}`; next.connections.push({id,providerId:'codex',method:'local',kind:'direct',label:'本机 Codex',accountKey:String(instance.config.accountKey??''),priority:0,reconnect:!instance.config.accountKey}); instance.connectionIds=[id]; instance.connectionStrategy='automatic'; }
  const ids = new Set(next.components.map(c => c.manifest.id));
  next.components.push(...builtins.filter(c => !ids.has(c.manifest.id)).map(c => structuredClone(c)));
  next.instances.forEach(i => { if (i.demo && i.componentId === 'dev.progress.quota' && i.name === 'AI 工具额度') i.name = '手动配额'; });
  return migrateFolders(next);
}
