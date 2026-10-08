import { groupForCard,visibleGroupCards } from './cardGroups';
import { type Card, type CardLayouts, type Component, type GridSpan, type LayoutVariant, type Workspace } from './model';

// Official renderers own these variants; component declarations can restrict or replace them.
export const officialLayouts: CardLayouts = {
  default: 'wide',
  variants: [
    { id: 'compact', label: '紧凑', span: { columns: 1, rows: 1 } },
    { id: 'wide', label: '横向', span: { columns: 2, rows: 1 }, fallback: 'compact' },
    { id: 'large', label: '大', span: { columns: 2, rows: 2 }, fallback: 'wide' },
    { id: 'expanded', label: '扩展', span: { columns: 4, rows: 2 }, fallback: 'large' },
    ...Array.from({length:4}, (_, row) => Array.from({length:4}, (_, column) => ({ columns:column+1, rows:row+1 }))).flat()
      .filter(s => !['1x1','2x1','2x2','4x2'].includes(`${s.columns}x${s.rows}`))
      .map(span => ({ id:`size-${span.columns}x${span.rows}`, span, fallback:span.columns === 1 ? 'compact' : span.columns - 1 === 1 && span.rows === 1 ? 'compact' : span.columns - 1 === 2 && span.rows === 1 ? 'wide' : span.columns - 1 === 2 && span.rows === 2 ? 'large' : `size-${span.columns - 1}x${span.rows}` })),
  ],
};
export function layoutComponent(workspace:Workspace,card:Card):Component {const component=workspace.components.find(c=>c.manifest.id===workspace.instances.find(i=>i.id===card.instanceId)!.componentId)!;return groupForCard(workspace,card.id)?.cardIds[0]===card.id?{...component,manifest:{...component.manifest,cardLayouts:officialLayouts}}:component;}
export const layoutsFor = (component: Component) => ['dev.progress.codex-usage','dev.progress.connected-quota'].includes(component.manifest.id) ? officialLayouts : component.manifest.cardLayouts ?? officialLayouts;
export const preferredVariant = (card: Card, component: Component) => card.layout?.variant ?? layoutsFor(component).default;
export const variantLabel = (variant: LayoutVariant) => !variant.label && variant.id.startsWith('size-') ? `${variant.span.columns}×${variant.span.rows}` : `${variant.label ?? variant.id} · ${variant.span.columns}×${variant.span.rows}`;
export const variantDensity = (span: GridSpan) => span.columns === 1 && span.rows === 1 ? 'compact' : span.rows === 1 ? 'wide' : span.columns === 1 ? 'tall' : span.columns * span.rows >= 8 ? 'expanded' : 'large';
export const gridTokens = { minCell: 168, preferredCell: 190, maxCell: 336, minGap: 12, preferredGap: 16, maxGap: 20, minInset: 0, maxInset: 12 };
export function resolveGrid(width: number) {
  const available = Math.max(0, width);
  const columns = Math.max(1, Math.min(12, Math.floor((available + gridTokens.minGap) / (gridTokens.minCell + gridTokens.minGap))));
  const desiredGap = Math.max(gridTokens.minGap, Math.min(gridTokens.maxGap, gridTokens.preferredGap + (available / columns - gridTokens.preferredCell) / 15));
  const gap = columns > 1 ? Math.max(gridTokens.minGap, Math.min(desiredGap, (available - columns * gridTokens.minCell) / (columns - 1))) : desiredGap;
  const inset = Math.min(gridTokens.maxInset, Math.max(0, (available - columns * gridTokens.maxCell - (columns - 1) * gap) / 2));
  const cell = Math.max(0, (available - 2 * inset - gap * (columns - 1)) / columns);
  return { columns, gap, cell, rowHeight: cell, inset };
}
export function fittingVariant(component: Component, preferred: string, columns: number): LayoutVariant | null {
  const { variants, default: defaultId } = layoutsFor(component);
  const first = variants.find(v => v.id === preferred) ?? variants.find(v => v.id === defaultId)!;
  let current: LayoutVariant | undefined = first;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.span.columns <= columns) return current;
    seen.add(current.id); current = variants.find(v => v.id === current!.fallback);
  }
  return variants.filter(v => v.span.columns <= columns).sort((a, b) =>
    Math.abs(a.span.columns * a.span.rows - first.span.columns * first.span.rows) - Math.abs(b.span.columns * b.span.rows - first.span.columns * first.span.rows))[0] ?? null;
}
export function fittingHorizontalVariant(component:Component,preferred:string,rows:number):LayoutVariant|null {
  const variants=layoutsFor(component).variants;let current=variants.find(v=>v.id===preferred)??variants.find(v=>v.id===layoutsFor(component).default);const seen=new Set<string>();
  while(current&&!seen.has(current.id)){if(current.span.rows<=rows)return current;seen.add(current.id);current=variants.find(v=>v.id===current!.fallback);}
  return variants.filter(v=>v.span.rows<=rows).sort((a,b)=>Math.abs(a.span.rows-rows)-Math.abs(b.span.rows-rows))[0]??null;
}
export function resolveHorizontalGrid(width:number,height:number) {
  const gap=16,cell=Math.max(168,Math.min(210,resolveGrid(width).cell));
  const rows=Math.max(1,Math.min(8,Math.floor((Math.max(168,height)+gap)/(cell+gap))));
  return {cell,gap,rows,height:Math.max(168,height)};
}
export type Placement = { id: string; column: number; row: number; span: GridSpan; variant: LayoutVariant | null };
export function intersects(a: Pick<Placement, 'column' | 'row' | 'span'>, b: Pick<Placement, 'column' | 'row' | 'span'>) {
  return a.column < b.column + b.span.columns && b.column < a.column + a.span.columns && a.row < b.row + b.span.rows && b.row < a.row + a.span.rows;
}
const cells = (slot: Pick<Placement, 'column' | 'row' | 'span'>) => {
  const keys: string[] = [];
  for (let y = slot.row; y < slot.row + slot.span.rows; y++) for (let x = slot.column; x < slot.column + slot.span.columns; x++) keys.push(`${x}:${y}`);
  return keys;
};
const valid = (column: number, row: number, span: GridSpan, columns: number) => Number.isInteger(column) && Number.isInteger(row) && Number.isInteger(span.columns) && Number.isInteger(span.rows) && span.columns >= 1 && span.columns <= 12 && span.rows >= 1 && span.rows <= 8 && column >= 0 && row >= 0 && row < 10000 && column + span.columns <= columns;
function nearest(span: GridSpan, origin: { column: number; row: number }, occupied: Set<string>, columns: number) {
  const column = Math.min(Math.max(0, origin.column), columns - span.columns), row = Math.max(0, origin.row);
  for (let distance = 0; distance < 10000 + columns; distance++) {
    const candidates: { column: number; row: number }[] = [];
    for (let dy = -distance; dy <= distance; dy++) {
      const dx = distance - Math.abs(dy);
      candidates.push({ column: column - dx, row: row + dy });
      if (dx) candidates.push({ column: column + dx, row: row + dy });
    }
    candidates.sort((a, b) => a.row - b.row || a.column - b.column);
    const free = candidates.find(p => valid(p.column, p.row, span, columns) && cells({ ...p, span }).every(key => !occupied.has(key)));
    if (free) return free;
  }
  throw new Error('没有可用的卡片位置。');
}
function firstFit(span: GridSpan, occupied: Set<string>, columns: number) {
  for (let row = 0; row < 10000; row++) for (let column = 0; column <= columns - span.columns; column++) {
    if (cells({ column, row, span }).every(key => !occupied.has(key))) return { column, row };
  }
  throw new Error('没有可用的卡片位置。');
}
const transpose=(slot:Placement):Placement=>({...slot,column:slot.row,row:slot.column,span:{columns:slot.span.rows,rows:slot.span.columns},variant:slot.variant?{...slot.variant,span:{columns:slot.variant.span.rows,rows:slot.variant.span.columns}}:null});
export function resolvePlacements(workspace: Workspace, columns: number, horizontal=false): Placement[] {
  const occupied = new Set<string>(), result = new Map<string, Placement>();
  const visualCards=visibleGroupCards(workspace);
  const candidates = visualCards.map(card => {
    const instance = workspace.instances.find(i => i.id === card.instanceId)!;
    const component = layoutComponent(workspace,card);
    const variant = horizontal?fittingHorizontalVariant(component,preferredVariant(card,component),columns):fittingVariant(component, preferredVariant(card, component), columns);
    const span=variant?.span ?? {columns:1,rows:1};
    const position=horizontal?card.layout?.horizontalPosition:card.layout?.position;
    return { card, variant, span:horizontal?{columns:span.rows,rows:span.columns}:span,position:position?(horizontal?{column:position.row,row:position.column}:position):undefined };
  });
  // Reserve all still-valid hints first. A newly added card must not displace existing cards.
  const place = (candidate: typeof candidates[number], position: { column: number; row: number }) => {
    const slot = { id: candidate.card.id, column: position.column, row: position.row, span: candidate.span, variant: candidate.variant };
    cells(slot).forEach(key => occupied.add(key)); result.set(slot.id, slot);
  };
  for (const candidate of candidates) {
    const p = candidate.position;
    if (p && valid(p.column, p.row, candidate.span, columns) && cells({ ...p, span: candidate.span }).every(key => !occupied.has(key))) place(candidate, p);
  }
  for (const candidate of candidates.filter(item => !result.has(item.card.id))) {
    const p = candidate.position;
    place(candidate, p ? nearest(candidate.span, p, occupied, columns) : firstFit(candidate.span, occupied, columns));
  }
  return visualCards.map(card => {const slot=result.get(card.id)!;return horizontal?{...slot,column:slot.row,row:slot.column,span:{columns:slot.span.rows,rows:slot.span.columns}}:slot;});
}
export function reflowHorizontal(placements:Placement[],id:string,position:{column:number;row:number},variant:LayoutVariant,rows:number) {
  const next=reflow(placements.map(transpose),id,{column:position.row,row:position.column},{...variant,span:{columns:variant.span.rows,rows:variant.span.columns}},rows);
  return next?.map(transpose)??null;
}
export function fillHorizontalHoles(placements:Placement[],rows:number,pinnedId?:string) {return fillHoles(placements.map(transpose),rows,pinnedId).map(transpose);}
export function reflow(placements: Placement[], id: string, position: { column: number; row: number }, variant: LayoutVariant, columns: number): Placement[] | null {
  if (!valid(position.column, position.row, variant.span, columns) || !placements.some(p => p.id === id)) return null;
  const target: Placement = { id, ...position, span: variant.span, variant };
  const fixed = placements.filter(p => p.id !== id && !intersects(p, target));
  const displaced = placements.filter(p => p.id !== id && intersects(p, target)).sort((a, b) => a.row - b.row || a.column - b.column);
  const occupied = new Set([...fixed, target].flatMap(cells)), changed = new Map<string, Placement>([[id, target]]);
  for (const slot of displaced) {
    const next = { ...slot, ...nearest(slot.span, slot, occupied, columns) };
    cells(next).forEach(key => occupied.add(key)); changed.set(next.id, next);
  }
  return placements.map(p => changed.get(p.id) ?? p);
}
export function commitPlacements(workspace: Workspace, placements: Placement[], columns: number, preference?: { id: string; variant: string }, horizontal=false): Workspace {
  const slots = new Map(placements.map(slot => [slot.id, slot]));
  const cards = workspace.cards.map(card => {
    const slot = slots.get(card.id); if (!slot||groupForCard(workspace,card.id)) return card;
    const component = workspace.components.find(c => c.manifest.id === workspace.instances.find(i => i.id === card.instanceId)!.componentId)!;
    return { ...card, layout: { ...card.layout,variant: preference?.id === card.id ? preference.variant : preferredVariant(card, component), ...(horizontal?{horizontalPosition:{column:slot.column,row:slot.row,rows:columns}}:{position: { column: slot.column, row: slot.row, columns }}) } };
  });
  const cardGroups=workspace.cardGroups?.map(group=>{const slot=slots.get(group.cardIds[0]);if(!slot)return group;return {...group,layout:{...group.layout,variant:preference?.id===slot.id?preference.variant:group.layout?.variant??'large',...(horizontal?{horizontalPosition:{column:slot.column,row:slot.row,rows:columns}}:{position:{column:slot.column,row:slot.row,columns}})}};});
  return { ...workspace, cards,...(cardGroups?{cardGroups}:{}) };
}

// Move cards only forward into earlier holes, retaining stable visual order.
export function fillHoles(placements: Placement[], columns: number, pinnedId?: string): Placement[] {
  const pinned = placements.find(p => p.id === pinnedId);
  const occupied = new Set<string>(pinned ? cells(pinned) : []);
  return [...placements].sort((a,b) => a.row-b.row || a.column-b.column).map(slot => {
    if (slot.id === pinnedId) return slot;
    const candidate = firstFit(slot.span, occupied, columns);
    const next = { ...slot, ...(candidate.row * columns + candidate.column < slot.row * columns + slot.column ? candidate : { row: slot.row, column: slot.column }) };
    cells(next).forEach(key => occupied.add(key)); return next;
  });
}
