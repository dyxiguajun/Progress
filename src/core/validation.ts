import { iconNames } from './iconCatalog';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { type Component, type Config, type Metric, type Workspace } from './model';
import { layoutsFor, officialLayouts } from './grid';

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const ajv2020 = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
// Keep dialects separate; the generated-form keyword subset below still applies to both.
const configValidator = (schema: Component['configSchema']) =>
  schema.$schema?.replace(/#$/, '') === 'https://json-schema.org/draft/2020-12/schema' ? ajv2020 : ajv;
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
export function configErrors(component: Component, config: Config): string[] {
  const validate = configValidator(component.configSchema).compile(component.configSchema);
  validate(config);
  const errors = (validate.errors ?? []).map(error => {
    const key = String(error.params.missingProperty ?? error.instancePath.slice(1));
    const label = component.configSchema.properties[key]?.title ?? key;
    const messages: Record<string, string> = { required: '请填写此项', type: '格式不正确', minimum: `不能小于 ${error.params.limit}`, maximum: `不能大于 ${error.params.limit}`, minLength: `至少需要 ${error.params.limit} 个字符`, maxLength: `最多 ${error.params.limit} 个字符`, enum: '请选择有效选项', additionalProperties: '包含不支持的字段' };
    return `${label}：${messages[error.keyword] ?? '填写内容不符合要求'}`;
  });
  if (Object.keys(config).some(key => !Object.hasOwn(component.configSchema.properties, key))) errors.push('配置包含未声明的字段。');
  for (const [key, field] of Object.entries(component.configSchema.properties)) {
    if (field.format === 'date-time' && (config[key] || component.configSchema.required?.includes(key)) && !date(config[key])) errors.push(`${field.title ?? key}：时间格式无效。`);
  }
  if (component.manifest.runtime.type === 'codex_usage' && (Object.keys(config).some(k => k !== 'accountKey') || (config.accountKey !== undefined && config.accountKey !== '' && (typeof config.accountKey !== 'string' || !/^[a-f0-9]{64}$/.test(config.accountKey))))) errors.push('Codex 账户绑定无效，请重新连接。');
  const { start, end, endpoint } = config;
  const runtime = component.manifest.runtime.type;
  if (runtime === 'time_range' && (!date(end) || (start && !date(start)))) errors.push('倒计时与时间进度需要有效的目标时间。');
  if (['manual', 'quota'].includes(runtime) && (!finite(config.value) || !finite(config.max) || Number(config.max) <= 0 || typeof config.unit !== 'string')) errors.push('当前值和总量必须是数字，总量需要大于零，并填写单位。');
  if (runtime === 'manual' && typeof config.meaning !== 'string') errors.push('手动进度需要指定数值含义。');
  if (start && end && Date.parse(String(start)) >= Date.parse(String(end))) errors.push('结束时间必须晚于开始时间。');
  if (component.manifest.runtime.type === 'http') {
    try {
      const url = new URL(templateUrl(component.manifest.runtime.url, config));
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { errors.push('请填写有效的 HTTP / HTTPS 服务地址，不要在地址中包含凭据。'); }
    if (typeof endpoint === 'string' && endpoint.length > 2048) errors.push('服务地址过长。');
  }
  return errors;
}
export function templateUrl(url: string, config: Config) {
  return url.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => String(config[key] ?? ''));
}
export function assertComponent(value: unknown): asserts value is Component {
  if (!object(value) || !object(value.manifest)) throw new Error('组件缺少 manifest.json。');
  const m = value.manifest;
  if (m.schema !== 'progress/module/v1' || typeof m.id !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(m.id) || !text(m.name) || !text(m.author) || typeof m.description !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error('组件清单格式或版本无效。');
  if (!object(m.runtime) || !['time_range', 'manual', 'quota', 'static', 'http', 'codex_usage', 'provider_quota'].includes(m.runtime.type)) throw new Error('组件需要当前版本尚未支持的能力，请使用兼容组件或更新应用。');
  if (m.runtime.type === 'codex_usage' && (m.id !== 'dev.progress.codex-usage' || Object.keys(m.runtime).some(k => k !== 'type'))) throw new Error('Codex 连接仅供官方预设使用。');
  if (m.runtime.type === 'static' && m.runtime.entry !== 'data.json') throw new Error('静态组件的数据入口必须是 data.json。');
  if (m.runtime.type === 'http' && (typeof m.runtime.url !== 'string' || !m.runtime.url.length || (m.runtime.refresh_interval !== undefined && (!finite(m.runtime.refresh_interval) || m.runtime.refresh_interval < 5)))) throw new Error('HTTP 配置无效，刷新间隔至少为 5 秒。');
  if (m.permissions !== undefined && (!Array.isArray(m.permissions) || m.permissions.some((p: unknown) => p !== 'network'))) throw new Error('此原型只支持网络权限。');
  if (m.runtime.type === 'http' && !m.permissions?.includes('network')) throw new Error('HTTP 组件必须声明 network 权限。');
  if (!object(m.configuration) || m.configuration.schema !== 'config.schema.json') throw new Error('配置入口必须是 config.schema.json。');
  if (m.configuration.ui !== undefined) throw new Error('此原型尚不支持自定义配置界面。');
  if (m.renderer !== undefined && !['bar', 'ring', 'number', 'quota', 'fill'].includes(m.renderer)) throw new Error('不支持该默认显示方式。');
  if (m.renderer === 'quota' && !['codex_usage','provider_quota'].includes(m.runtime.type)) throw new Error('配额组合显示仅供 Codex 预设使用。');
  if (m.quotaProvider !== undefined) {
    const p = m.quotaProvider;
    if (m.runtime.type !== 'provider_quota' || !object(p) || !text(p.id) || !text(p.name) || !Array.isArray(p.connectionMethods) || !p.connectionMethods.length || new Set(p.connectionMethods).size !== p.connectionMethods.length || p.connectionMethods.some((method:unknown)=>!['api-key','bearer','read-only-url','endpoint-secret','pairing'].includes(String(method))) || !Array.isArray(p.credentialInstructions) || p.credentialInstructions.length > 20 || p.credentialInstructions.some((s:unknown)=>typeof s!=='string'||s.length>1000) || !Array.isArray(p.requiredScopes) || p.requiredScopes.some((s:unknown)=>!text(s))) throw new Error('Provider 声明不兼容。当前安装包支持只读 URL、API Key、Token、Endpoint + Secret 与配对。');
    try { const help=new URL(p.helpUrl); if(help.protocol!=='https:'||help.username||help.password)throw new Error(); } catch { throw new Error('Provider 帮助地址需使用 HTTPS。'); }
    if (['codex','manual','claude'].includes(p.id)) throw new Error('Provider 使用了保留名称。');
  }
  if (m.cardLayouts !== undefined) {
    const layouts = m.cardLayouts;
    if (!object(layouts) || !Array.isArray(layouts.variants) || !layouts.variants.length || layouts.variants.length > 32) throw new Error('卡片尺寸声明无效。');
    const ids = new Set<string>();
    for (const variant of layouts.variants) {
      if (!object(variant) || typeof variant.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(variant.id) || ids.has(variant.id) || !object(variant.span)
        || !Number.isInteger(variant.span.columns) || variant.span.columns < 1 || variant.span.columns > 12 || !Number.isInteger(variant.span.rows) || variant.span.rows < 1 || variant.span.rows > 8
        || (variant.label !== undefined && !text(variant.label))) throw new Error('卡片尺寸必须使用唯一名称和整数格数。');
      ids.add(variant.id);
    }
    if (!ids.has(layouts.default)) throw new Error('默认卡片尺寸不存在。');
    for (const variant of layouts.variants) {
      const seen = new Set([variant.id]); let next = variant.fallback;
      while (next !== undefined) {
        if (!ids.has(next) || seen.has(next)) throw new Error('卡片尺寸回退链无效。');
        seen.add(next); next = layouts.variants.find((item: any) => item.id === next).fallback;
      }
    }
  }
  if (!['time', 'manual', 'services'].includes(value.category) || !iconNames.includes(value.icon)) throw new Error('组件分类或图标无效。');
  const schema = value.configSchema;
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || Object.keys(schema.properties).length > 30 || (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key: any) => !Object.hasOwn(schema.properties, key))))) throw new Error('配置 Schema 无效。');
  for (const [key, field] of Object.entries(schema.properties)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || !object(field) || !['string', 'number', 'integer', 'boolean'].includes(field.type)) throw new Error('自动表单目前支持文字、数字、整数和开关。');
    if (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || field.enum.some((item: unknown) => !['string', 'number'].includes(typeof item)))) throw new Error('枚举字段无效。');
    if (field.format && field.format !== 'date-time') throw new Error('暂不支持这个表单格式。');
    const unsupported = Object.keys(field).filter(k => !['type', 'title', 'description', 'default', 'enum', 'format', 'minimum', 'maximum', 'minLength', 'maxLength'].includes(k));
    if (unsupported.length) throw new Error(`配置字段“${key}”包含尚不支持的 Schema 关键字：${unsupported.slice(0, 4).join('、')}。路径：${unsupported.slice(0, 4).map(keyword => `$.properties.${key}.${keyword}`).join('、')}。请修改 config.schema.json 后重新导入。`);
  }
  const unsupported = Object.keys(schema).filter(k => !['type', 'properties', 'required', 'additionalProperties', '$schema', 'title', 'description'].includes(k));
  if (unsupported.length) throw new Error(`配置 Schema 包含尚不支持的关键字：${unsupported.slice(0, 4).join('、')}。路径：${unsupported.slice(0, 4).map(keyword => `$.${keyword}`).join('、')}。请修改 config.schema.json 后重新导入。`);
  if (['title', 'description'].some(key => schema[key] !== undefined && typeof schema[key] !== 'string')) throw new Error('配置 Schema 的标题和说明必须是文字。');
  if (schema.$schema !== undefined && typeof schema.$schema !== 'string') throw new Error('配置 Schema 的版本声明必须是文字。');
  try { configValidator(schema as Component['configSchema']).compile(schema); } catch { throw new Error('配置 Schema 校验失败，请检查字段定义与 $schema 版本。当前支持 draft-07 与 draft-2020-12 的表单子集。'); }
  if (m.runtime.type === 'static') assertMetrics(value.metrics);
}
export function assertWorkspace(value: unknown): asserts value is Workspace {
  if (!object(value) || value.schema !== 'progress/workspace/v1' || !text(value.name) || !['light', 'dark', 'system'].includes(value.theme) || !Array.isArray(value.components) || !Array.isArray(value.instances) || !Array.isArray(value.cards)) throw new Error('工作区文件格式或版本无效。');
  if (value.components.length > 100 || value.instances.length > 500 || value.cards.length > 1000) throw new Error('工作区超过原型支持的大小。');
  const unique = (items: any[], getId: (item: any) => unknown) => {
    const ids = items.map(getId);
    if (ids.some(id => !text(id)) || new Set(ids).size !== ids.length) throw new Error('工作区包含重复或无效 ID。');
  };
  value.components.forEach(assertComponent);
  unique(value.components, item => item.manifest.id);
  unique(value.instances, item => item?.id);
  unique(value.cards, item => item?.id);
  if(value.groupValues!==undefined&&typeof value.groupValues!=='boolean')throw new Error('组合数值显示设置无效。');
  if(value.autoFill !== undefined && typeof value.autoFill !== 'boolean') throw new Error('网格设置无效。');
  if(value.wheelMode!==undefined&&!['auto','mouse','native'].includes(value.wheelMode))throw new Error('滚轮映射设置无效。');
  if(value.scrollDirection!==undefined&&!['vertical','horizontal'].includes(value.scrollDirection))throw new Error('滚动方向无效。');
  if(value.folders !== undefined) { if(!Array.isArray(value.folders)||!value.folders.length||value.folders.length>100) throw new Error('文件夹列表无效。');unique(value.folders,f=>f?.id);for(const f of value.folders)if(!text(f.name)||!['folder','star','briefcase','heart'].includes(f.icon)||!/^#[0-9a-fA-F]{6}$/.test(f.color))throw new Error('文件夹外观无效。'); }
  if(value.connections !== undefined) { if(!Array.isArray(value.connections)||value.connections.length>500)throw new Error('连接列表无效。');unique(value.connections,c=>c?.id);for(const c of value.connections) { const allowed=['id','providerId','method','kind','label','endpoint','credentialRef','accountKey','sourceDevice','sourceConnectionId','deviceId','priority','reconnect'];if(!object(c)||Object.keys(c).some(k=>!allowed.includes(k))||!text(c.providerId)||!text(c.label)||!['local','oauth','api-key','bearer','read-only-url','endpoint-secret','pairing'].includes(c.method)||!['direct','relay'].includes(c.kind)||!Number.isInteger(c.priority)||c.priority<0||c.priority>100||c.reconnect!==undefined&&typeof c.reconnect!=='boolean'||['credentialRef','accountKey','sourceDevice','sourceConnectionId','deviceId'].some(k=>c[k]!==undefined&&typeof c[k]!=='string'))throw new Error('连接元数据无效；凭据必须保存在本机凭据存储。');if(c.kind==='relay'&&c.method!=='pairing')throw new Error('中继连接需要配对。');if(c.endpoint!==undefined){try{const u=new URL(c.endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||c.endpoint.length>2048)throw new Error();}catch{throw new Error('连接地址无效。');}} } }
  for (const instance of value.instances) {
    const component = value.components.find((c: Component) => c.manifest.id === instance.componentId);
    if (!component || !text(instance.name) || !date(instance.createdAt) || !object(instance.config) || configErrors(component, instance.config).length) throw new Error('工作区实例配置无效或缺少组件。');
    if(instance.connectionIds!==undefined&&(!Array.isArray(instance.connectionIds)||instance.connectionIds.length>12||new Set(instance.connectionIds).size!==instance.connectionIds.length||instance.connectionIds.some((id:unknown)=>!value.connections?.some((c:any)=>c.id===id))))throw new Error('实例的连接引用无效。');
    if(instance.connectionStrategy!==undefined&&!['automatic','direct','relay'].includes(instance.connectionStrategy))throw new Error('连接策略无效。');
    if (instance.demo !== undefined && typeof instance.demo !== 'boolean') throw new Error('示例标记无效。');
    if (instance.networkConsent !== undefined && typeof instance.networkConsent !== 'boolean') throw new Error('权限标记无效。');
    if (instance.refreshInterval !== undefined && (!Number.isInteger(instance.refreshInterval) || instance.refreshInterval < 5 || instance.refreshInterval > 86400 || component.manifest.runtime.type !== 'http')) throw new Error('刷新间隔需要为 5–86400 秒的整数，仅用于网络连接。');
  }
  for (const card of value.cards) {
    if(card.icon!==undefined&&!iconNames.includes(card.icon))throw new Error('卡片图标无效。');
    if(card.fillDirection!==undefined&&!['bottom-up','left-right'].includes(card.fillDirection))throw new Error('填充方向无效。');
    if(card.ringCenter!==undefined&&!['auto','icon','value'].includes(card.ringCenter))throw new Error('圆环中心显示无效。');
    if (card.display !== undefined && (!object(card.display) || Object.entries(card.display).some(([key, enabled]) => !['title', 'status', 'details', 'secondary', 'reset'].includes(key) || typeof enabled !== 'boolean'))) throw new Error('卡片显示开关无效。');
    if(card.displayPreferences!==undefined&&(!object(card.displayPreferences)||Object.keys(card.displayPreferences).some(key=>key!=='fields')||!Array.isArray(card.displayPreferences.fields)||card.displayPreferences.fields.length>64||new Set(card.displayPreferences.fields).size!==card.displayPreferences.fields.length||card.displayPreferences.fields.some((id:unknown)=>typeof id!=='string'||id.length>220||!(['icon','title','status','value','progress','details','reset','credits','account','updated'].includes(id)||/^(metric|secondary):.+$/.test(id)))))throw new Error('卡片显示字段无效。');
    if (!value.instances.some((i: any) => i.id === card.instanceId) || !text(card.metricId) || !['bar', 'ring', 'number', 'quota', 'fill'].includes(card.renderer) || typeof card.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(card.color) || (card.title !== undefined && !text(card.title))) throw new Error('卡片引用或外观配置无效。');
    const source = value.components.find((c: Component) => c.manifest.id === value.instances.find((i: any) => i.id === card.instanceId).componentId);
    if (card.renderer === 'quota' && (!['codex_usage','provider_quota'].includes(source.manifest.runtime.type) || !['codex-usage','provider-quota'].includes(card.metricId))) throw new Error('配额卡片引用无效。');
    if (['codex_usage','provider_quota'].includes(source.manifest.runtime.type) && card.renderer !== 'quota') throw new Error('Codex 卡片需要使用配额组合显示。');
    if (card.quotaGroups !== undefined && (!['codex_usage','provider_quota'].includes(source.manifest.runtime.type) || !Array.isArray(card.quotaGroups) || !card.quotaGroups.length || card.quotaGroups.length > 64 || card.quotaGroups.some((id: unknown) => !text(id)) || new Set(card.quotaGroups).size !== card.quotaGroups.length)) throw new Error('所选配额组无效。');
    if(card.folderId!==undefined&&!value.folders?.some((f:any)=>f.id===card.folderId))throw new Error('卡片文件夹引用无效。');
    if (card.layout !== undefined) {
      const component = value.components.find((c: Component) => c.manifest.id === value.instances.find((i: any) => i.id === card.instanceId).componentId);
      if (!object(card.layout) || !layoutsFor(component).variants.some(v => v.id === card.layout.variant)) throw new Error('此组件不支持所选卡片尺寸。');
      const p = card.layout.position;
      if (p !== undefined && (!object(p) || !Number.isInteger(p.column) || !Number.isInteger(p.row) || !Number.isInteger(p.columns) || p.columns < 1 || p.columns > 12 || p.column < 0 || p.column >= p.columns || p.row < 0 || p.row >= 10000)) throw new Error('卡片位置必须使用有效的整数格位。');
      const h=card.layout.horizontalPosition;
      if(h!==undefined&&(!object(h)||!Number.isInteger(h.column)||!Number.isInteger(h.row)||!Number.isInteger(h.rows)||h.rows<1||h.rows>8||h.column<0||h.column>=10000||h.row<0||h.row>=h.rows))throw new Error('横向卡片位置无效。');
    }
  }
  if(value.cardGroups!==undefined) {
    if(!Array.isArray(value.cardGroups)||value.cardGroups.length>500)throw new Error('组合文件夹列表无效。');
    unique(value.cardGroups,g=>g?.id);const grouped=new Set<string>();
    for(const group of value.cardGroups) {
      if(!object(group)||!text(group.name)||!['rings','bars'].includes(group.style)||!Array.isArray(group.cardIds)||group.cardIds.length<2||group.cardIds.length>32||new Set(group.cardIds).size!==group.cardIds.length)throw new Error('组合文件夹配置无效。');
      if(group.simple!==undefined&&typeof group.simple!=='boolean')throw new Error('组合文件夹简洁模式无效。');
      const folder=value.cards.find((c:any)=>c.id===group.cardIds[0])?.folderId;
      for(const id of group.cardIds){if(!text(id)||grouped.has(id)||!value.cards.some((c:any)=>c.id===id&&c.folderId===folder))throw new Error('组合文件夹的成员引用无效。');grouped.add(id);}
      if(group.layout!==undefined) {
        if(!object(group.layout)||!officialLayouts.variants.some(v=>v.id===group.layout.variant))throw new Error('组合文件夹尺寸无效。');
        const p=group.layout.position,h=group.layout.horizontalPosition;
        if(p!==undefined&&(!object(p)||!Number.isInteger(p.column)||!Number.isInteger(p.row)||!Number.isInteger(p.columns)||p.columns<1||p.columns>12||p.column<0||p.column>=p.columns||p.row<0||p.row>=10000))throw new Error('组合文件夹位置无效。');
        if(h!==undefined&&(!object(h)||!Number.isInteger(h.column)||!Number.isInteger(h.row)||!Number.isInteger(h.rows)||h.rows<1||h.rows>8||h.column<0||h.column>=10000||h.row<0||h.row>=h.rows))throw new Error('组合文件夹横向位置无效。');
      }
    }
  }
}
