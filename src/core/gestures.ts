export const HOLD_FOR_DRAG = 180;
export const HOLD_FOR_MENU = 480;
export const MOVEMENT_THRESHOLD = 7;
export function movementIntent(_pointerType: string, elapsed: number, distance: number, editing: boolean, hasCard: boolean): 'wait' | 'scroll' | 'drag' {
  if (distance < MOVEMENT_THRESHOLD) return 'wait';
  if (!hasCard || elapsed < (editing ? HOLD_FOR_DRAG : HOLD_FOR_MENU)) return 'scroll';
  return 'drag';
}

export type PlacementPreview = { slots: Placement[]; ghost: Placement };
// Free pointer coordinates never replace a known legal footprint with an invalid one.
export function retainValidPlacement(previous: PlacementPreview, original: Placement[], id: string, candidate: {column:number;row:number} | null, variant: LayoutVariant, columns: number, horizontal=false): PlacementPreview {
  const next = candidate && (horizontal?reflowHorizontal:reflow)(original, id, candidate, variant, columns);
  return next ? { slots: next, ghost: next.find(p => p.id === id)! } : previous;
}

export function resistedDistance(delta: number) { const size = Math.abs(delta); return Math.sign(delta) * (size <= 10 ? size * .55 : size - 4.5); }
export function anchorMenu(card: {left:number;right:number;top:number;bottom:number}, viewport: {left:number;right:number;top:number;bottom:number}, menu = {width:206,height:282}) {
  const gap = 10, clamp = (n:number,min:number,max:number) => Math.max(min,Math.min(n,Math.max(min,max)));
  let x = card.right + gap, y = card.top;
  if (x + menu.width > viewport.right) { x = card.left - gap - menu.width; if (x < viewport.left) { x = card.left; y = card.bottom + gap; if (y + menu.height > viewport.bottom) y = card.top - gap - menu.height; } }
  return {x:clamp(x,viewport.left,viewport.right-menu.width),y:clamp(y,viewport.top,viewport.bottom-menu.height)};
}
export function jiggleParameters(id: string, entry: number, area: number) {
  let seed = entry; for (const c of id) seed = (Math.imul(seed,31) + c.charCodeAt(0)) >>> 0;
  const fraction = (seed % 1000) / 1000;
  const ranges = area === 1 ? [.9,1.4] : area === 2 ? [.5,.9] : area <= 4 ? [.35,.65] : [.2,.45];
  return {rotation:ranges[0]+fraction*(ranges[1]-ranges[0]),rotationMs:115+fraction*50,translationMs:145+((seed>>>4)%1000)/1000*60,translation: .2+fraction,phase:(seed>>>8)%121};
}
import { reflow, reflowHorizontal, type Placement } from './grid';
import type { LayoutVariant } from './model';

export const GROUP_CENTER_HOLD = 420;
export const GROUP_APPROACH_IDLE = 200;
export const GROUP_EDGE_INSET = 24;
export type GroupingIntent = {approach?:string;approachAt?:number;centerAt?:number;anchor?:{x:number;y:number};target?:string};
// Top and upper-side approaches keep the target still while progressing toward its
// center. Edges displace; a stable center hold is the explicit grouping intent.
export function groupingIntent(point:{x:number;y:number},targets:{id:string;left:number;top:number;width:number;height:number}[],previous:{x:number;y:number},state:GroupingIntent,now:number):GroupingIntent {
  const inCenter=(t:typeof targets[number])=>point.x>=t.left+GROUP_EDGE_INSET&&point.x<=t.left+t.width-GROUP_EDGE_INSET&&point.y>=t.top+GROUP_EDGE_INSET&&point.y<=t.top+t.height-GROUP_EDGE_INSET;
  const retained=targets.find(t=>t.id===state.approach&&point.x>=t.left-20&&point.x<=t.left+t.width+20&&point.y>=t.top-20&&point.y<=t.top+t.height-GROUP_EDGE_INSET&&(inCenter(t)||now-(state.approachAt??now)<GROUP_APPROACH_IDLE));
  const target=retained??targets.find(t=>{
    if(point.x<t.left-20||point.x>t.left+t.width+20||point.y<t.top-20||point.y>t.top+t.height-GROUP_EDGE_INSET)return false;
    const top=t.top-16,left=t.left-16,right=t.left+t.width+16;
    if(point.y>previous.y&&previous.y<top&&point.y>=top){const x=previous.x+(point.x-previous.x)*(top-previous.y)/(point.y-previous.y);if(x>=t.left&&x<=t.left+t.width)return true;}
    const side=point.x>previous.x&&previous.x<left&&point.x>=left?left:point.x<previous.x&&previous.x>right&&point.x<=right?right:undefined;
    if(side===undefined)return false;
    const y=previous.y+(point.y-previous.y)*(side-previous.x)/(point.x-previous.x);
    return y>=t.top&&y<=t.top+t.height/3;
  });
  if(!target)return {};
  const same=target.id===state.approach;
  const distance=(p:{x:number;y:number})=>Math.hypot(p.x-target.left-target.width/2,p.y-target.top-target.height/2);
  if(!inCenter(target))return {approach:target.id,approachAt:distance(previous)-distance(point)>.5||!same?now:state.approachAt};
  if(same&&state.target===target.id)return state;
  const stable=same&&state.centerAt!==undefined&&state.anchor&&Math.hypot(point.x-state.anchor.x,point.y-state.anchor.y)<=12;
  const centerAt=stable?state.centerAt!:now,anchor=stable?state.anchor!:point;
  return {approach:target.id,approachAt:now,centerAt,anchor,target:now-centerAt>=GROUP_CENTER_HOLD?target.id:undefined};
}
