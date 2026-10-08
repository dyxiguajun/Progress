import {useState} from 'react';
import {Folder} from 'lucide-react';
import type {Card,Workspace} from '../core/model';
import {groupIsSimple,type CardGroup} from '../core/cardGroups';
import type {Snapshot} from '../core/sourceState';
import {ComponentIcon,Modal} from './shared';
import {GroupMetrics} from './GroupCard';

export function GroupDetails({group,workspace,snapshots,now,online,onClose,onSave,onDissolve,onMember,onEditMember}:{group:CardGroup;workspace:Workspace;snapshots:Record<string,Snapshot>;now:number;online:boolean;onClose:()=>void;onSave:(name:string,style:CardGroup['style'],simple:boolean)=>void;onDissolve:()=>void;onMember:(card:Card)=>void;onEditMember:(card:Card)=>void}) {
  const [name,setName]=useState(group.name),[style,setStyle]=useState(group.style),[simple,setSimple]=useState(groupIsSimple(group,workspace));
  return <Modal title={<span className="detail-title"><span className="card-icon" data-shared="card-icon"><Folder size={20}/></span><span data-shared="card-title">{group.name}</span></span>} accessibleTitle={group.name} onClose={onClose} dirtyKey={JSON.stringify({name,style,simple})}>
    <div className="modal-body group-details"><label className="field"><span>名称</span><input maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><div className="settings-row"><strong>组合样式</strong><div className="segmented">{(['rings','bars'] as const).map(value=><button key={value} aria-pressed={style===value} className={style===value?'selected':''} onClick={()=>setStyle(value)}>{value==='rings'?'多圆环':'多进度条'}</button>)}</div></div>
      <label className="settings-row"><div><strong>简洁模式</strong><span>隐藏百分比，悬停圆环查看数值。</span></div><input className="ios-switch" role="switch" aria-label="组合文件夹简洁模式" type="checkbox" checked={simple} onChange={event=>setSimple(event.target.checked)}/></label>
      <div className="editor-card-actions"><GroupMetrics group={{...group,style,simple}} workspace={workspace} snapshots={snapshots} now={now} online={online} detailed onMember={onMember}/></div>
      <div className="group-member-list editor-card-actions">{group.cardIds.map(id=>{const card=workspace.cards.find(c=>c.id===id)!,instance=workspace.instances.find(i=>i.id===card.instanceId)!,component=workspace.components.find(c=>c.manifest.id===instance.componentId)!;return <div className="settings-row" key={id}><button className="text-button" onClick={()=>onMember(card)}><ComponentIcon component={component} icon={card.icon}/>{card.title??snapshots[instance.id]?.metrics.find(m=>m.id===card.metricId)?.name??instance.name}</button><button className="button secondary" onClick={()=>onEditMember(card)}>编辑配置</button></div>;})}</div>
    </div><div className="modal-actions"><button className="button secondary editor-card-actions" onClick={onDissolve}>解散组合</button><button className="button primary" disabled={!name.trim()} onClick={()=>onSave(name.trim(),style,simple)}>保存</button></div>
  </Modal>;
}
