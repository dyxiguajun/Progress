import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { IconName } from '../core/model';
import { icons, IndependentModal } from './shared';

import { iconLabels as labels } from '../core/iconCatalog';

export function IconPicker({current,allowed,onClose,onConfirm}:{current:IconName;allowed?:IconName[];onClose:()=>void;onConfirm:(icon:IconName)=>void}) {
  const [query,setQuery]=useState(''),[selection,setSelection]=useState(current);
  const choices=(allowed??Object.keys(icons) as IconName[]).filter(name=>`${name} ${labels[name]}`.toLowerCase().includes(query.toLowerCase()));
  const Current=icons[selection];
  return <IndependentModal title="选择图标" onClose={onClose}>
    <div className="modal-body icon-library"><label className="search-box"><Search size={18}/><input data-autofocus="" aria-label="搜索图标" placeholder="搜索图标" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <p className="icon-current"><Current size={22}/>当前选择：{labels[selection]}</p>
      <div className="icon-library-grid" role="group" aria-label="图标库">{choices.map(name=>{const Icon=icons[name];return <button key={name} aria-label={labels[name]} aria-pressed={selection===name} onClick={()=>setSelection(name)}><Icon size={24}/><span>{labels[name]}</span>{selection===name&&<Check size={13}/>}</button>;})}</div>
      {!choices.length&&<p role="status">没有匹配的图标</p>}
    </div><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={()=>onConfirm(selection)}>确认</button></div>
  </IndependentModal>;
}
