import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ArrowRight, Copy, FileOutput, Grid2X2, Minus, Settings, Trash2 } from 'lucide-react';
import { ContextVeil } from './shared';
import { useContinuousSurface } from './geometry';
import { type Card, type LayoutVariant, type Workspace } from '../core/model';
import { layoutComponent, fittingVariant, fittingHorizontalVariant, resolveHorizontalGrid, layoutsFor, preferredVariant, reflow, resolveGrid, resolvePlacements, reflowHorizontal, variantDensity, variantLabel, type Placement } from '../core/grid';
import { HOLD_FOR_DRAG, HOLD_FOR_MENU, GROUP_CENTER_HOLD, GROUP_APPROACH_IDLE, movementIntent, anchorMenu, jiggleParameters, retainValidPlacement, groupingIntent, type GroupingIntent } from '../core/gestures';
import { type Snapshot } from '../core/sourceState';
import {groupForCard,visibleGroupCards} from '../core/cardGroups';
import {GroupCard} from './GroupCard';
import { ProgressCard } from './ProgressCard';
import { SurfaceOutline } from './SurfaceOutline';
import { createWheelMapper } from '../core/scroll';
import { usePresence, useRetained, useReducedMotion } from './motion';


type GridController = { dismiss: () => boolean; columns: number; rows:number };
type Props = {
  workspace: Workspace; visibleIds: string[]; snapshots: Record<string, Snapshot>; now: number; online: boolean;
  editing: boolean; onEditing: (value: boolean) => void; layoutCard: string | null; onLayoutCard: (id: string | null) => void;
  focusCardId?: string | null;
  controller: RefObject<GridController | null>;
  onCommit: (slots: Placement[], columns: number, preference?: { id: string; variant: string }) => void;
  onGroup:(source:string,target:string)=>void; onMember:(card:Card)=>void;
  onMove: (card: Card) => void; onEdit: (card: Card) => void; onDetails: (card: Card) => void; onDuplicate: (card: Card) => void; onExport: (card: Card) => void; onRemove: (card: Card) => void; onRetry: (id: string) => void;
};
type Gesture = {
  id?: string; pointerId: number; pointerType: string; startX: number; startY: number; x: number; y: number; at: number;
  kind: 'pending' | 'drag' | 'resize' | 'context'; original: Placement[]; slot?: Placement; timer?: ReturnType<typeof setTimeout>;
  canvasLeft:number;canvasTop:number;groupTarget?:string;groupIntent?:GroupingIntent;groupTimer?:ReturnType<typeof setTimeout>;
  offsetX: number; offsetY: number; moved: boolean; editingAtStart: boolean;
};
type Preview = { id: string; mode: 'drag' | 'resize'; slots: Placement[]; ghost: Placement; x: number; y: number; preference: string };

export function WorkspaceGrid(props: Props) {
  const { workspace, editing, onEditing, layoutCard, onLayoutCard } = props;
  const root = useRef<HTMLElement>(null),viewport=useRef<HTMLDivElement>(null);
  const horizontal=workspace.scrollDirection==='horizontal';
  const visualCards=useMemo(()=>visibleGroupCards(workspace),[workspace.cards,workspace.cardGroups]);
  const searchTarget=props.focusCardId?(groupForCard(workspace,props.focusCardId)?.cardIds[0]??props.focusCardId):null;
  const [width, setWidth] = useState(0);
  const [viewportHeight,setViewportHeight]=useState(Math.max(168,innerHeight-144));
  const baseGrid=useMemo(()=>resolveGrid(width),[width]);
  const horizontalGrid=useMemo(()=>resolveHorizontalGrid(width,viewportHeight),[width,viewportHeight]);
  const horizontalRows=horizontalGrid.rows;
  const capacity=horizontal?horizontalRows:baseGrid.columns;
  const slots=useMemo(()=>resolvePlacements(workspace,capacity,horizontal),[workspace.cards,workspace.components,workspace.instances,workspace.cardGroups,capacity,horizontal]);
  const grid=useMemo(()=>horizontal?{...baseGrid,columns:Math.max(4,...slots.map(s=>s.column+s.span.columns))+4,cell:horizontalGrid.cell,rowHeight:horizontalGrid.cell,gap:horizontalGrid.gap,inset:0}:baseGrid,[horizontal,baseGrid,slots,horizontalGrid]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRef = useRef<Preview | null>(null), gesture = useRef<Gesture | null>(null), suppressClick = useRef(false);
  const [groupTarget,setGroupTarget]=useState<string>();
  const [pressed, setPressed] = useState<string>();
  const [recognized, setRecognized] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const [settled, setSettled] = useState<string>(), settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined), reduced = useReducedMotion();
  const editEntry = useMemo(() => Math.floor(Math.random() * 100000), [editing]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [skipContextExit, setSkipContextExit] = useState(false);
  const menuState = useRef(menu); menuState.current = menu;
  const menuPresence = usePresence(!!menu), shadePresence = usePresence(!!focusId), visibleMenu = useRetained(menu), visibleFocus = useRetained(focusId);
  const menuRef = useRef<HTMLDivElement>(null), menuTrigger = useRef<HTMLElement | null>(null);
  useContinuousSurface(menuRef,18,menuPresence.present);
  const callbacks = useRef(props); callbacks.current = props;
  const current = useRef({ grid, slots, editing }); current.current = { grid, slots, editing };
  const actions=useRef({move,finish});actions.current={move,finish};
  const announce = useRef(''); const [message, setMessage] = useState('');
  const say = (value: string) => { if (announce.current !== value) { announce.current = value; setMessage(value); } };
  const componentFor = (card: Card) => layoutComponent(workspace,card);
  function closeMenu() { setMenu(null); if (!previewRef.current) setFocusId(undefined); menuTrigger.current?.focus(); }
  function openMenu(id: string, _x?: number, _y?: number) {
    const element = root.current?.querySelector<HTMLElement>(`[data-grid-card="${CSS.escape(id)}"]`);
    if (!element) return;
    menuTrigger.current = element.querySelector('article');
    const bounds = root.current!.getBoundingClientRect();
    const point = anchorMenu(element.getBoundingClientRect(), {left:Math.max(12,bounds.left),right:window.innerWidth-12,top:88,bottom:window.innerHeight-12});
    setSkipContextExit(false); setFocusId(id); setMenu({id,...point});
  }
  function clearGesture() {
    const pending = gesture.current; if (pending) {clearTimeout(pending.timer);clearTimeout(pending.groupTimer);}
    if (pending && root.current?.hasPointerCapture(pending.pointerId)) root.current.releasePointerCapture(pending.pointerId);
    gesture.current = null; setGroupTarget(undefined); setPressed(undefined); setRecognized(undefined); previewRef.current = null; setPreview(null);
  }
  useEffect(() => {
    const resize=()=>{const node=viewport.current;if(!node)return;const available=Math.max(168,innerHeight-node.getBoundingClientRect().top-16);node.style.setProperty('--workspace-height',`${available}px`);const style=getComputedStyle(node);setViewportHeight(Math.max(128,available-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)));};
    const observer = new ResizeObserver(entries => {setWidth(entries[0].contentRect.width);resize();});
    if (viewport.current) observer.observe(viewport.current);
    resize();window.addEventListener('resize',resize);
    return () => {observer.disconnect();window.removeEventListener('resize',resize);};
  }, []);
  useEffect(() => { clearGesture();setMenu(null);setFocusId(undefined); }, [width,horizontal,capacity]);
  useEffect(() => {
    if (!width || !searchTarget) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-grid-card="${CSS.escape(searchTarget!)}"]`);
    element?.querySelector<HTMLElement>('article')?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest',inline:'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [searchTarget, width, reduced]);
  useEffect(() => {
    if(width&&visualCards.some(card=>horizontal?!card.layout?.horizontalPosition:!card.layout?.position))props.onCommit(slots,capacity);
  }, [width, slots, horizontal,capacity]);
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (menu && !menuRef.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest(`[data-grid-card="${CSS.escape(menu.id)}"]`)) closeMenu(); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  useEffect(() => {
    const dismiss = () => {
      if (gesture.current?.kind === 'drag' || gesture.current?.kind === 'resize') { suppressClick.current = true; clearGesture(); return true; }
      if (menu) { closeMenu(); return true; }
      return false;
    };
    props.controller.current = { dismiss, columns: baseGrid.columns,rows:horizontalRows };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        if (!dismiss() && editing) onEditing(false);
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { props.controller.current = null; document.removeEventListener('keydown', keyboard); };
  }, [menu, layoutCard, editing, baseGrid.columns,horizontalRows]);
  useEffect(() => () => { const pending = gesture.current; if (pending) {clearTimeout(pending.timer);clearTimeout(pending.groupTimer);} clearTimeout(settleTimer.current); }, []);

  useEffect(() => { if (!editing) { clearGesture(); setMenu(null); setFocusId(undefined); onLayoutCard(null); } }, [editing]);

  useEffect(()=>{
    const node=viewport.current;if(!node||!horizontal)return;
    const map=createWheelMapper();
    const wheel=(event:WheelEvent)=>{
      if(document.querySelector('dialog[open]')||(event.target as HTMLElement).closest('input,textarea,select,[role="menu"]'))return;
      const delta=map(event,node.clientWidth);if(delta===null||node.scrollWidth<=node.clientWidth)return;
      const next=Math.max(0,Math.min(node.scrollWidth-node.clientWidth,node.scrollLeft+delta));
      if(next===node.scrollLeft)return;event.preventDefault();node.scrollLeft=next;
    };
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[horizontal]);
  function begin(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    clearTimeout(settleTimer.current); setSettled(undefined);
    const element = event.target as HTMLElement, slotElement = element.closest<HTMLElement>('[data-grid-card]');
    const handle = element.closest('[data-resize]');
    if (!handle && element.closest('button, input, select, a')&&!element.closest('.group-member')) return;
    if(element.closest('textarea,[contenteditable="true"]'))return;
    const id = slotElement?.dataset.gridCard, slot = slots.find(p => p.id === id);
    if (slot && !slot.variant) return;
    const rect = slotElement?.getBoundingClientRect();
    const pending: Gesture = { id, pointerId: event.pointerId, pointerType: event.pointerType, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, at: Date.now(), kind: handle ? 'resize' : 'pending', original: slots, slot,
      canvasLeft:root.current!.getBoundingClientRect().left,canvasTop:root.current!.getBoundingClientRect().top,offsetX: rect ? event.clientX - rect.left : 0, offsetY: rect ? event.clientY - rect.top : 0, moved: false, editingAtStart: editing };
    gesture.current = pending; if (id && !editing && !handle) setPressed(id);
    if (handle) { event.preventDefault(); if (event.pointerType !== 'touch') root.current?.setPointerCapture(event.pointerId); }
    else if (!(editing && !id)) pending.timer = setTimeout(() => {
      if (gesture.current !== pending || pending.moved) return;
      if (editing && id) { activateDrag(pending); return; }
      pending.kind = 'context'; suppressClick.current = true;
      if (id) {
        setPressed(undefined); setRecognized(id); openMenu(id);
        if (pending.pointerType !== 'touch') root.current?.setPointerCapture(pending.pointerId);
      } else callbacks.current.onEditing(true);
    }, editing ? HOLD_FOR_DRAG : HOLD_FOR_MENU);
  }
  function activateDrag(g: Gesture) {
    if (!g.id || !g.slot?.variant) return;
    clearTimeout(g.timer); g.kind = 'drag'; suppressClick.current = true;
    window.getSelection()?.removeAllRanges();
    setPressed(undefined); setRecognized(undefined); setSkipContextExit(true); setMenu(null); setFocusId(undefined);
    callbacks.current.onEditing(true);
    if (g.pointerType !== 'touch') root.current?.setPointerCapture(g.pointerId);
    const card = visibleGroupCards(callbacks.current.workspace).find(c => c.id === g.id)!;
    const component = layoutComponent(callbacks.current.workspace,card);
    const next: Preview = { id:g.id, mode:'drag', slots:g.original, ghost:g.slot, x:0, y:0, preference:preferredVariant(card, component) };
    previewRef.current = next; setPreview(next);
  }
  function move(x: number, y: number, allowGrouping = true) {
    const g = gesture.current; if (!g) return;
    const previousPoint={x:g.x,y:g.y};g.x=x;g.y=y;
    const distance = Math.hypot(x - g.startX, y - g.startY);
    if (g.kind === 'context') { if (distance < 10 || !g.id) return; activateDrag(g); }
    if (g.kind === 'pending') {
      const intent = movementIntent(g.pointerType, Date.now() - g.at, distance, g.editingAtStart, !!g.id);
      if (intent === 'wait') return;
      clearTimeout(g.timer); g.moved = true;
      if (intent === 'scroll') { suppressClick.current = true; clearGesture(); return; }
      activateDrag(g);
    }
    if (!g.id || !g.slot?.variant || distance < 3 && !g.moved) return;
    g.moved = true; suppressClick.current = true;
    const { grid: capacity } = current.current, bounds = root.current!.getBoundingClientRect();
    const card = visibleGroupCards(callbacks.current.workspace).find(c => c.id === g.id)!;
    const component = layoutComponent(callbacks.current.workspace,card);
    let variant = g.slot.variant, column = g.slot.column, row = g.slot.row;
    if (g.kind === 'resize') {
      const targetColumns = g.slot.span.columns + (x - g.startX - (bounds.left-g.canvasLeft)) / (capacity.cell + capacity.gap);
      const targetRows = g.slot.span.rows + (y - g.startY - (bounds.top-g.canvasTop)) / (capacity.rowHeight + capacity.gap);
      variant = layoutsFor(component).variants.filter(v => v.span.columns <= capacity.columns && (!horizontal||v.span.rows<=horizontalRows)).slice().sort((a, b) =>
        (a.span.columns - targetColumns) ** 2 + (a.span.rows - targetRows) ** 2 - ((b.span.columns - targetColumns) ** 2 + (b.span.rows - targetRows) ** 2))[0];
      if(!variant)return;column=Math.min(column,capacity.columns-variant.span.columns);if(horizontal)row=Math.min(row,horizontalRows-variant.span.rows);
    } else {
      column = Math.round((x - bounds.left - capacity.inset - g.offsetX) / (capacity.cell + capacity.gap));
      row = Math.round((y - bounds.top - g.offsetY) / (capacity.rowHeight + capacity.gap));
    }
    const previous = previewRef.current ?? { slots:g.original, ghost:g.slot };
    const inside = g.kind === 'resize' || x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    const at=Date.now();
    const intent=allowGrouping&&g.kind==='drag'?groupingIntent({x,y},g.original.filter(s=>s.id!==g.id).map(s=>({id:s.id,left:bounds.left+capacity.inset+s.column*(capacity.cell+capacity.gap),top:bounds.top+s.row*(capacity.rowHeight+capacity.gap),width:s.span.columns*capacity.cell+(s.span.columns-1)*capacity.gap,height:s.span.rows*capacity.rowHeight+(s.span.rows-1)*capacity.gap})),previousPoint,g.groupIntent??{},at):{};
    g.groupIntent=intent;g.groupTarget=intent.target;setGroupTarget(intent.target);
    clearTimeout(g.groupTimer);
    if(intent.approach&&!intent.target){const deadline=intent.centerAt!==undefined?intent.centerAt+GROUP_CENTER_HOLD:intent.approachAt!+GROUP_APPROACH_IDLE;g.groupTimer=setTimeout(()=>{if(gesture.current===g)actions.current.move(g.x,g.y);},Math.max(1,deadline-at));}
    const retained = intent.approach?{slots:g.original,ghost:g.slot}:retainValidPlacement(previous, g.original, g.id, inside ? {column,row} : null, variant, horizontal?horizontalRows:capacity.columns,horizontal);
    const next: Preview = { id: g.id, mode: g.kind as 'drag' | 'resize', ...retained,
      x: x - g.startX, y: y - g.startY, preference: g.kind === 'resize' ? retained.ghost.variant!.id : preferredVariant(card, component) };
    previewRef.current = next; setPreview(next);
    if (retained !== previous) say(`${g.kind === 'resize' ? '尺寸' : '位置'}：${variantLabel(retained.ghost.variant!)}，第 ${retained.ghost.row + 1} 行、第 ${retained.ghost.column + 1} 列`);
  }
  function finish(cancelled = false) {
    const g = gesture.current;
    if (!g) return;
    // Dropping before the center hold completes is a normal move, even though
    // the target stayed still while the user was considering grouping it.
    if(!cancelled&&g.kind==='drag'&&g.groupIntent?.approach&&!g.groupTarget)actions.current.move(g.x,g.y,false);
    const pending = previewRef.current;
    if (!cancelled && pending && g.moved) {
      if(g.groupTarget){callbacks.current.onGroup(pending.id,g.groupTarget);say('已组成文件夹。');}
      else {callbacks.current.onCommit(pending.slots, capacity, { id: pending.id, variant: pending.preference });say('布局已更新。');}
    } else if (pending) say('保留原布局。');
    else if (!cancelled && g.kind === 'resize' && !g.moved && g.id) {
      suppressClick.current = true;
      callbacks.current.onLayoutCard(g.id);
    }
    if (pending) { setSettled(pending.id); clearTimeout(settleTimer.current); settleTimer.current = setTimeout(() => setSettled(undefined), 240); }
    clearGesture(); if (g.kind === 'drag' || g.kind === 'resize' || !menuState.current) setFocusId(undefined);
    setTimeout(() => { suppressClick.current = false; }, 100);
  }
  // A held touch can move a widget; an immediate vertical swipe remains page scrolling.
  useEffect(() => {
    const canvas = root.current; if (!canvas) return;
    const touchmove = (event: TouchEvent) => {
      const g = gesture.current; if (!g || !event.touches[0]) return;
      if (g.kind === 'drag' || g.kind === 'resize' || g.kind === 'context' && !!g.id || g.kind === 'pending' && Date.now() - g.at >= (g.editingAtStart ? HOLD_FOR_DRAG : HOLD_FOR_MENU)) {
        event.preventDefault(); actions.current.move(event.touches[0].clientX, event.touches[0].clientY);
      } else if (g.kind === 'pending') actions.current.move(event.touches[0].clientX, event.touches[0].clientY);
    };
    const touchend = () => actions.current.finish();
    const touchcancel = () => actions.current.finish(true);
    canvas.addEventListener('touchmove', touchmove, { passive: false }); canvas.addEventListener('touchend', touchend); canvas.addEventListener('touchcancel', touchcancel);
    return () => { canvas.removeEventListener('touchmove', touchmove); canvas.removeEventListener('touchend', touchend); canvas.removeEventListener('touchcancel', touchcancel); };
  }, []);
  useEffect(() => {
    const pointerMove = (event: PointerEvent) => { if (gesture.current?.pointerId === event.pointerId && event.pointerType !== 'touch') actions.current.move(event.clientX, event.clientY); };
    const pointerUp = (event: PointerEvent) => { if (gesture.current?.pointerId === event.pointerId && event.pointerType !== 'touch') actions.current.finish(event.type === 'pointercancel'); };
    document.addEventListener('pointermove', pointerMove); document.addEventListener('pointerup', pointerUp); document.addEventListener('pointercancel', pointerUp);
    return () => { document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerUp); document.removeEventListener('pointercancel', pointerUp); };
  }, []);
  useEffect(() => {
    if (!preview) return;
    let frame: number;
    const scroll = () => {
      const g = gesture.current;
      if (g && (g.kind === 'drag'||g.kind==='resize')) {
        const bounds=viewport.current!.getBoundingClientRect();
        let delta=horizontal?(g.x>bounds.right-65?10:g.x<bounds.left+65?-10:0):(g.y>innerHeight-65?10:g.y<85?-10:0);
        if(delta&&g.kind==='resize'&&g.slot){const canvas=root.current!.getBoundingClientRect(),geometry=current.current.grid,card=callbacks.current.workspace.cards.find(c=>c.id===g.id)!;const variants=layoutsFor(layoutComponent(callbacks.current.workspace,card)).variants.filter(v=>v.span.columns<=geometry.columns&&(!horizontal||v.span.rows<=horizontalRows));const spans=variants.map(v=>horizontal?v.span.columns:v.span.rows);const requested=horizontal?g.slot.span.columns+(g.x-g.startX-(canvas.left-g.canvasLeft))/(geometry.cell+geometry.gap):g.slot.span.rows+(g.y-g.startY-(canvas.top-g.canvasTop))/(geometry.rowHeight+geometry.gap);if(delta>0&&requested>=Math.max(...spans)||delta<0&&requested<=Math.min(...spans))delta=0;}
        if(delta){if(horizontal)viewport.current!.scrollLeft+=delta;else window.scrollBy(0,delta);actions.current.move(g.x,g.y);}
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll); return () => cancelAnimationFrame(frame);
  }, [!!preview,horizontal]);

  const rendered = preview?.slots ?? slots;
  const resizing=preview?.mode==='resize'?gesture.current:undefined;
  const resizeRows=resizing?.slot?resizing.slot.row+Math.max(...layoutsFor(layoutComponent(workspace,workspace.cards.find(c=>c.id===resizing.id)!)).variants.map(v=>v.span.rows)):0;
  const rows = Math.max(2,resizeRows, ...rendered.map(p => p.row + p.span.rows), preview ? preview.ghost.row + preview.ghost.span.rows : 0);
  const rectangle = (slot: Placement): CSSProperties => ({ width: slot.span.columns * grid.cell + (slot.span.columns - 1) * grid.gap, height: slot.span.rows * grid.rowHeight + (slot.span.rows - 1) * grid.gap,
    transform: `translate(${grid.inset + slot.column * (grid.cell + grid.gap)}px, ${slot.row * (grid.rowHeight + grid.gap)}px)` });
  const visible = new Set(props.visibleIds);
  const contextCard = visualCards.find(c => c.id === visibleMenu?.id);
  function accessibleChange(card: Card, column: number, row: number, preference = preferredVariant(card, componentFor(card))) {
    const variant = horizontal?fittingHorizontalVariant(componentFor(card),preference,horizontalRows):fittingVariant(componentFor(card), preference, grid.columns);
    if (!variant) { say('当前空间无法显示此尺寸。'); return; }
    const next = (horizontal?reflowHorizontal:reflow)(slots, card.id, { column: Math.min(column, grid.columns - variant.span.columns), row:horizontal?Math.min(row,horizontalRows-variant.span.rows):row }, variant, capacity);
    if (next) { props.onCommit(next, capacity, { id: card.id, variant: preference }); say('布局已更新。'); }
  }
  return <>
    {!skipContextExit && shadePresence.present && <ContextVeil open={!!focusId} closing={shadePresence.closing} onClose={closeMenu}/>}
    <div ref={viewport} className={`workspace-scroll ${horizontal?'is-horizontal':''}`} tabIndex={horizontal?0:undefined} aria-label={horizontal?'横向卡片工作区':undefined}>
    <section ref={root} className={`workspace-grid ${editing ? 'is-editing' : ''} ${preview ? 'is-manipulating' : ''} ${focusId?'has-context':''}`} aria-label="进度卡片" data-columns={grid.columns}
      style={{ ...(horizontal?{width:Math.max(width,...(preview?.slots??slots).map(s=>(s.column+s.span.columns)*(grid.cell+grid.gap)-grid.gap))+(editing?grid.cell:0)}:{}),height: horizontal?viewportHeight:rows * (grid.rowHeight + grid.gap) - grid.gap, '--cell-step': `${grid.cell + grid.gap}px`, '--row-step': `${grid.rowHeight + grid.gap}px`, opacity: width ? 1 : 0 } as CSSProperties}
      onPointerDown={begin}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
      onClick={event => { if (event.target === root.current && editing) onEditing(false); }}
      onContextMenu={event => { event.preventDefault(); const element = (event.target as HTMLElement).closest<HTMLElement>('[data-grid-card]'); if (element?.dataset.gridCard) { openMenu(element.dataset.gridCard); } else onEditing(true); }}
      onKeyDown={event => {
        const element=(event.target as HTMLElement).closest<HTMLElement>('[data-grid-card]'),card=visualCards.find(c=>c.id===element?.dataset.gridCard),slot=slots.find(s=>s.id===card?.id);
        if(editing&&card&&slot&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&!(event.target as HTMLElement).closest('input,select,textarea')) {
          event.preventDefault();const dx=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,dy=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;
          if(event.altKey){const variant=layoutsFor(componentFor(card)).variants.find(v=>v.span.columns===slot.span.columns+dx&&v.span.rows===slot.span.rows+dy);if(variant)accessibleChange(card,Math.min(slot.column,grid.columns-variant.span.columns),slot.row,variant.id);}
          else accessibleChange(card,slot.column+dx,slot.row+dy);return;
        }
        if (event.key === 'F10'  && event.shiftKey || event.key === 'ContextMenu') { const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-grid-card]'); if (slot?.dataset.gridCard) { event.preventDefault(); const rect = slot.getBoundingClientRect(); openMenu(slot.dataset.gridCard, rect.left + 20, rect.top + 35); } } }}>
      {preview && <div className="grid-ghost" style={rectangle(preview.ghost)} aria-hidden="true"/>}
      {visualCards.filter(card => editing || visible.has(card.id)||groupForCard(workspace,card.id)?.cardIds.some(id=>visible.has(id))).map(card => {
        let slot = rendered.find(p => p.id === card.id);if(!slot)return null;
        const group=groupForCard(workspace,card.id);
        const active = preview?.id === card.id, g = gesture.current;
        let style = rectangle(slot);
        if (active && g?.slot) {
          slot = preview!.mode === 'resize' ? slot : g.slot;
          style = rectangle(slot);
          if (preview!.mode === 'drag') style.transform = `translate(${grid.inset + g.slot.column * (grid.cell + grid.gap) + preview!.x}px, ${g.slot.row * (grid.rowHeight + grid.gap) + preview!.y}px)`;
        }
        const instance = workspace.instances.find(i => i.id === card.instanceId)!, component = componentFor(card);
        const title = card.title ?? props.snapshots[instance.id]?.metrics.find(m => m.id === card.metricId)?.name ?? instance.name;
        return <div key={card.id} data-grid-card={card.id} data-column={slot.column} data-row={slot.row} data-variant={slot.variant?.id ?? 'unsupported'} data-mode={active ? preview?.mode : undefined} className={`grid-slot ${active ? 'is-active' : ''} ${!skipContextExit && shadePresence.present && visibleFocus === card.id ? 'is-focused' : ''} ${settled === card.id ? 'is-settling' : ''} ${searchTarget === card.id ? 'is-search-target' : ''} ${groupTarget===card.id?'is-group-target':''} ${pressed === card.id ? 'is-pressed' : ''} ${recognized === card.id ? 'is-recognized' : ''}`} style={{...style,...(() => { const p=jiggleParameters(card.id,editEntry,slot.span.columns*slot.span.rows); return {'--jiggle-angle': `${p.rotation}deg`, '--jiggle-rotation':`${p.rotationMs}ms`, '--jiggle-translation':`${p.translationMs}ms`, '--jiggle-offset':`${p.translation}px`, '--jiggle-phase':`-${p.phase}ms`}; })()} as CSSProperties}>
          <div className="grid-widget"><SurfaceOutline/>{groupTarget===card.id&&<SurfaceOutline kind="group"/>}{group?<GroupCard group={group} workspace={workspace} snapshots={props.snapshots} now={props.now} online={props.online} density={variantDensity(slot.span)} editing={editing} onOpen={()=>props.onDetails(card)} onLayout={()=>onLayoutCard(card.id)} onMember={props.onMember}/>:<ProgressCard card={card} instance={instance} component={component} snapshot={props.snapshots[instance.id]} now={props.now} online={props.online} density={variantDensity(slot.span)} editing={editing} supported={!!slot.variant}
            onEdit={() => props.onEdit(card)} onDetails={() => props.onDetails(card)} onLayout={() => {onLayoutCard(card.id);setMessage('方向键移动，Alt + 方向键调整尺寸。');}} onRetry={() => props.onRetry(instance.id)}/>}
          {editing && <><button className="grid-remove" aria-label={`移除 ${title}`} title="移除卡片" onClick={() => props.onRemove(card)}><Minus size={16}/></button>
            {layoutsFor(component).variants.length > 1 && <button className="grid-resize" data-resize="" aria-label={`调整 ${title} 的尺寸与位置`} title="拖动切换尺寸；编辑时 Alt + 方向键调整尺寸" onClick={() => {onLayoutCard(card.id);root.current?.querySelector<HTMLElement>(`[data-grid-card="${CSS.escape(card.id)}"] article`)?.focus();setMessage('方向键移动，Alt + 方向键调整尺寸。');}}><span/></button>}
            </>}</div>
        </div>;
      })}
    </section></div>
    <span className="sr-only" role="status" aria-live="polite">{message}</span>
    {!skipContextExit && menuPresence.present && visibleMenu && contextCard && <div ref={menuRef} className={`card-context continuous-surface ${menuPresence.closing ? 'is-leaving' : ''}`} aria-hidden={menuPresence.closing || undefined} role="menu" aria-label="卡片操作" style={{ left: visibleMenu.x, top: visibleMenu.y }} onKeyDown={event => {
      const items = Array.from(menuRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')), index = items.indexOf(document.activeElement as HTMLElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    }}>
      {[
        { label: '编辑', Icon: Settings, action: () => props.onEdit(contextCard) },
        { label: '复制', Icon: Copy, action: () => props.onDuplicate(contextCard) },
        { label: '导出', Icon: FileOutput, action: () => props.onExport(contextCard) },
        { label: '移至文件夹', Icon: ArrowRight, action: () => props.onMove(contextCard) },
        { label: '调整布局', Icon: Grid2X2, action: () => { onEditing(true); onLayoutCard(contextCard.id); setMessage('方向键移动，Alt + 方向键调整尺寸。'); root.current?.querySelector<HTMLElement>(`[data-grid-card="${CSS.escape(contextCard.id)}"] article`)?.focus(); } },
        { label: groupForCard(workspace,contextCard.id)?'解散组合':'移除', Icon: Trash2, action: () => props.onRemove(contextCard) },
      ].map(({ label, Icon, action }) => <button role="menuitem" key={label} className={['移除','解散组合'].includes(label) ? 'danger' : ''} onClick={() => { closeMenu(); action(); }}><Icon size={16}/>{label}</button>)}
    </div>}

  </>;
}
