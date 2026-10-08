import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import type { Workspace } from '../core/model';
import type { Snapshot } from '../core/sourceState';
import { searchCards, type CardSearchResult } from '../core/search';
import { Modal, ComponentIcon } from './shared';

export function Spotlight({ workspace, snapshots, onClose, onSelect }: { workspace: Workspace; snapshots: Record<string, Snapshot>; onClose: () => void; onSelect: (result: CardSearchResult) => void }) {
  const [query, setQuery] = useState(''), [selection, setSelection] = useState(0), list = useRef<HTMLDivElement>(null), listId = useId();
  const results = useMemo(() => searchCards(workspace, snapshots, query), [workspace, snapshots, query]);
  const active = Math.min(selection, Math.max(0, results.length - 1));
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, query]);
  return <Modal title="搜索…" accessibleTitle="搜索所有卡片" onClose={onClose} presentation="spotlight">
    <div className="spotlight-input"><span data-shared="search-icon"><Search size={20}/></span><div className="spotlight-query">{!query&&<span className="spotlight-placeholder" data-shared="search-input" aria-hidden="true">搜索…</span>}<input data-autofocus="" role="combobox" aria-label="搜索所有卡片" aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${active}` : undefined} placeholder="搜索…" value={query} onChange={event => { setQuery(event.target.value); setSelection(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelection(results.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0); }
      if (event.key === 'Enter' && results[active]) { event.preventDefault(); onSelect(results[active]); }
    }}/></div></div>
    <div ref={list} id={listId} role="listbox" aria-label="卡片搜索结果" className="spotlight-results">
      {results.map((result, index) => <button id={`${listId}-${index}`} key={result.id} style={{'--result-index':index} as CSSProperties} role="option" aria-selected={index === active} tabIndex={-1} onMouseMove={() => setSelection(index)} onClick={() => onSelect(result)}>
        <span className="spotlight-icon"><ComponentIcon component={workspace.components.find(c => c.manifest.id === result.componentId)!} icon={workspace.cards.find(card=>card.id===result.id)?.icon}/></span><span><strong>{result.title}</strong><small>{result.folder} · {result.context}</small></span><CornerDownLeft size={15}/>
      </button>)}
    </div>
    {!results.length && <div className="spotlight-empty"><Search size={24}/><strong>{query ? '没有匹配的卡片' : '还没有卡片'}</strong><span>{query ? '试试名称、文件夹或组件名称。' : '添加卡片后可在这里快速找到。'}</span></div>}
    <footer className="spotlight-footer"><span role="status">{results.length} 个结果 · 所有文件夹</span><span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span></footer>
  </Modal>;
}
