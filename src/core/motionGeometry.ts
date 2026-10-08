export type SurfaceRect={left:number;top:number;width:number;height:number};
export function visibleSurface(rect:SurfaceRect|null, viewport:{width:number;height:number}) {
  if(!rect||Object.values(rect).some(value=>!Number.isFinite(value))||rect.width<2||rect.height<2)return false;
  const intersection=Math.max(0,Math.min(rect.left+rect.width,viewport.width)-Math.max(rect.left,0))*Math.max(0,Math.min(rect.top+rect.height,viewport.height)-Math.max(rect.top,0));
  return intersection/(rect.width*rect.height)>=.25;
}
