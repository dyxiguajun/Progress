import type { Workspace } from './model';
import type { Snapshot } from './sourceState';
export type CardSearchResult = { id: string; folderId: string; title: string; folder: string; componentId: string; context: string };
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
export function searchCards(workspace: Workspace, snapshots: Record<string, Snapshot>, query: string): CardSearchResult[] {
  const tokens = normalized(query).split(/\s+/).filter(Boolean);
  return workspace.cards.flatMap((card, index) => {
    const instance = workspace.instances.find(i => i.id === card.instanceId);
    const component = workspace.components.find(c => c.manifest.id === instance?.componentId);
    if (!instance || !component) return [];
    const metric = snapshots[instance.id]?.metrics.find(m => m.id === card.metricId);
    const folder = workspace.folders?.find(f => f.id === (card.folderId ?? workspace.folders?.[0]?.id));
    const title = card.title ?? (metric && metric.id !== 'main' ? metric.name : instance.name);
    const connections = workspace.connections?.filter(c => instance.connectionIds?.includes(c.id)) ?? [];
    // Index display metadata only. Endpoint, config and credentials never enter search results.
    const context = [component.manifest.name, component.manifest.quotaProvider?.name, snapshots[instance.id]?.sourceDevice, ...connections.flatMap(c => [c.label, c.sourceDevice])].filter(Boolean).join(' · ');
    const haystack = normalized([title, instance.name, metric?.name, folder?.name, context].join(' '));
    if (!tokens.every(token => haystack.includes(token))) return [];
    const rank = !tokens.length ? 2 : normalized(title) === normalized(query) ? 0 : normalized(title).startsWith(normalized(query)) ? 1 : 2;
    return [{ id: card.id, folderId: folder?.id ?? 'default', title, folder: folder?.name ?? '日常', componentId: component.manifest.id, context, rank, index }];
  }).sort((a, b) => a.rank - b.rank || a.index - b.index);
}
