import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {visibleSurface} from '../src/core/motionGeometry';
import {continuousPath} from '../src/ui/geometry';
import {demoWorkspace} from '../src/core/components';
import {proportion,compatibleRenderers,type Metric} from '../src/core/model';
import {assertWorkspace} from '../src/core/validation';
import {packageWorkspace,importFile} from '../src/core/packages';
import {searchCards} from '../src/core/search';
import {CardFill} from '../src/ui/CardFill';
import {MetricView} from '../src/ui/MetricView';
import {metricLabel} from '../src/core/presentation';

describe('operation geometry and surface presentation',()=>{
  it('rejects stale, offscreen and mostly occluded return targets',()=>{
    const viewport={width:390,height:800};
    expect(visibleSurface({left:16,top:80,width:170,height:170},viewport)).toBe(true);
    for(const rect of [null,{left:16,top:790,width:170,height:170},{left:-180,top:90,width:170,height:170},{left:16,top:80,width:0,height:170},{left:NaN,top:0,width:170,height:170}])expect(visibleSurface(rect,viewport)).toBe(false);
  });
  it('uses bounded continuous paths for tiny and rectangular surfaces',()=>{
    for(const [w,h] of [[32,32],[170,170],[800,170],[170,800],[660,540]]){
      const path=continuousPath(w,h,24);expect(path).not.toMatch(/NaN|Infinity/);
      for(const match of path.matchAll(/([\d.]+) ([\d.]+)/g)){expect(Number(match[1])).toBeLessThanOrEqual(w);expect(Number(match[2])).toBeLessThanOrEqual(h);}
    }
  });
  it('fills by value without inventing terminal status, in both directions',()=>{
    const base:Metric={id:'main',name:'进度',kind:'range',max:100,unit:'%',meaning:'completed',status:'running'};
    expect(compatibleRenderers(base)).toContain('fill');expect(compatibleRenderers({...base,kind:'indeterminate'})).not.toContain('fill');
    for(const value of [0,25,50,76,99.9,100,150])for(const direction of ['bottom-up','left-right'] as const){
      const metric={...base,value};const html=renderToStaticMarkup(createElement(CardFill,{metric,color:'#197b65',direction,now:0}));
      expect(html).toContain(`aria-valuenow="${Math.min(100,value)}"`);expect(html).toContain(`fill-${direction}`);expect(metricLabel(metric)).toBe('进行中');
    }
    for(const status of ['failed','stopped']){const m={...base,status,value:51};expect(proportion(m)).toBe(.51);expect(metricLabel(m)).not.toBe('已完成');}
  });
  it('exports actual title, icon and fill options and updates global search',async()=>{
    const w=demoWorkspace(),card=w.cards.find(c=>c.metricId==='transfer')!;card.title='新的 NAS 任务';card.icon='database';card.renderer='fill';card.fillDirection='left-right';card.ringCenter='icon';
    assertWorkspace(w);expect(searchCards(w,{},'新的 NAS 任务').map(r=>r.id)).toContain(card.id);
    const imported=await importFile('visual.progresspack',new Uint8Array(await packageWorkspace(w)).buffer);
    expect(imported.workspace?.cards.find(c=>c.id===card.id)).toMatchObject({title:card.title,icon:'database',renderer:'fill',fillDirection:'left-right',ringCenter:'icon'});
    card.icon='remote-url' as typeof card.icon;expect(()=>assertWorkspace(w)).toThrow('图标');
    card.icon='database';card.fillDirection='invalid' as typeof card.fillDirection;expect(()=>assertWorkspace(w)).toThrow('填充方向');
    card.fillDirection='left-right';card.ringCenter='invalid' as typeof card.ringCenter;expect(()=>assertWorkspace(w)).toThrow('圆环');
  });
  it('keeps ring orientation in SVG and preserves readable values in both center modes',()=>{
    for(const value of [0,50,100])for(const mode of ['auto','icon','value'] as const){
      const html=renderToStaticMarkup(createElement(MetricView,{metric:{id:'main',name:'任务',kind:'range',min:0,max:100,value,unit:'%'},renderer:'ring',color:'#197b65',now:0,density:'compact',ringCenter:mode,centerIcon:createElement('svg',{'aria-hidden':true})}));
      expect(html).toContain('transform="rotate(-90 60 60)"');expect(html).toContain(`${value}<span>%</span>`);
      expect(html.includes('ring-below-value')).toBe(mode!=='value');expect(html.includes('ring-center-icon')).toBe(mode!=='value');
    }
  });
});
