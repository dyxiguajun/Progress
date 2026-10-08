import {describe,it,expect,vi} from 'vitest';
import {demoWorkspace,emptyWorkspace} from '../src/core/components';
import {clone,cardsBundle} from '../src/core/model';
import {commitPlacements,resolvePlacements,resolveGrid,layoutProfile,intersects,officialLayouts,reflow} from '../src/core/grid';
import {combineCards,duplicateGroup} from '../src/core/cardGroups';
import {moveCard} from '../src/core/folders';
import {assertWorkspace} from '../src/core/validation';
import {packageWorkspace,importFile,mergeWorkspace} from '../src/core/packages';
import {readProgressResponse} from '../src/core/httpResponse';
import {createCollector,approvedOwner,sourceUrl} from '../extension/collector';

describe('compact profile persistence',()=>{
 it('has four measured phone columns and retains desktop density',()=>{
  for(const width of [292,332,347,362,365,402]){const grid=resolveGrid(width,'mobile');expect(grid.columns).toBe(4);expect(grid.cell*4+grid.gap*3).toBeCloseTo(width);expect(grid.cell).toBeGreaterThanOrEqual(68);}
  expect(resolveGrid(1358).columns).toBe(7);expect(layoutProfile(844,390,true)).toBe('mobile');expect(layoutProfile(844,390,false)).toBe('desktop');
 });
 it('keeps all 16 footprints and desktop positions while moving/resizing on phone',()=>{
  const initial=demoWorkspace(),desktop=commitPlacements(initial,resolvePlacements(initial,6),6),original=clone(desktop.cards);
  for(const variant of officialLayouts.variants){const slots=resolvePlacements(desktop,4,false,'mobile'),moved=reflow(slots,slots[0].id,{column:0,row:3},variant,4)!;const mobile=commitPlacements(desktop,moved,4,{id:slots[0].id,variant:variant.id},false,'mobile');assertWorkspace(mobile);expect(resolvePlacements(mobile,6)).toEqual(resolvePlacements(desktop,6));expect(mobile.cards[0].layout?.mobile?.variant).toBe(variant.id);for(const card of mobile.cards){const {mobile:_,...layout}=card.layout!;expect(layout).toEqual(original.find(c=>c.id===card.id)!.layout);}}
 });
 it('isolates group layout and retains phone hints through export/merge',async()=>{
  let w=demoWorkspace();w=combineCards(w,w.cards[1].id,w.cards[0].id);w=commitPlacements(w,resolvePlacements(w,6),6);const desktop=clone(w.cardGroups![0].layout);const slots=resolvePlacements(w,4,false,'mobile');w=commitPlacements(w,slots,4,{id:slots[0].id,variant:'expanded'},false,'mobile');expect(w.cardGroups![0].layout?.variant).toBe(desktop?.variant);expect(w.cardGroups![0].layout?.position).toEqual(desktop?.position);const pack=await packageWorkspace(cardsBundle(w,w.cardGroups![0].cardIds));const restored=(await importFile('phone.progresspack',new Uint8Array(pack).buffer)).workspace!;expect(restored.cards[0].layout?.mobile).toEqual(w.cards[0].layout?.mobile);expect(restored.cardGroups![0].layout?.mobile).toEqual(w.cardGroups![0].layout?.mobile);const merged=mergeWorkspace(emptyWorkspace(),restored,'rename');assertWorkspace(merged);
 });
 it('retains both size preferences when moving and copying a group, without stale positions',()=>{
  let w=demoWorkspace();w.folders=[{id:'default',name:'Home',icon:'folder',color:'#197b65'},{id:'other',name:'Other',icon:'folder',color:'#197b65'}];w.cards.forEach(c=>c.folderId='default');w=combineCards(w,w.cards[1].id,w.cards[0].id);w.cardGroups![0].layout={variant:'large',position:{column:0,row:0,columns:6},mobile:{variant:'size-1x3',position:{column:0,row:1,columns:4}}};
  const original=clone(w.cardGroups![0]),copied=duplicateGroup(w,original.id).cardGroups![1];expect(copied.layout).toEqual({variant:'large',mobile:{variant:'size-1x3'}});expect(w.cardGroups![0]).toEqual(original);
  w=moveCard(w,original.cardIds[0],'other');expect(w.cardGroups![0].layout).toEqual(copied.layout);expect(w.cards.filter(c=>original.cardIds.includes(c.id)).every(c=>c.folderId==='other')).toBe(true);assertWorkspace(w);
 });
 it('rejects corrupt mobile hints and restores separate horizontal layouts',()=>{
  let w=demoWorkspace();w=commitPlacements(w,resolvePlacements(w,4,false,'mobile'),4,undefined,false,'mobile');w=commitPlacements(w,resolvePlacements(w,5,true,'mobile'),5,undefined,true,'mobile');const slots=resolvePlacements(w,5,true,'mobile');for(const slot of slots){expect(slot.row+slot.span.rows).toBeLessThanOrEqual(5);for(const other of slots)if(slot!==other)expect(intersects(slot,other)).toBe(false);}w.cards[0].layout!.mobile!.position!.row=-1;expect(()=>assertWorkspace(w)).toThrow('手机卡片位置');
 });
});
describe('URL diagnostics',()=>{
 it('distinguishes a website, malformed JSON and unsupported metric data',async()=>{
  await expect(readProgressResponse(new Response('<html>Home</html>',{headers:{'Content-Type':'text/html'}}),15)).rejects.toThrow('返回了网页');
  await expect(readProgressResponse(new Response('oops'),15)).rejects.toThrow('有效 JSON');
  await expect(readProgressResponse(new Response('{"hello":"world"}'),15)).rejects.toThrow('PDM');
  await expect(readProgressResponse(new Response(null,{status:404}),15)).rejects.toThrow('完整的 JSON');
 });
 it('preserves source timestamps and bounds streamed payloads',async()=>{
  const data=[{id:'main',name:'Job',kind:'range',value:4,max:10,observed_at:'2026-10-08T00:00:00Z'}];expect((await readProgressResponse(Response.json(data),30))[0]).toMatchObject({value:4,observed_at:data[0].observed_at,stale_after:90});await expect(readProgressResponse(new Response('x'.repeat(2*1024*1024+1)),15)).rejects.toThrow('2 MB');
 });
});
describe('extension background collector',()=>{
 const owner='https://progress-dyxiguajun.pages.dev',url='https://example.com/progress.json';
 function fixture(){let state:any={endpoints:[url]},at=100000;const api={storage:{local:{get:async(key:string)=>({[key]:clone(state[key])}),set:async(next:any)=>{state={...state,...clone(next)};}}},permissions:{contains:vi.fn(async()=>true)},alarms:{create:vi.fn(async()=>{}),clear:vi.fn(async()=>{})}};const request=vi.fn(async()=>Response.json([{id:'main',name:'Job',kind:'range',value:4,max:10}]));return {api,request,collector:createCollector(api,request as any,()=>at),state:()=>state,advance:()=>{at+=30000;}};}
 it('polls without a page and recovers persisted state after worker restart',async()=>{
  const f=fixture();await f.collector.sync(owner,[{id:'job',url,interval:5}]);await f.collector.poll();expect(f.api.alarms.create).toHaveBeenCalledWith('progress-poll',{periodInMinutes:.5});expect((await f.collector.read(owner,'job',url))![0].value).toBe(4);expect(f.request).toHaveBeenCalledTimes(1);f.advance();await createCollector(f.api,f.request as any,()=>130000).poll();expect(f.request).toHaveBeenCalledTimes(2);await f.collector.sync(owner,[]);expect(f.state().sources).toHaveLength(0);expect(f.api.alarms.clear).toHaveBeenCalled();
 });
 it('requires an exact approved endpoint plus host permission, rejects other owners and credentials',async()=>{
  const f=fixture();await expect(f.collector.sync('https://evil.example',[{id:'job',url,interval:15}])).rejects.toThrow('无效');await expect(f.collector.read(owner,'preview','https://example.com/private')).rejects.toThrow('尚未授权');expect(f.request).not.toHaveBeenCalled();f.api.permissions.contains.mockResolvedValue(false);await expect(f.collector.read(owner,'preview',url)).rejects.toThrow('尚未授权');expect(f.request).not.toHaveBeenCalled();expect(approvedOwner('https://progress-dyxiguajun.pages.dev.evil.example')).toBe(false);expect(()=>sourceUrl('https://user:password@example.com')).toThrow();
 });
 it('keeps the last good sample when a later response fails and clears on explicit stop',async()=>{
  const f=fixture();await f.collector.sync(owner,[{id:'job',url,interval:30}]);await f.collector.poll();f.advance();f.request.mockImplementation(async()=>new Response('<html>home</html>',{headers:{'Content-Type':'text/html'}}));await f.collector.poll();expect(f.state().sources[0].metrics[0].value).toBe(4);await expect(f.collector.read(owner,'job',url)).rejects.toThrow('返回了网页');await f.collector.clear();expect(f.state().sources).toHaveLength(0);
 });
});
