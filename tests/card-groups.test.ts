import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {demoWorkspace} from '../src/core/components';
import {combineCards,dissolveGroup,visibleGroupCards,duplicateGroup,groupForCard,groupPresentation} from '../src/core/cardGroups';
import {cardsBundle,removeCards,restoreCards} from '../src/core/model';
import {migrateFolders,moveCard,duplicateFolder} from '../src/core/folders';
import {commitPlacements,resolvePlacements,resolveHorizontalGrid,fillHorizontalHoles,intersects} from '../src/core/grid';
import {assertWorkspace} from '../src/core/validation';
import {importFile,packageWorkspace,mergeWorkspace} from '../src/core/packages';
import {groupingIntent,GROUP_CENTER_HOLD,GROUP_APPROACH_IDLE} from '../src/core/gestures';
import {GroupMetrics} from '../src/ui/GroupCard';

function grouped(){const w=migrateFolders(demoWorkspace());return combineCards(w,w.cards[0].id,w.cards[1].id);}
describe('reference-based card folders',()=>{
  it('combines and dissolves without duplicating or discarding original data',()=>{
    const original=migrateFolders(demoWorkspace()),w=combineCards(original,original.cards[0].id,original.cards[1].id),g=w.cardGroups![0];
    assertWorkspace(w);expect(w.cards).toEqual(original.cards);expect(w.instances).toEqual(original.instances);expect(visibleGroupCards(w)).toHaveLength(w.cards.length-1);
    const slots=resolvePlacements(w,4),next=commitPlacements(w,slots,4);expect(next.cards.filter(c=>g.cardIds.includes(c.id))).toEqual(w.cards.filter(c=>g.cardIds.includes(c.id)));expect(next.cardGroups![0].layout!.position).toBeDefined();
    expect(dissolveGroup(next,g.id).cards.filter(c=>g.cardIds.includes(c.id))).toEqual(original.cards.filter(c=>g.cardIds.includes(c.id)));expect(visibleGroupCards(dissolveGroup(next,g.id))).toHaveLength(original.cards.length);
  });
  it('merges clusters, moves all members, and safely prunes removed members with undo',()=>{
    let w=grouped(),g=w.cardGroups![0];g.simple=true;w=combineCards(w,w.cards[2].id,g.cardIds[0]);g=w.cardGroups![0];expect(g.cardIds).toHaveLength(3);expect(g.simple).toBe(true);
    const removed=removeCards(w,[g.cardIds[0]]);assertWorkspace(removed);expect(removed.cardGroups![0].cardIds).toHaveLength(2);expect(restoreCards(removed,w,[g.cardIds[0]]).cardGroups).toEqual(w.cardGroups);
    const allRemoved=removeCards(w,g.cardIds);assertWorkspace(allRemoved);expect(allRemoved.cardGroups).toHaveLength(0);
    w.folders!.push({id:'next',name:'另一页',icon:'folder',color:'#197b65'});const moved=moveCard(w,g.cardIds[1],'next');assertWorkspace(moved);expect(g.cardIds.every(id=>moved.cards.find(c=>c.id===id)!.folderId==='next')).toBe(true);
    expect(combineCards(moved,g.cardIds[0],w.cards[4].id)).toBe(moved);
    const doubled=duplicateGroup(w,g.id);assertWorkspace(doubled);expect(doubled.instances).toEqual(w.instances);expect(doubled.cardGroups![1].cardIds.every(id=>!g.cardIds.includes(id))).toBe(true);expect(doubled.cardGroups![1].simple).toBe(true);
    const copiedFolder=duplicateFolder(w,w.folders![0].id);assertWorkspace(copiedFolder);expect(copiedFolder.cardGroups).toHaveLength(2);
  });
  it('roundtrips group metadata and both layouts through export and renamed import',async()=>{
    let w=grouped();w=commitPlacements(w,resolvePlacements(w,4),4);w=commitPlacements(w,resolvePlacements(w,3,true),3,undefined,true);
    w.groupValues=false;w.cardGroups![0].simple=true;const bundle=cardsBundle(w,w.cardGroups![0].cardIds),partial=cardsBundle(w,[w.cardGroups![0].cardIds[0]]);expect(partial.cardGroups).toHaveLength(0);
    const imported=(await importFile('groups.progresspack',new Uint8Array(await packageWorkspace(bundle)).buffer)).workspace!;
    expect(imported.cardGroups).toEqual(bundle.cardGroups);expect(imported.groupValues).toBe(false);assertWorkspace(imported);
    const merged=mergeWorkspace(w,imported,'rename');assertWorkspace(merged);expect(merged.cardGroups).toHaveLength(2);expect(groupForCard(merged,merged.cardGroups![1].cardIds[0])?.id).toBe(merged.cardGroups![1].id);
    const bad=structuredClone(w);bad.cardGroups![0].cardIds.push('missing');expect(()=>assertWorkspace(bad)).toThrow('成员');
  });
  it('hides percent captions while retaining a numeric hover layer and accessible semantics',()=>{
    const w=grouped();w.groupValues=false;const g=w.cardGroups![0],snapshots=Object.fromEntries(g.cardIds.map(id=>{const c=w.cards.find(c=>c.id===id)!;return [c.instanceId,{metrics:[{id:c.metricId,name:'手动进度',kind:'range' as const,value:53,max:100,unit:'%',meaning:'used'}]}];}));
    const markup=renderToStaticMarkup(createElement(GroupMetrics,{group:g,workspace:w,snapshots,now:Date.now(),online:true}));expect(markup).toContain('group-values-hidden');expect(markup).toMatch(/class="group-peek-value"[^>]*>53<\/span>/);expect(markup).not.toContain('group-member-state');expect(markup).not.toContain('<strong');
  });
  it('shows missing group data without inventing zero and retains metric semantics',()=>{
    const w=grouped(),g=w.cardGroups![0],markup=renderToStaticMarkup(createElement(GroupMetrics,{group:g,workspace:w,snapshots:{},now:Date.now(),online:true}));expect(markup).toContain('—');expect(markup).not.toContain('>0<');
  });
  it('lets a group override the global default and rejects malformed simple mode',()=>{
    const w=grouped(),g=w.cardGroups![0];w.groupValues=true;g.simple=true;
    const markup=()=>renderToStaticMarkup(createElement(GroupMetrics,{group:g,workspace:w,snapshots:{},now:Date.now(),online:true}));
    expect(markup()).toContain('group-values-hidden');expect(markup()).not.toContain('<strong');
    w.groupValues=false;g.simple=false;expect(markup()).not.toContain('group-values-hidden');expect(markup()).toContain('<strong');
    g.simple='invalid' as unknown as boolean;expect(()=>assertWorkspace(w)).toThrow('简洁');
  });
});
describe('directional canvas and grouping intent',()=>{
  it('uses viewport height and fills horizontal holes left before top',()=>{
    const small=resolveHorizontalGrid(1200,800),tall=resolveHorizontalGrid(1200,1000);expect(small.rows).toBeGreaterThan(2);expect(tall.rows).toBeGreaterThan(small.rows);expect(small.height).toBe(800);
    const w=demoWorkspace();w.cards=w.cards.slice(0,5).map(c=>({...c,layout:{variant:'compact'}}));const compacted=fillHorizontalHoles(resolvePlacements(w,3,true),3);expect(compacted.map(s=>[s.column,s.row])).toEqual([[0,0],[0,1],[0,2],[1,0],[1,1]]);for(const a of compacted)for(const b of compacted)if(a!==b)expect(intersects(a,b)).toBe(false);
  });
  it('requires a stable center hold after a top approach, allowing small pointer jitter',()=>{
    const target=[{id:'card',left:100,top:100,width:200,height:200}];
    const entry=groupingIntent({x:200,y:90},target,{x:200,y:50},{},0);expect(entry.approach).toBe('card');expect(entry.target).toBeUndefined();
    const center=groupingIntent({x:200,y:200},target,{x:200,y:90},entry,100);expect(center.centerAt).toBe(100);expect(center.target).toBeUndefined();
    const waiting=groupingIntent({x:202,y:202},target,{x:200,y:200},center,100+GROUP_CENTER_HOLD-1);expect(waiting.target).toBeUndefined();
    const ready=groupingIntent({x:202,y:202},target,{x:202,y:202},waiting,100+GROUP_CENTER_HOLD);expect(ready.target).toBe('card');
    expect(groupingIntent({x:110,y:200},target,{x:202,y:202},ready,600).target).toBeUndefined();
  });
  it('never groups side/bottom entrances or edge skimming, and expires an idle top edge',()=>{
    const target=[{id:'card',left:100,top:100,width:200,height:200}];
    expect(groupingIntent({x:200,y:200},target,{x:50,y:200},{},0).approach).toBeUndefined();
    expect(groupingIntent({x:200,y:200},target,{x:200,y:350},{},0).approach).toBeUndefined();
    const corner=groupingIntent({x:110,y:200},target,{x:110,y:50},{},0);expect(corner.target).toBeUndefined();expect(groupingIntent({x:110,y:200},target,{x:110,y:200},corner,GROUP_APPROACH_IDLE)).toEqual({});
    const edge=groupingIntent({x:200,y:110},target,{x:200,y:50},{},0);expect(edge.centerAt).toBeUndefined();
    expect(groupingIntent({x:200,y:110},target,{x:200,y:110},edge,GROUP_APPROACH_IDLE)).toEqual({});
  });
  it('restarts the center hold when still moving or leaving the center',()=>{
    const target=[{id:'card',left:100,top:100,width:200,height:200}],center=groupingIntent({x:200,y:200},target,{x:200,y:50},{},0);
    const moving=groupingIntent({x:220,y:200},target,{x:200,y:200},center,300);expect(moving.centerAt).toBe(300);expect(moving.target).toBeUndefined();
    expect(groupingIntent({x:220,y:200},target,{x:220,y:200},moving,500).target).toBeUndefined();
    const edge=groupingIntent({x:110,y:200},target,{x:220,y:200},moving,600);expect(edge.approach).toBeUndefined();
    expect(groupingIntent({x:200,y:200},target,{x:110,y:200},edge,1200).target).toBeUndefined();
  });
  it('accepts either upper side entrance before a center hold, but displaces lower side entries',()=>{
    const target=[{id:'card',left:100,top:100,width:200,height:200}];
    for(const x of [50,350]){
      const entry=groupingIntent({x:200,y:140},target,{x,y:140},{},0);expect(entry.approach).toBe('card');expect(entry.target).toBeUndefined();
      const center=groupingIntent({x:200,y:200},target,{x:200,y:140},entry,100);expect(groupingIntent({x:200,y:200},target,{x:200,y:200},center,100+GROUP_CENTER_HOLD).target).toBe('card');
      expect(groupingIntent({x:200,y:180},target,{x,y:180},{},0).approach).toBeUndefined();
    }
  });
  it('fits rings plus captions into narrow tall cards without covering the next member',()=>{
    const plan=groupPresentation(144,340,2);expect(plan.visible).toBe(2);expect(plan.columns).toBe(1);expect(plan.ringSize*2+86*2+12).toBeLessThanOrEqual(340);
    const crowded=groupPresentation(144,340,8);expect(crowded.visible).toBe(2);expect(groupPresentation(340,340,8).visible).toBe(4);
  });
});
