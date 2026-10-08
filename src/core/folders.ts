import {groupForCard,moveGroup,pruneCardGroups} from './cardGroups';
import { clone, uid, type Workspace, type Folder } from './model';
export const defaultFolder: Folder = { id: 'default', name: '日常', icon: 'folder', color: '#197b65' };
export function migrateFolders(workspace: Workspace): Workspace {
  const next = clone(workspace); next.folders ??= [clone(defaultFolder)]; next.autoFill ??= true; next.connections ??= []; delete (next as Workspace & {wheelMode?:unknown}).wheelMode;
  for (const card of next.cards) if (!next.folders.some(f => f.id === card.folderId)) card.folderId = next.folders[0].id;
  return pruneCardGroups(next);
}
export function folderWorkspace(workspace: Workspace, id: string): Workspace { return pruneCardGroups({ ...workspace, cards: workspace.cards.filter(c => (c.folderId ?? 'default') === id) }); }
export function moveCard(workspace: Workspace, cardId: string, folderId: string): Workspace {
  if (!workspace.folders?.some(f => f.id === folderId)) throw new Error('文件夹不存在。');
  const group=groupForCard(workspace,cardId);if(group)return moveGroup(workspace,group.id,folderId);
  return { ...workspace, cards: workspace.cards.map(c => c.id === cardId ? { ...c, folderId, layout: c.layout ? { variant: c.layout.variant } : undefined } : c) };
}
export function duplicateFolder(workspace: Workspace, id: string): Workspace {
  const next = clone(workspace), folder = next.folders!.find(f => f.id === id)!; const folderId = uid();
  next.folders!.push({ ...folder, id: folderId, name: `${folder.name} · 副本` });
  const copiedCards=new Map<string,string>();
  next.cards.push(...next.cards.filter(c=>c.folderId===id).map(c=>{const cardId=uid();copiedCards.set(c.id,cardId);return {...c,id:cardId,folderId};}));
  if(next.cardGroups)next.cardGroups.push(...next.cardGroups.filter(g=>g.cardIds.every(id=>copiedCards.has(id))).map(g=>({...clone(g),id:uid(),cardIds:g.cardIds.map(id=>copiedCards.get(id)!)})));
  return next;
}
export function reorderFolder(workspace: Workspace, id: string, offset: -1 | 1): Workspace {
  const folders = [...(workspace.folders ?? [])], index = folders.findIndex(f => f.id === id), target = index + offset;
  if (index < 0 || target < 0 || target >= folders.length) return workspace;
  [folders[index], folders[target]] = [folders[target], folders[index]];
  return { ...workspace, folders };
}
