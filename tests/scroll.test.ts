import { describe,expect,it } from 'vitest';
import { createWheelMapper } from '../src/core/scroll';
import { demoWorkspace } from '../src/core/components';
import { commitPlacements,fillHorizontalHoles,intersects,layoutsFor,reflowHorizontal,resolvePlacements } from '../src/core/grid';
import { assertWorkspace } from '../src/core/validation';
import { packageWorkspace,importFile } from '../src/core/packages';
import { iconNames } from '../src/core/iconCatalog';

describe('scroll direction and native input',()=>{
  it('maps line/page and discrete wheel units, preserving modifiers and precision bursts',()=>{
    const sample={deltaMode:0,deltaX:0,deltaY:120,timeStamp:1000};
    const map=createWheelMapper();expect(map(sample,800)).toBe(120);
    expect(map({...sample,deltaMode:1,deltaY:3,timeStamp:1500},800)).toBe(96);
    expect(map({...sample,deltaMode:2,deltaY:-1,timeStamp:2000},800)).toBe(-800);
    expect(map({...sample,ctrlKey:true,timeStamp:2500},800)).toBeNull();
    expect(map({...sample,shiftKey:true,timeStamp:3000},800)).toBeNull();
    expect(map({...sample,deltaY:2.75,timeStamp:3500},800)).toBe(2.75);
    expect(map({...sample,timeStamp:3516},800)).toBe(120);
    expect(map({...sample,deltaX:120,timeStamp:4000},800)).toBeNull();
    expect(map({...sample,deltaY:63,timeStamp:4500},800)).toBe(63);
    expect(map({...sample,deltaY:53.333333333,timeStamp:5000},800)).toBe(53.333333333);
  });
  it('uses one mapping for fractional devices while preserving native horizontal gestures',()=>{const map=createWheelMapper(),e={deltaMode:0,deltaX:0,deltaY:53.333};expect(map(e,800)).toBe(53.333);expect(map({...e,deltaX:12},800)).toBeNull();expect(map({...e,ctrlKey:true},800)).toBeNull();expect(map({...e,metaKey:true},800)).toBeNull();});
  it('packs horizontal cards within rows without rotating dimensions or losing vertical positions',()=>{
    let w=demoWorkspace();const before=commitPlacements(w,resolvePlacements(w,4),4);w={...before,scrollDirection:'horizontal'};
    let slots=resolvePlacements(w,4,true);
    for(const slot of slots){expect(slot.row+slot.span.rows).toBeLessThanOrEqual(4);expect(slot.span).toEqual(slot.variant!.span);for(const other of slots)if(other!==slot)expect(intersects(slot,other)).toBe(false);}
    const moving=slots[0];slots=reflowHorizontal(slots,moving.id,{column:6,row:0},moving.variant!,4)!;
    expect(slots.find(s=>s.id===moving.id)?.column).toBe(6);
    const next=commitPlacements(w,slots,4,undefined,true);assertWorkspace(next);
    expect(next.cards.map(c=>c.layout?.position)).toEqual(before.cards.map(c=>c.layout?.position));
    expect(resolvePlacements(next,4,true)).toEqual(slots);
    expect(reflowHorizontal(slots,moving.id,{column:0,row:4},moving.variant!,4)).toBeNull();
    const filled=fillHorizontalHoles(slots,4,moving.id);expect(filled.find(s=>s.id===moving.id)?.column).toBe(6);
  });
  it('roundtrips orientation, both position sets, and every local icon',async()=>{
    let w=demoWorkspace();w.scrollDirection='horizontal';w=commitPlacements(w,resolvePlacements(w,4),4);w=commitPlacements(w,resolvePlacements(w,4,true),4,undefined,true);
    for(const icon of iconNames){w.cards[0].icon=icon;assertWorkspace(w);}
    w.cards[0].icon='gpt';const imported=await importFile('scroll.progresspack',new Uint8Array(await packageWorkspace(w)).buffer);
    expect(imported.workspace?.scrollDirection).toBe('horizontal');expect(imported.workspace?.cards[0].layout).toEqual(w.cards[0].layout);expect(imported.workspace?.cards[0].icon).toBe('gpt');
    const bad=structuredClone(w);bad.scrollDirection='diagonal' as typeof bad.scrollDirection;expect(()=>assertWorkspace(bad)).toThrow('滚动');
    bad.scrollDirection='horizontal';bad.cards[0].layout!.horizontalPosition!.row=4;expect(()=>assertWorkspace(bad)).toThrow('横向');
    expect(layoutsFor(w.components[0]).variants.length).toBeGreaterThan(0);
  });
});
