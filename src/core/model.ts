import { pruneCardGroups } from './cardGroups';
import type { CardGroup } from './cardGroups';
export type Kind = 'range' | 'gauge' | 'counter' | 'time_range' | 'state' | 'indeterminate';
export type Renderer = 'bar' | 'ring' | 'number' | 'quota' | 'fill';
import type { IconName } from './iconCatalog';
export type { IconName } from './iconCatalog';
export type Config = Record<string, string | number | boolean>;
export type Secondary = { role: string; value: number; unit?: string; id?:string; label?:string };
export type Metric = {
  id: string; name: string; kind: Kind; value?: number | string; min?: number; max?: number;
  unit?: string; meaning?: string; start?: string; end?: string; status?: string;
  observed_at?: string; reset_at?: string; window_minutes?: number; stale_after?: number; secondary?: Secondary[];
};
export type Field = {
  type: 'string' | 'number' | 'integer' | 'boolean'; title?: string; description?: string;
  default?: string | number | boolean; enum?: (string | number)[];
  format?: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
};
export type ConfigSchema = {
  type: 'object'; $schema?: string; title?: string; description?: string; properties: Record<string, Field>; required?: string[]; additionalProperties?: false;
};
export type Runtime =
  | { type: 'time_range' }
  | { type: 'manual' }
  | { type: 'quota' }
  | { type: 'codex_usage' }
  | { type: 'provider_quota' }
  | { type: 'static'; entry: string }
  | { type: 'http'; url: string; refresh_interval?: number };
export type GridSpan = { columns: number; rows: number };
export type LayoutVariant = { id: string; label?: string; span: GridSpan; fallback?: string };
export type CardLayouts = { default: string; variants: LayoutVariant[] };
export type CardLayout = { variant: string; position?: { column: number; row: number; columns: number }; horizontalPosition?: { column:number;row:number;rows:number } };
export type Manifest = {
  schema: 'progress/module/v1'; id: string; name: string; version: string; description: string;
  author: string; runtime: Runtime; configuration: { schema: string };
  quotaProvider?: QuotaProvider; permissions?: string[]; renderer?: Renderer; cardLayouts?: CardLayouts;
};
export type Component = {
  manifest: Manifest; configSchema: ConfigSchema; metrics?: Metric[]; category: 'time' | 'manual' | 'services';
  icon: IconName; builtin?: boolean;
};
export type Instance = {
  id: string; componentId: string; name: string; config: Config; createdAt: string;
  demo?: boolean; networkConsent?: boolean;
  refreshInterval?: number; connectionIds?: string[]; connectionStrategy?: 'automatic' | 'direct' | 'relay';
};
export type Card = {
  id: string; instanceId: string; metricId: string; title?: string; renderer: Renderer; color: string;
  layout?: CardLayout;
  icon?: IconName;
  fillDirection?: 'bottom-up' | 'left-right';
  ringCenter?: 'auto' | 'icon' | 'value';
  quotaGroups?: string[]; folderId?: string;
  display?: { title?: boolean; status?: boolean; details?: boolean; secondary?: boolean; reset?: boolean };
  displayPreferences?: { fields:string[] };
};
export type Workspace = {
  schema: 'progress/workspace/v1'; name: string; components: Component[]; instances: Instance[]; cards: Card[];
  theme: 'light' | 'dark' | 'system'; folders?: Folder[]; autoFill?: boolean; connections?: Connection[]; scrollDirection?: 'vertical'|'horizontal'; cardGroups?:CardGroup[]; groupValues?:boolean;
};
export const colors = ['#197b65', '#6681cd', '#ce8651', '#926fbb', '#4d92a2', '#d17581'];
export const uid = () => crypto.randomUUID();
export const clone = <T,>(value: T): T => structuredClone(value);
export function defaultConfig(schema: ConfigSchema): Config {
  return Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => [key,
    field.default ?? (field.type === 'boolean' ? false : field.type === 'string' ? '' : 0)]));
}
export function proportion(metric: Metric, now = Date.now()): number | null {
  if (metric.kind === 'time_range') {
    if (!metric.start || !metric.end) return null;
    const start = Date.parse(metric.start), end = Date.parse(metric.end);
    return Math.max(0, Math.min(1, (now - start) / (end - start)));
  }
  if (metric.kind !== 'range' || typeof metric.value !== 'number' || metric.max === undefined) return null;
  return Math.max(0, Math.min(1, (metric.value - (metric.min ?? 0)) / (metric.max - (metric.min ?? 0))));
}
export function isStale(metric: Metric, now = Date.now()) {
  return !!metric.observed_at && metric.stale_after !== undefined && now - Date.parse(metric.observed_at) > metric.stale_after * 1000;
}
export function compatibleRenderers(metric?: Metric): Renderer[] {
  return metric && (metric.kind === 'range' || (metric.kind === 'time_range' && metric.start))
    ? ['bar', 'ring', 'number', 'fill'] : ['number'];
}
export function removeCard(workspace: Workspace, id: string): Workspace {
  return removeCards(workspace, [id]);
}
export function removeCards(workspace: Workspace, ids: readonly string[]): Workspace {
  const removed = new Set(ids);
  const cards = workspace.cards.filter(card => !removed.has(card.id));
  const liveInstances = new Set(cards.map(card => card.instanceId));
  const instances=workspace.instances.filter(instance=>liveInstances.has(instance.id)); const connectionIds=new Set(instances.flatMap(i=>i.connectionIds??[]));
  return pruneCardGroups({ ...workspace, cards, instances, ...(workspace.connections?{connections:workspace.connections.filter(c=>connectionIds.has(c.id))}:{}) });
}
export function restoreCards(current: Workspace, before: Workspace, ids: readonly string[]): Workspace {
  const next = clone(current), restored = new Set(ids);
  for (const card of before.cards.filter(card => restored.has(card.id))) {
    if (next.cards.some(item => item.id === card.id)) continue;
    const instance = before.instances.find(item => item.id === card.instanceId)!;
    if (!next.instances.some(item => item.id === instance.id)) { next.instances.push(clone(instance));for(const connection of before.connections?.filter(c=>instance.connectionIds?.includes(c.id))??[]){next.connections??=[];if(!next.connections.some(c=>c.id===connection.id))next.connections.push(clone(connection));} }
    if(card.folderId && !next.folders?.some(f=>f.id===card.folderId)){const folder=before.folders?.find(f=>f.id===card.folderId);if(folder){next.folders??=[];next.folders.push(clone(folder));}}
    const component = before.components.find(item => item.manifest.id === instance.componentId)!;
    if (!next.components.some(item => item.manifest.id === component.manifest.id)) next.components.push(clone(component));
    next.cards.splice(Math.min(before.cards.indexOf(card), next.cards.length), 0, clone(card));
  }
  for (const group of before.cardGroups ?? []) {
    if (!group.cardIds.some(id=>restored.has(id)) || !group.cardIds.every(id=>next.cards.some(c=>c.id===id))) continue;
    if (next.cardGroups?.some(g=>g.id!==group.id && g.cardIds.some(id=>group.cardIds.includes(id)))) continue;
    next.cardGroups=[...(next.cardGroups??[]).filter(g=>g.id!==group.id),clone(group)];
  }
  return pruneCardGroups(next);
}
export function refreshInterval(component: Component, instance: Instance): number {
  return instance.refreshInterval ?? (component.manifest.runtime.type === 'codex_usage' ? 300 : component.manifest.runtime.type === 'http' ? component.manifest.runtime.refresh_interval ?? 15 : 15);
}
export function cardBundle(workspace: Workspace, card: Card): Workspace {
  return cardsBundle(workspace, [card.id]);
}
export function cardsBundle(workspace: Workspace, cardIds: readonly string[]): Workspace {
  const selected = new Set(cardIds);
  if (cardIds.some(id => !workspace.cards.some(card => card.id === id))) throw new Error('所选卡片已不存在，请重新选择。');
  const cards = workspace.cards.filter(card => selected.has(card.id));
  const instanceIds = new Set(cards.map(card => card.instanceId));
  const instances = workspace.instances.filter(instance => instanceIds.has(instance.id));
  const componentIds = new Set(instances.map(instance => instance.componentId));
  const connectionIds=new Set(instances.flatMap(i=>i.connectionIds??[]));const folderIds=new Set(cards.map(c=>c.folderId??workspace.folders?.[0]?.id));
  return clone({ ...workspace,cardGroups:workspace.cardGroups?.map(g=>({...g,cardIds:g.cardIds.filter(id=>selected.has(id))})).filter(g=>g.cardIds.length>=2), cards, instances, ...(workspace.folders?{folders:workspace.folders.filter((f,index)=>folderIds.has(f.id)||!cards.length&&index===0)}:{}), ...(workspace.connections?{connections:workspace.connections.filter(c=>connectionIds.has(c.id))}:{}), components: workspace.components.filter(component => componentIds.has(component.manifest.id)) });
}

export type Folder = { id: string; name: string; icon: 'folder' | 'star' | 'briefcase' | 'heart'; color: string };
export type ConnectionMethod = 'local' | 'oauth' | 'api-key' | 'bearer' | 'read-only-url' | 'endpoint-secret' | 'pairing';
export type QuotaProvider = { id: string; name: string; connectionMethods: ConnectionMethod[]; helpUrl: string; credentialInstructions: string[]; requiredScopes: string[]; oauthUrl?: string; endpoint?: string };
export type Connection = { id: string; providerId: string; method: ConnectionMethod; kind: 'direct' | 'relay'; label: string; endpoint?: string; credentialRef?: string; accountKey?: string; sourceDevice?: string; sourceConnectionId?: string; deviceId?: string; priority: number; reconnect?: boolean };
