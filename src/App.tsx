import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AlertCircle, ArrowLeft, ArrowRight, Check, FileArchive, FileInput, FileOutput, Grid2X2, LayoutDashboard, Layers3, Menu, Folder, Star, Briefcase, Heart, PanelLeftClose, Pencil, Minus, ArrowUp, ArrowDown, Plus, RefreshCw, Search, Settings, X } from 'lucide-react';
import { folderWorkspace, migrateFolders, moveCard, duplicateFolder, reorderFolder } from './core/folders';
import { builtins, demoWorkspace, emptyWorkspace } from './core/components';
import { cardsBundle, clone, colors, compatibleRenderers, defaultConfig, refreshInterval, removeCards, restoreCards, uid, type Card, type Component, type Config, type Instance, type Metric, type Renderer, type Workspace } from './core/model';
import { importFile, mergeWorkspace, packageWorkspace, portableWorkspace, type ConflictMode } from './core/packages';
import { download, saveWorkspace } from './core/storage';
import { configErrors } from './core/validation';
import { fetchMetrics, localMetrics, runtimeError } from './core/runtime';
import { useMetrics, type Snapshot } from './hooks/useMetrics';
import { ComponentIcon, Modal, SchemaForm } from './ui/shared';
import { MetricView } from './ui/MetricView';

import { WorkspaceGrid } from './ui/WorkspaceGrid';
import { commitPlacements, fittingVariant, fittingHorizontalVariant, reflowHorizontal, layoutsFor, preferredVariant, reflow, resolvePlacements, fillHoles, fillHorizontalHoles, variantDensity, variantLabel } from './core/grid';
import type { CodexUsage } from './core/codex';
import { CodexWizard } from './ui/CodexWizard';
import { ProviderPicker, ProviderWizard } from './ui/ProviderWizard';
import { type QuotaProvider } from './core/model';
import { manualProvider } from './core/providers';
import { AgentSettings, ScanDialog, quotaComponent } from './ui/Pairing';
import { CardDetails } from './ui/CardDetails';
import { componentDescription, componentName, isPreset } from './ui/componentCopy';
import { Spotlight } from './ui/Spotlight';
import { MotionContent, usePageMotion, usePresence, useToolbarMotion } from './ui/motion';
import { OperationLayer } from './ui/OperationLayer';
import { IconPicker } from './ui/IconPicker';
import { FolderName } from './ui/FolderName';
import { useContinuousChildren } from './ui/geometry';
import { CardFill } from './ui/CardFill';
import {combineCards,dissolveGroup,duplicateGroup,groupForCard} from './core/cardGroups';
import {GroupDetails} from './ui/GroupDetails';
import { sizeDescription } from './core/presentation';
import {DisplayOptions} from './ui/DisplayOptions';
import {CardPreview} from './ui/CardPreview';

type Editor = { component: Component; instance?: Instance; card?: Card; appearance?: boolean; provider?: QuotaProvider };
type View = 'dashboard' | 'components' | 'settings';
const rendererNames: Record<Renderer, string> = { bar: '进度条', ring: '环形', number: '数字 / 状态', quota: '配额组合', fill: '整卡填充' };


export function App({ initialWorkspace, storageError }: { initialWorkspace: Workspace; storageError?: string }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [view, setView] = useState<View>('dashboard');
  const pageMotion=usePageMotion(view);
  const sidebarSurface=useRef<HTMLElement>(null),settingsSurface=useRef<HTMLDivElement>(null);
  useContinuousChildren(sidebarSurface,'.folder-main,.brand-mark');
  useContinuousChildren(settingsSurface,'.settings-panel,.segmented,.segmented button',view==='settings');
  const [folderId, setFolderId] = useState(initialWorkspace.folders?.[0]?.id ?? 'default');
  const [collapsed, setCollapsed] = useState(false);
  const [folderEditor, setFolderEditor] = useState<string | null>(null);
  const [movingCard, setMovingCard] = useState<Card | null>(null);
  const [folderEditing, setFolderEditing] = useState(false);
  const [removingFolder, setRemovingFolder] = useState<string | null>(null);
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const [addMenu, setAddMenu] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [presetModal, setPresetModal] = useState(false);
  const [providerPicker,setProviderPicker]=useState(false);
  const [scanner,setScanner]=useState(false);
  const [uninstalling,setUninstalling]=useState<Component|null>(null);
  const [importModal, setImportModal] = useState(false);
  const [exportSelection, setExportSelection] = useState<string[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [groupId,setGroupId]=useState<string|null>(null);
  const pendingGroup=useRef<(()=>void)|null>(null);
  const [detailCard, setDetailCard] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Workspace | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean; undo?: () => void } | null>(null);
  const [persistError, setPersistError] = useState(storageError ?? '');
  const [persistEnabled, enablePersistence] = useState(!storageError);
  const [confirmReset, setConfirmReset] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [layoutCard, setLayoutCard] = useState<string | null>(null);
  const gridController = useRef<{ dismiss: () => boolean; columns: number;rows:number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingAdd=useRef<(()=>void)|null>(null),pendingSearch=useRef<(()=>void)|null>(null);
  const { data, now, online, refresh, receiveQuota, manualRefreshing } = useMetrics(workspace);
  const sidebarPresence = usePresence(mobileSidebar);
  const toolbar = useToolbarMotion(layoutEditing);
  const doneRef = useRef<HTMLButtonElement>(null), toolbarFocus = useRef(false);
  useEffect(() => { if (toolbar.phase === 'editing' && toolbarFocus.current) doneRef.current?.focus(); else if (toolbar.phase === 'normal' && toolbarFocus.current) { document.querySelector<HTMLButtonElement>('.search-trigger')?.focus(); toolbarFocus.current = false; } }, [toolbar.phase]);
  useEffect(() => { if (!focusedCard) return; const timer = setTimeout(() => setFocusedCard(null), 2400); return () => clearTimeout(timer); }, [focusedCard]);
  const notify = (message: string, error = false) => setToast({ message, error });
  useEffect(() => {
    if (!persistEnabled) return;
    void saveWorkspace(workspace).then(() => setPersistError('')).catch(() => setPersistError('保存失败，请导出备份并检查设备存储空间。'));
  }, [workspace, persistEnabled]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.undo ? 10000 : 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = workspace.theme; }, [workspace.theme]);
  useEffect(() => { if (!workspace.folders?.some(f => f.id === folderId)) setFolderId(workspace.folders?.[0]?.id ?? 'default'); }, [workspace.folders, folderId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); setSearchOpen(true); }
      if (event.key === 'Escape') { setAddMenu(false); setMobileSidebar(false); if (!document.querySelector('dialog[open]')) setFolderEditing(false); }
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => {
      if (document.querySelector('dialog[open]')) { document.dispatchEvent(new Event('progress:request-close')); return; }
      if (exportSelection) setExportSelection(null); else if (detailCard) setDetailCard(null); else if (editor) setEditor(null);
      else if (presetModal) setPresetModal(false); else if (importModal) setImportModal(false); else if (incoming) setIncoming(null);
      else if (confirmReset) setConfirmReset(false); else if (mobileSidebar) setMobileSidebar(false); else if (addMenu) setAddMenu(false);
      else if (gridController.current?.dismiss()) { /* Active gesture or context menu consumed Back. */ }
      else if (layoutEditing) setLayoutEditing(false);
      else if (searchOpen) setSearchOpen(false); else if (folderEditing) setFolderEditing(false); else if (view !== 'dashboard') setView('dashboard'); else void NativeApp.minimizeApp();
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, [exportSelection, detailCard, editor, presetModal, importModal, incoming, confirmReset, mobileSidebar, addMenu, searchOpen, folderEditing, view, layoutEditing]);
  const selectView = (next: View) => { pageMotion.capture(next); setView(next); setMobileSidebar(false); setLayoutEditing(false); setLayoutCard(null); };
  const editLayout = (value: boolean) => { toolbarFocus.current = !!document.activeElement?.closest('.topbar-actions,.search-trigger'); setLayoutEditing(value); setAddMenu(false); if (value) setSearchOpen(false); else setLayoutCard(null); };
  const editCard = (card: Card) => { setFocusedCard(null); const instance = workspace.instances.find(i => i.id === card.instanceId)!; const component = workspace.components.find(c => c.manifest.id === instance.componentId)!; setEditor({ component, instance, card,provider:component.manifest.quotaProvider }); };
  const duplicateCard = (card: Card) => {
    const group=groupForCard(workspace,card.id);if(group){setWorkspace(current=>duplicateGroup(current,group.id));notify('已复制组合。');return;}
    const instance = workspace.instances.find(i => i.id === card.instanceId)!;
    setWorkspace(current => ({ ...current, cards: [...current.cards, { ...card, id: uid(), title: `${card.title ?? instance.name} · 副本`, ...(card.layout ? { layout: { variant: card.layout.variant } } : {}) }] })); notify('已复制卡片。');
  };
  const selectComponent = (component: Component) => { setPresetModal(false); if (component.manifest.id === 'dev.progress.http') component = { ...component, manifest:{...component.manifest,name:componentName(component)} }; if(component.manifest.id==='dev.progress.quota')setProviderPicker(true);else setEditor({ component,provider:component.manifest.quotaProvider }); };
  const openExport = (ids = workspace.cards.map(card => card.id)) => setExportSelection(ids);
  function compactFolder(current:Workspace,id=folderId) {
    if(current.autoFill===false)return current;
    const horizontal=current.scrollDirection==='horizontal',limit=horizontal?(gridController.current?.rows??2):(gridController.current?.columns??2);
    return commitPlacements(current,(horizontal?fillHorizontalHoles:fillHoles)(resolvePlacements(folderWorkspace(current,id),limit,horizontal),limit),limit,undefined,horizontal);
  }
  function openVisual(card:Card){setFocusedCard(null);const group=groupForCard(workspace,card.id);if(group)setGroupId(group.id);else setDetailCard(card.id);}
  function removeVisual(card:Card){const group=groupForCard(workspace,card.id);if(group){const before=clone(group);setWorkspace(current=>compactFolder(dissolveGroup(current,group.id)));setToast({message:'组合已解散，成员卡片已保留。',undo:()=>setWorkspace(current=>current.cards.filter(c=>before.cardIds.includes(c.id)).length===before.cardIds.length&&!current.cardGroups?.some(g=>g.cardIds.some(id=>before.cardIds.includes(id)))?{...current,cardGroups:[...(current.cardGroups??[]),before]}:current)});}else deleteCards([card.id],'卡片已移除。');}
  function leaveGroup(action:()=>void){pendingGroup.current=action;setGroupId(null);}
  function deleteCards(ids: string[], message: string) {
    const before = clone(workspace);
    const next = removeCards(workspace, ids);
    setWorkspace(compactFolder(next));
    setToast({ message, undo: () => { setWorkspace(current => restoreCards(current, before, ids)); setToast({ message: '已撤销删除。' }); } });
  }
  function addExamples() {
    try { const examples=demoWorkspace(); examples.folders=workspace.folders; examples.cards=examples.cards.map(c=>({...c,folderId,id:workspace.cards.some(existing=>existing.id===c.id&&existing.folderId!==folderId)?uid():c.id})); setWorkspace(migrateFolders(mergeWorkspace(workspace, examples, 'skip'))); setView('dashboard'); notify('已添加示例。'); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 8_000_000) throw new Error('文件超过 8 MB。');
      const result = await importFile(file.name, await file.arrayBuffer());
      setImportModal(false);
      if (result.component) {
        const component = result.component, existing = workspace.components.find(c => c.manifest.id === component.manifest.id);
        if (existing && (JSON.stringify(existing.manifest) !== JSON.stringify(component.manifest) || JSON.stringify(existing.configSchema) !== JSON.stringify(component.configSchema) || JSON.stringify(existing.metrics) !== JSON.stringify(component.metrics))) throw new Error('已有不同版本的同名组件，请在独立工作区导入。');
        if (!existing) setWorkspace({ ...workspace, components: [...workspace.components, component] });
        setEditor({ component: existing ?? component });
      } else if (result.workspace) setIncoming(result.workspace);
    } catch (error) { notify(error instanceof Error ? error.message : '导入失败，请重新选择文件。', true); }
  }
  const demoIds = workspace.cards.filter(card => workspace.instances.find(instance => instance.id === card.instanceId)?.demo).map(card => card.id);
  const allDemo = workspace.cards.length > 0 && demoIds.length === workspace.cards.length;
  const currentFolder = workspace.folders?.find(f => f.id === folderId);
  const scoped = folderWorkspace(workspace, folderId);
  const filtered = scoped.cards;
  const searchedComponents = workspace.components.filter(component => `${component.manifest.name} ${componentDescription(component)}`.toLowerCase().includes(componentSearch.toLowerCase()));
  const details = workspace.cards.find(card => card.id === detailCard);
  const title = view === 'dashboard' ? currentFolder?.name ?? '日常' : view === 'components' ? '已安装组件' : '设置';
  const liveEditor = editor ? {...editor,instance:editor.instance ? workspace.instances.find(i=>i.id===editor.instance!.id)??editor.instance:undefined,card:editor.card ? workspace.cards.find(c=>c.id===editor.card!.id)??editor.card:undefined} : null;
  const ActiveEditor = editor?.component.manifest.runtime.type === 'codex_usage' ? CodexEditorDialog : editor?.component.manifest.runtime.type === 'provider_quota' ? ProviderEditorDialog : EditorDialog;
  const editorSurface = editor && <ActiveEditor onWorkspaceChange={setWorkspace} key={`${editor.instance?.id ?? editor.component.manifest.id}:${editor.appearance ? 'appearance' : 'config'}`} editor={liveEditor!} workspace={workspace} now={now} initialMetrics={editor.instance ? data[editor.instance.id]?.metrics : undefined} onClose={() => setEditor(null)} onCardAction={action => {
      const card = editor.card; if (!card) return; setEditor(null);
      if (action === 'layout') { editLayout(true); setLayoutCard(card.id); }
      else if (action === 'duplicate') duplicateCard(card); else if (action === 'export') openExport([card.id]); else if (action === 'details') setDetailCard(card.id); else deleteCards([card.id], '卡片已移除。');
    }} onSave={(next, quota) => {
      if (editor.card) {
        const horizontal=workspace.scrollDirection==='horizontal';
        const limit=horizontal?(gridController.current?.rows??2):(gridController.current?.columns??2);
        const slots=resolvePlacements(scoped,limit,horizontal),slot=slots.find(p=>p.id===editor.card!.id);
        const updated=next.cards.find(c=>c.id===editor.card!.id)!;
        if(slot&&!groupForCard(next,updated.id)) {
          const preference=preferredVariant(updated,editor.component),variant=horizontal?fittingHorizontalVariant(editor.component,preference,limit):fittingVariant(editor.component,preference,limit);
          if(variant){const moved=(horizontal?reflowHorizontal:reflow)(slots,slot.id,{column:horizontal?slot.column:Math.min(slot.column,limit-variant.span.columns),row:horizontal?Math.min(slot.row,limit-variant.span.rows):slot.row},variant,limit);if(moved)next=commitPlacements(next,moved,limit,{id:slot.id,variant:preference},horizontal);}
        }
      }
      next = migrateFolders(next); for (const c of next.cards) if (!workspace.cards.some(old => old.id === c.id)) c.folderId = folderId;
      setWorkspace(next);
      if (quota) { const card = editor.card ? next.cards.find(c => c.id === editor.card!.id) : next.cards.find(c => !workspace.cards.some(old => old.id === c.id)); if (card) receiveQuota(card.instanceId, quota); }
      setEditor(null); selectView('dashboard'); notify(editor.instance ? '已保存更改。' : '已添加卡片。');
    }}/>;
  const activeGroup=workspace.cardGroups?.find(g=>g.id===groupId);
  const operationCard=details??liveEditor?.card;
  const detailSurface=details&&(()=>{const instance=workspace.instances.find(i=>i.id===details.instanceId)!,component=workspace.components.find(c=>c.manifest.id===instance.componentId)!;
    return <CardDetails card={details} instance={instance} component={component} snapshot={data[instance.id]} now={now} online={online} onClose={()=>setDetailCard(null)} onEdit={()=>{setDetailCard(null);setEditor({component,instance,card:details,provider:component.manifest.quotaProvider});}} onChangeCard={change=>setWorkspace(current=>({...current,cards:current.cards.map(card=>card.id===details.id?{...card,...change}:card)}))} onRetry={()=>refresh(instance.id)}/>;
  })();
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    {sidebarPresence.present && <button className={`sidebar-shade ${sidebarPresence.closing ? 'is-leaving' : ''}`} aria-label="关闭导航" onClick={() => setMobileSidebar(false)}/>}
    <aside ref={sidebarSurface} className={`sidebar ${mobileSidebar ? 'is-open' : ''} ${folderEditing ? 'is-folder-editing' : ''}`}>
      <div className="brand-row"><a className="brand" href="#" onClick={event => { event.preventDefault(); selectView('dashboard'); }}><div className="brand-mark"><i/><i/><i/></div><strong>进度</strong></a>
        {!folderEditing && <button className="sidebar-toggle icon-button" aria-label={mobileSidebar ? '关闭文件夹' : collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => mobileSidebar ? setMobileSidebar(false) : setCollapsed(!collapsed)}><PanelLeftClose size={20}/></button>}</div>
      <nav aria-label="文件夹">{workspace.folders?.map(folder => { const Icon = {folder:Folder,star:Star,briefcase:Briefcase,heart:Heart}[folder.icon]; return <div className="folder-nav-row" key={folder.id}>

        <button className={`folder-main ${view === 'dashboard' && folderId === folder.id ? 'active' : ''}`} aria-current={view === 'dashboard' && folderId === folder.id ? 'page' : undefined} title={folder.name} aria-label={folderEditing ? `编辑文件夹 ${folder.name}` : folder.name} onClick={() => {if (folderEditing) {setRemovingFolder(null);setFolderEditor(folder.id);} else {setFolderId(folder.id);selectView('dashboard');}}} onContextMenu={event => {event.preventDefault();setRemovingFolder(null);setFolderEditor(folder.id);}}><Icon size={20} style={{color:folder.color}}/><FolderName name={folder.name}/></button>
        {folderEditing && <button className="folder-remove icon-button" disabled={workspace.folders!.length === 1} aria-label={`移除文件夹 ${folder.name}`} title={workspace.folders!.length === 1 ? '至少保留一个文件夹' : '移除文件夹'} onClick={() => {setRemovingFolder(folder.id);setFolderEditor(folder.id);}}><Minus size={16}/></button>}
      </div>; })}</nav>
      <div className="sidebar-footer">{folderEditing && <button className="text-button" aria-label="新建文件夹" onClick={() => {setRemovingFolder(null);setFolderEditor('new');}}><Plus size={20}/><span>新建</span></button>}{<button inert={collapsed&&!folderEditing&&!mobileSidebar} className={folderEditing ? 'text-button folder-edit-toggle' : 'icon-button folder-edit-toggle'} aria-label={folderEditing ? '完成文件夹编辑' : '编辑文件夹'} onClick={() => {setFolderEditing(!folderEditing); if (!folderEditing) setCollapsed(false);}}>{folderEditing ? <Check size={20}/> : <Pencil size={18}/>}{folderEditing && <span>完成</span>}</button>}</div>
    </aside>
    <main ref={pageMotion.ref} className="main">
      <header className={`topbar toolbar-${toolbar.phase} ${view === 'settings' ? 'settings-topbar' : ''}`}>
        <div className="breadcrumb">{view === 'settings' ? <button className="icon-button" aria-label="返回工作区" onClick={() => selectView('dashboard')}><ArrowLeft size={20}/></button> : <button className="icon-button mobile-menu" aria-label="打开文件夹" onClick={() => setMobileSidebar(true)}><Menu size={20}/></button>}{view==='dashboard'&&currentFolder&&(()=>{const Icon={folder:Folder,star:Star,briefcase:Briefcase,heart:Heart}[currentFolder.icon];return <Icon className="breadcrumb-icon" size={20} style={{color:currentFolder.color}}/>;})()}<h1>{title}</h1></div>
        {view !== 'settings' && <>
          <div className="toolbar-search" inert={!toolbar.normal || layoutEditing}>
            {toolbar.normal && <button className="search-trigger toolbar-control" aria-label="搜索卡片" title="搜索所有卡片（⌘K / Ctrl+K）" onClick={() => setSearchOpen(true)}><span data-shared="search-icon"><Search size={20}/></span><span data-shared="search-input">搜索…</span><kbd>⌘K</kbd></button>}
          </div>
          <div className="topbar-actions">
            {toolbar.normal && <div className="normal-actions" inert={layoutEditing}>
              <button className="icon-button toolbar-control" title="刷新" aria-label="刷新数据" aria-busy={!!manualRefreshing} disabled={!!manualRefreshing || !online && workspace.instances.some(instance => instance.networkConsent)} onClick={() => refresh()}><RefreshCw size={20} className={manualRefreshing ? 'spin' : ''}/></button>
              <button className="icon-button toolbar-control" aria-label="设置" title="设置" onClick={() => selectView('settings')}><Settings size={19}/></button>
              <div className="add-wrap toolbar-control"><button data-operation-trigger="add" className="button primary add-button" aria-label="添加" onClick={() => setAddMenu(true)} aria-expanded={addMenu}><span data-shared="add-icon"><Plus size={18}/></span><span>添加</span></button></div>
            </div>}
            {toolbar.done && <button ref={doneRef} className="button primary layout-done" disabled={toolbar.phase === 'to-normal'} onClick={() => {toolbarFocus.current = true; editLayout(false);}}><Check size={20}/><span>完成</span></button>}
          </div>
        </>}
      </header>
      <div className="page-content" tabIndex={-1}>
        {persistError && <div role="alert" className="notice error-notice">{persistError}{!persistEnabled && <button onClick={() => enablePersistence(true)}>保存当前工作区</button>}</div>}
        {view === 'dashboard' && <>
          {allDemo && <div className="section-toolbar"><span className="demo-workspace-label">示例工作区</span><button className="text-button" onClick={() => deleteCards(demoIds, '已移除示例卡片。')}>移除示例</button></div>}
          {filtered.length || layoutEditing && workspace.cards.length ? <WorkspaceGrid key={`${folderId}:${workspace.scrollDirection??'vertical'}`} focusCardId={focusedCard} workspace={scoped} visibleIds={filtered.map(card => card.id)} snapshots={data} now={now} online={online} editing={layoutEditing} onEditing={editLayout} layoutCard={layoutCard} onLayoutCard={setLayoutCard} controller={gridController}
            onCommit={(slots, columns, preference) => setWorkspace(current => commitPlacements(current, current.autoFill!==false && preference ? (current.scrollDirection==='horizontal'?fillHorizontalHoles:fillHoles)(slots, columns, preference.id) : slots, columns, preference,current.scrollDirection==='horizontal'))} onGroup={(source,target)=>{setWorkspace(current=>compactFolder(combineCards(current,source,target)));notify('已组成文件夹。');}} onMember={card=>setDetailCard(card.id)} onEdit={card=>{const group=groupForCard(workspace,card.id);if(group)setGroupId(group.id);else editCard(card);}} onDuplicate={duplicateCard} onExport={card => openExport(groupForCard(workspace,card.id)?.cardIds??[card.id])} onMove={card => setMovingCard(card)} onRemove={removeVisual} onDetails={openVisual} onRetry={refresh}/>
            : <section className="empty-state"><div><LayoutDashboard size={28}/></div><h2>{scoped.cards.length ? '没有匹配的卡片' : '还没有卡片'}</h2><div className="empty-actions"><button className="button primary" onClick={() => setPresetModal(true)}>{scoped.cards.length ? '显示全部' : '添加组件'}</button>{!scoped.cards.length && <button className="button secondary" onClick={addExamples}>查看示例</button>}</div></section>}
        </>}
        {view === 'components' && <><div className="library-toolbar"><label className="search-box"><Search size={17}/><input aria-label="搜索组件" placeholder="搜索组件" value={componentSearch} onChange={event => setComponentSearch(event.target.value)}/>{componentSearch && <button aria-label="清除组件搜索" onClick={() => setComponentSearch('')}><X size={16}/></button>}</label><button className="button secondary" onClick={() => setImportModal(true)}><FileInput size={17}/>导入组件</button></div>
          {(['installed'] as const).map(group => {
            const items = searchedComponents.filter(component => !isPreset(component));
            return <section className="component-section" key={group}><h2>已安装</h2>{items.length ? <div className="library-grid">{items.map(component => <article className="library-card" key={component.manifest.id}><button className="library-select" key={component.manifest.id} onClick={() => selectComponent(component)}><span className="library-icon"><ComponentIcon component={component} size={23}/></span><span className="library-card-title">{component.manifest.name}</span><p>{componentDescription(component)}</p><span className="library-meta">{component.manifest.author} · v{component.manifest.version}</span></button><button className="text-button danger" onClick={()=>setUninstalling(component)}>卸载组件</button></article>)}</div> : <p className="section-empty">{componentSearch ? '没有匹配的组件' : '尚无已安装组件'}</p>}</section>;
          })}
        </>}
        {view === 'settings' && <div ref={settingsSurface} className="settings-content">
          <section className="settings-panel"><h2>外观</h2><div className="settings-row"><strong>外观</strong><div className="segmented">{(['system', 'light', 'dark'] as const).map(theme => <button key={theme} aria-pressed={workspace.theme === theme} className={workspace.theme === theme ? 'selected' : ''} onClick={() => setWorkspace({ ...workspace, theme })}>{theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}</button>)}</div></div></section>
          <section className="settings-panel"><h2>排列方向</h2><div className="settings-row"><strong>排列方向</strong><div className="segmented" role="group" aria-label="排列方向">{(['vertical','horizontal'] as const).map(direction=><button key={direction} aria-pressed={(workspace.scrollDirection??'vertical')===direction} className={(workspace.scrollDirection??'vertical')===direction?'selected':''} onClick={()=>setWorkspace({...workspace,scrollDirection:direction})}>{direction==='vertical'?'竖向':'横向'}</button>)}</div></div></section>
          <section className="settings-panel"><h2>网格</h2><label className="settings-row"><div><strong>自动填补空位</strong><span>移除或移动后，依次补齐前面的空格。</span></div><input className="ios-switch" role="switch" aria-label="自动填补空位" type="checkbox" checked={workspace.autoFill !== false} onChange={e => setWorkspace({...workspace, autoFill:e.target.checked})}/></label></section>
          <section className="settings-panel"><h2>组合卡片</h2><label className="settings-row"><div><strong>显示百分比</strong><span>作为组合的默认设置，可在组合内单独调整。</span></div><input className="ios-switch" role="switch" aria-label="组合卡片显示百分比" type="checkbox" checked={workspace.groupValues!==false} onChange={event=>setWorkspace({...workspace,groupValues:event.target.checked})}/></label></section>
          <section className="settings-panel"><h2>已安装组件</h2><div className="settings-row"><strong>{workspace.components.length} 个组件</strong><button className="button secondary" onClick={() => selectView('components')}>管理组件</button></div></section>
          <section className="settings-panel"><h2>连接</h2><p className="form-hint">{workspace.connections?.length ?? 0} 个连接 · {workspace.connections?.filter(c=>c.reconnect).length ?? 0} 个等待重连</p>{workspace.connections?.map(connection=>{const instance=workspace.instances.find(i=>i.connectionIds?.includes(connection.id));const card=workspace.cards.find(c=>c.instanceId===instance?.id);return <div className="settings-row" key={connection.id}><div><strong>{connection.label}</strong><span>{connection.kind==='relay'?'设备中继':'直接连接'} · {connection.reconnect?'等待重连':connection.method} · 优先级 {connection.priority}</span></div>{card&&<button className="button secondary" onClick={()=>editCard(card)}>管理连接</button>}</div>;})}</section>
          <AgentSettings/>
          <section className="settings-panel"><h2>数据迁移</h2><div className="settings-row"><strong>导出工作区</strong><button className="button secondary" onClick={() => openExport()}><FileOutput size={17}/>导出</button></div><div className="settings-row"><strong>导入工作区 / 卡片</strong><button className="button secondary" onClick={() => setImportModal(true)}><FileInput size={17}/>导入</button></div><div className="settings-row"><strong>示例卡片</strong>{demoIds.length ? <button className="button secondary" onClick={() => deleteCards(demoIds, '已移除示例卡片。')}>移除示例</button> : <button className="button secondary" onClick={addExamples}>查看示例</button>}</div></section>
          <section className="settings-panel danger-panel"><h2>危险操作</h2><div className="settings-row"><div><strong>创建空工作区</strong><span>清空卡片和连接，保留已安装组件。</span></div><button className="button secondary danger" onClick={() => setConfirmReset(true)}>清空</button></div></section>
          <section className="settings-panel"><h2>开发者</h2><p className="form-hint">Progress v0.6.4 · 工作区格式 progress/workspace/v1 · {workspace.folders?.length ?? 1} 个文件夹，{workspace.instances.length} 个实例。数据源与采样时间可在卡片的数据详情中查看。</p></section>
          <details className="advanced-details about-app"><summary>关于 Progress</summary><p>v0.6.4 · 数据保存在当前设备。网络数据在应用可见时刷新。</p></details>
        </div>}
      </div>
    </main>
    <OperationLayer open={searchOpen} source=".search-trigger" kind="search" mode="search" onClosed={()=>{pendingSearch.current?.();pendingSearch.current=null;}}>
      <Spotlight workspace={workspace} snapshots={data} onClose={()=>setSearchOpen(false)} onSelect={result=>{pendingSearch.current=()=>{setFolderId(result.folderId);selectView('dashboard');setFocusedCard(result.id);};setSearchOpen(false);}}/>
    </OperationLayer>
    <OperationLayer open={addMenu} source='[data-operation-trigger="add"]' kind="add" mode="add" onClosed={()=>{pendingAdd.current?.();pendingAdd.current=null;}}>
      <Modal title="添加" presentation="add" closeShared="add-icon" closeIcon={<Plus size={18} data-motion-angle="45" style={{transform:'rotate(45deg)'}}/>} onClose={()=>setAddMenu(false)}><div className="add-actions">{[{label:'预设组件',Icon:Grid2X2,action:()=>setPresetModal(true)},{label:'已安装',Icon:Layers3,action:()=>selectView('components')},{label:'导入组件',Icon:FileInput,action:()=>setImportModal(true)},{label:'扫描配对码',Icon:Search,action:()=>setScanner(true)}].map(({label,Icon,action})=><button key={label} onClick={()=>{pendingAdd.current=action;setAddMenu(false);}}><Icon size={18}/>{label}</button>)}</div></Modal>
    </OperationLayer>
    <input type="file" accept=".progressmod,.progress,.progresspack" ref={fileInput} hidden onChange={event => void readFile(event)}/>
    {exportSelection && <ExportDialog workspace={workspace} snapshots={data} initialSelection={exportSelection} onClose={() => setExportSelection(null)} onExported={count => { setExportSelection(null); notify(`已导出 ${count} 张卡片。`); }}/>}
    {presetModal && <Modal title="预设组件" onClose={() => setPresetModal(false)}><div className="preset-list">{workspace.components.filter(c => isPreset(c) && !['dev.progress.codex-usage','dev.progress.connected-quota','dev.progress.manual-quota'].includes(c.manifest.id)).map(component => <button key={component.manifest.id} onClick={() => selectComponent(component)}><span className="preset-icon"><ComponentIcon component={component} size={23}/></span><div><strong>{componentName(component)}</strong><p>{componentDescription(component)}</p></div><ArrowRight size={18}/></button>)}</div></Modal>}
    {providerPicker&&<ProviderPicker components={workspace.components} onClose={()=>setProviderPicker(false)} onScan={()=>{setProviderPicker(false);setScanner(true);}} onSelect={provider=>{setProviderPicker(false);setEditor({component:provider.id==='codex'?builtins.find(c=>c.manifest.id==='dev.progress.codex-usage')!:workspace.components.find(c=>c.manifest.quotaProvider?.id===provider.id)??quotaComponent(),provider});}}/>}
    {scanner&&<ScanDialog workspace={workspace} folderId={folderId} onClose={()=>setScanner(false)} onSave={next=>{setWorkspace(next);setScanner(false);selectView('dashboard');notify('设备已连接，卡片已添加。');}}/>}
    {importModal && <Modal title="导入组件或工作区" onClose={() => setImportModal(false)}><div className="import-body"><button className="file-drop" onClick={() => fileInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={async event => {
      event.preventDefault(); const file = event.dataTransfer.files[0]; if (!file) return;
      await readFile({ target: { files: [file], value: '' } } as unknown as ChangeEvent<HTMLInputElement>);
    }}><span><FileInput size={29}/></span><strong>选择文件或拖入文件</strong><small>.progressmod · .progress · .progresspack</small></button></div></Modal>}
    {editor&&!editor.card&&editorSurface}
    <OperationLayer open={!!operationCard} source={`[data-operation-source="${operationCard?.id??''}"]`} mode={details?'detail':'config'}>
      <MotionContent stage={details?'detail':'config'}>{details?detailSurface:editorSurface}</MotionContent>
    </OperationLayer>
    <OperationLayer open={!!activeGroup} source={`[data-operation-source="${activeGroup?.cardIds[0]??''}"]`} mode="detail" onClosed={()=>{pendingGroup.current?.();pendingGroup.current=null;}}>
      {activeGroup&&<GroupDetails key={activeGroup.id} group={activeGroup} workspace={workspace} snapshots={data} now={now} online={online} onClose={()=>setGroupId(null)} onSave={(name,style,simple)=>{setWorkspace(current=>({...current,cardGroups:current.cardGroups?.map(g=>g.id===activeGroup.id?{...g,name,style,simple}:g)}));setGroupId(null);notify('已保存组合。');}} onDissolve={()=>leaveGroup(()=>{setWorkspace(current=>compactFolder(dissolveGroup(current,activeGroup.id)));notify('组合已解散，成员卡片已保留。');})} onMember={card=>leaveGroup(()=>setDetailCard(card.id))} onEditMember={card=>leaveGroup(()=>editCard(card))}/>}
    </OperationLayer>
    {confirmReset && <Modal title="创建空工作区？" subtitle="当前卡片和连接将被清空。可以先导出备份。" onClose={() => setConfirmReset(false)}><div className="modal-body"><p>将清空 {workspace.cards.length} 张卡片。</p></div><div className="modal-actions"><button className="button secondary" onClick={() => { setConfirmReset(false); openExport(); }}><FileOutput size={16}/>先导出</button><button className="button primary destructive" onClick={() => { const before = clone(workspace); setWorkspace({ ...emptyWorkspace(), components: workspace.components, theme: workspace.theme }); enablePersistence(true); setConfirmReset(false); selectView('dashboard'); setToast({ message: '工作区已清空。', undo: () => { setWorkspace(current => ({ ...restoreCards(current, before, before.cards.map(card => card.id)), name: before.name })); setToast({ message: '已撤销清空。' }); } }); }}>清空工作区</button></div></Modal>}
    {uninstalling&&<Modal title={`卸载 ${uninstalling.manifest.name}？`} onClose={()=>setUninstalling(null)}><div className="modal-body"><p className="form-hint">此组件的所有卡片和实例会一并移除。</p></div><div className="modal-actions"><button className="button secondary" onClick={()=>setUninstalling(null)}>取消</button><button className="button secondary danger" onClick={()=>{const ids=workspace.instances.filter(i=>i.componentId===uninstalling.manifest.id).map(i=>i.id);const next=removeCards(workspace,workspace.cards.filter(c=>ids.includes(c.instanceId)).map(c=>c.id));setWorkspace({...next,components:next.components.filter(c=>c.manifest.id!==uninstalling.manifest.id)});setUninstalling(null);notify('组件已卸载。');}}>卸载组件</button></div></Modal>}
    {folderEditor && <FolderDialog workspace={workspace} id={folderEditor} initialDeleting={removingFolder === folderEditor} onReorder={offset => setWorkspace(current => reorderFolder(current, folderEditor, offset))} onClose={() => {setFolderEditor(null);setRemovingFolder(null);}} onSave={next => {
      const before=clone(workspace), removedFolders=before.folders?.filter(f=>!next.folders?.some(item=>item.id===f.id))??[], removedCards=before.cards.filter(c=>!next.cards.some(item=>item.id===c.id)).map(c=>c.id);
      setWorkspace(next);
      if(folderEditor==='new'){const created=next.folders?.find(f=>!workspace.folders?.some(old=>old.id===f.id));if(created){setFolderId(created.id);selectView('dashboard');}}
      if(removedFolders.length)setToast({message:'文件夹已删除。',undo:()=>{setWorkspace(current=>{const restored=restoreCards(current,before,removedCards);for(const folder of removedFolders)if(!restored.folders?.some(f=>f.id===folder.id)){restored.folders??=[];restored.folders.splice(Math.min(before.folders!.findIndex(f=>f.id===folder.id),restored.folders.length),0,clone(folder));}return restored;});setToast({message:'已恢复文件夹。'});}});
      setFolderEditor(null);
    }} onExport={id => {setFolderEditor(null);openExport(workspace.cards.filter(c => c.folderId === id).map(c => c.id));}}/>}
    {movingCard && <Modal title="移至文件夹" onClose={() => setMovingCard(null)}><div className="preset-list">{workspace.folders?.filter(f => f.id !== movingCard.folderId).map(folder => <button key={folder.id} onClick={() => {let next=moveCard(workspace,movingCard.id,folder.id); next=compactFolder(next);setWorkspace(next);setMovingCard(null);notify(`已移至 ${folder.name}。`);}}><Folder size={20} style={{color:folder.color}}/>{folder.name}</button>)}</div></Modal>}
    {toast && <div className={`toast ${toast.error ? 'error-toast' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={18}/> : <Check size={18}/>}<span>{toast.message}</span>{toast.undo && <button className="toast-undo" onClick={toast.undo}>撤销</button>}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={16}/></button></div>}
  </div>;
}

function ExportDialog({ workspace, snapshots, initialSelection, onClose, onExported }: {
  workspace: Workspace; snapshots: Record<string, Snapshot>; initialSelection: string[];
  onClose: () => void; onExported: (count: number) => void;
}) {
  const [selected, setSelected] = useState(initialSelection);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const selectedCards = workspace.cards.filter(card => selected.includes(card.id));
  const count = selectedCards.length;
  async function exportSelected() {
    if (!count || exporting) return;
    setExporting(true); setError('');
    try {
      const bundle = cardsBundle(workspace, selectedCards.map(card => card.id));
      if (count === 1) {
        await download('my-card.progress', JSON.stringify(portableWorkspace(bundle), null, 2), 'application/json');
      } else {
        await download(count === workspace.cards.length ? 'my-workspace.progresspack' : 'my-cards.progresspack', await packageWorkspace(bundle));
      }
      onExported(count);
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败，请重试。'); }
    finally { setExporting(false); }
  }
  return <Modal title="导出卡片" onClose={onClose}>
    <div className="modal-body export-body">
      <div className="export-toolbar"><span aria-live="polite">已选 <strong>{count}</strong> / {workspace.cards.length} 张</span><div><button className="text-button" disabled={exporting || !workspace.cards.length} onClick={() => setSelected(workspace.cards.map(card => card.id))}>全选</button><button className="text-button" disabled={exporting || !count} onClick={() => setSelected([])}>清空选择</button></div></div>
      {workspace.cards.length ? <div className="export-card-list" role="group" aria-label="选择要导出的卡片">{workspace.cards.map(card => {
        const instance = workspace.instances.find(item => item.id === card.instanceId)!;
        const component = workspace.components.find(item => item.manifest.id === instance.componentId)!;
        const metric = snapshots[instance.id]?.metrics.find(item => item.id === card.metricId) ?? component.metrics?.find(item => item.id === card.metricId);
        const title = card.title ?? (metric && metric.id !== 'main' ? metric.name : instance.name);
        return <label className={`export-card-option ${selected.includes(card.id) ? 'selected' : ''}`} key={card.id}>
          <input type="checkbox" checked={selected.includes(card.id)} disabled={exporting} onChange={event => setSelected(previous => event.target.checked ? [...previous, card.id] : previous.filter(id => id !== card.id))}/>
          <span className="export-card-icon" style={{ color: card.color }}><ComponentIcon component={component} size={19}/></span>
          <span className="export-card-info"><strong>{title}</strong><small>{component.manifest.name} · {rendererNames[card.renderer]}</small></span>
        </label>;
      })}</div> : <div className="export-empty"><LayoutDashboard size={25}/><p>还没有可导出的卡片</p><small>添加卡片后可导出。</small></div>}
      <p className="export-hint">{count ? <>导出为 <strong>{count === 1 ? '.progress' : '.progresspack'}</strong>，包含所选卡片及相关配置。</> : '请至少选择一张卡片。'}</p>
      {error && <div className="form-errors" role="alert">{error}</div>}
    </div>
    <div className="modal-actions"><button className="button secondary" disabled={exporting} onClick={onClose}>取消</button><button className="button primary export-confirm" disabled={!count || exporting} onClick={() => void exportSelected()}>{exporting ? <RefreshCw size={16} className="spin"/> : <FileOutput size={16}/>} {exporting ? '正在导出…' : `导出 ${count} 张卡片`}</button></div>
  </Modal>;
}

function CodexEditorDialog(props: Parameters<typeof EditorDialog>[0]) {
  return <CodexWizard {...props.editor} workspace={props.workspace} onClose={props.onClose} onSave={props.onSave} onCardAction={props.onCardAction} onWorkspaceChange={props.onWorkspaceChange}/>;
}

function ProviderEditorDialog(props:Parameters<typeof EditorDialog>[0]) { return <ProviderWizard {...props.editor} provider={props.editor.provider??manualProvider} workspace={props.workspace} onClose={props.onClose} onSave={props.onSave} onWorkspaceChange={props.onWorkspaceChange} onCardAction={props.onCardAction}/>; }

function EditorDialog({ editor, workspace, now, initialMetrics, onClose, onSave, onCardAction, onWorkspaceChange }: { onWorkspaceChange:(w:Workspace)=>void; editor: Editor; workspace: Workspace; now: number; initialMetrics?: Metric[]; onClose: () => void; onSave: (next: Workspace, quota?: CodexUsage) => void; onCardAction: (action: 'layout' | 'duplicate' | 'export' | 'remove' | 'details') => void }) {
  const { component, instance, card, appearance } = editor;
  const [name, setName] = useState(instance?.name ?? component.manifest.name);
  const [title, setTitle] = useState(card?.title ?? '');
  const [config, setConfig] = useState<Config>(() => {
    if (instance) return clone(instance.config);
    const defaults = defaultConfig(component.configSchema);
    if ('end' in defaults) defaults.end = new Date(now + 7 * 86400000).toISOString();
    if ('start' in defaults && component.configSchema.required?.includes('start')) defaults.start = new Date(now).toISOString();
    return defaults;
  });
  const [renderer, setRenderer] = useState<Renderer>(card?.renderer ?? component.manifest.renderer ?? 'bar');
  const [color, setColor] = useState(card?.color ?? colors[0]);
  const [fillDirection,setFillDirection]=useState<NonNullable<Card['fillDirection']>>(card?.fillDirection??'bottom-up');
  const [ringCenter,setRingCenter]=useState<NonNullable<Card['ringCenter']>>(card?.ringCenter??'auto');
  const [display] = useState<NonNullable<Card['display']>>(() => ({ ...card?.display }));
  const [displayPreferences,setDisplayPreferences]=useState<Card['displayPreferences']>(card?.displayPreferences);
  const [layoutVariant, setLayoutVariant] = useState(card ? preferredVariant(card, component) : layoutsFor(component).default);
  const previewVariant = layoutsFor(component).variants.find(v => v.id === layoutVariant)!;
  const [networkConsent, setNetworkConsent] = useState(instance?.networkConsent ?? false);
  const [interval, setIntervalValue] = useState(instance ? refreshInterval(component, instance) : component.manifest.runtime.type === 'http' ? component.manifest.runtime.refresh_interval ?? 15 : 15);
  const [metrics, setMetrics] = useState<Metric[]>(initialMetrics ?? []);
  const [selected, setSelected] = useState<string[]>(card ? [card.metricId] : []);
  const [step, setStep] = useState(appearance ? 1 : 0);
  const [errors, setErrors] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const candidate: Instance = { id: instance?.id ?? 'preview', componentId: component.manifest.id, name: name.trim(), config, createdAt: instance?.createdAt ?? new Date(now).toISOString(), networkConsent, ...(component.manifest.runtime.type === 'http' ? { refreshInterval: interval } : {}) };
  const preview = metrics.find(m => selected.includes(m.id)) ?? metrics[0] ?? localMetrics(component, candidate)[0];
  const allowed: Renderer[] = preview ? compatibleRenderers(preview) : ['bar', 'ring', 'number', 'fill'];
  const activeRenderer = allowed.includes(renderer) ? renderer : 'number';
  const sharedCount = instance ? workspace.cards.filter(c => c.instanceId === instance.id).length : 0;
  async function testConfig() {
    const issues = configErrors(component, config);
    if (!name.trim()) issues.unshift('请填写名称。');
    if (component.manifest.runtime.type === 'http' && !networkConsent) issues.push('请允许此连接访问网络。');
    if (component.manifest.runtime.type === 'http' && (!Number.isInteger(interval) || interval < 5 || interval > 86400)) issues.push('刷新间隔需要为 5–86400 秒的整数。');
    if (issues.length) { setErrors(issues); return; }
    setTesting(true); setErrors([]);
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), 10000);
    try {
      const nextMetrics = await fetchMetrics(component, candidate, controller.signal);
      if (controller.signal.aborted) return;
      setMetrics(nextMetrics); setSelected(previous => {
        const valid = previous.filter(id => nextMetrics.some(m => m.id === id));
        return valid.length ? valid : [nextMetrics[0].id];
      }); setStep(1);
    } catch (error) { if (!controller.signal.aborted || controller.signal.reason?.name === 'TimeoutError') setErrors([runtimeError(error)]); }
    finally { clearTimeout(timer); setTesting(false); }
  }
  function save() {
    if (!appearance && (configErrors(component, config).length || !name.trim())) { setErrors(['配置无效，请返回检查。']); return; }
    if (!selected.length) { setErrors(['请至少选择一个指标。']); return; }
    const next = clone(workspace);
    if (!next.components.some(c => c.manifest.id === component.manifest.id)) next.components.push(clone(component));
    const instanceId = instance?.id ?? uid();
    if (!appearance) {
      const saved: Instance = { ...candidate, id: instanceId, demo: component.manifest.runtime.type === 'static' && !!instance?.demo };
      next.instances = [...next.instances.filter(i => i.id !== instanceId), saved];
    }
    if (card) next.cards = next.cards.map(c => c.id === card.id ? { ...c, metricId: selected[0], renderer: activeRenderer, color, display, displayPreferences, fillDirection, ringCenter, layout: { ...c.layout, variant: layoutVariant }, ...(title.trim() ? { title: title.trim() } : { title: undefined }) } : c);
    else for (const id of selected) next.cards.push({ id: uid(), instanceId, metricId: id, renderer: compatibleRenderers(metrics.find(m => m.id === id)).includes(renderer) ? renderer : 'number', color, display, displayPreferences, fillDirection, ringCenter, layout: { variant: layoutVariant } });
    onSave(next);
  }
  return <Modal title={appearance ? '卡片外观' : instance ? '编辑配置' : component.manifest.name} subtitle={instance ? instance.name : undefined} onClose={onClose} wide dirtyKey={JSON.stringify({name,title,config,renderer,color,display,displayPreferences,fillDirection,ringCenter,layoutVariant,networkConsent,interval,selected})}>
    <div className="editor-body">
      {!appearance && <div className="editor-steps"><span className={step === 0 ? 'active' : ''}><i>1</i>配置</span><span className="step-line"/><span className={step === 1 ? 'active' : ''}><i>2</i>预览与添加</span></div>}
      <MotionContent stage={step}>{step === 0 ? <><label className="field"><span>名称<i className="required-dot"/></span><input data-autofocus="" value={name} maxLength={100} onChange={event => { setName(event.target.value); setErrors([]); }}/></label>
        <SchemaForm schema={component.configSchema} component={component} config={config} onChange={next => { setConfig(next); setErrors([]); }}/>
        {component.manifest.runtime.type === 'http' && <label className="field"><span>刷新间隔（秒）</span><input type="number" min={5} max={86400} step={1} value={Number.isFinite(interval) ? interval : ''} onChange={event => { setIntervalValue(event.target.value ? Number(event.target.value) : NaN); setErrors([]); }} onBlur={() => { if (!Number.isInteger(interval) || interval < 5 || interval > 86400) setErrors(['刷新间隔需要为 5–86400 秒的整数。']); }}/></label>}
        {sharedCount > 1 && <div className="notice">此配置由 {sharedCount} 张卡片共享，保存后会同步更新。</div>}
        {component.manifest.runtime.type === 'http' && <label className="network-permission"><input type="checkbox" checked={networkConsent} onChange={event => { setNetworkConsent(event.target.checked); setErrors([]); }}/><span><strong>允许此连接访问网络</strong><small>只访问配置的服务地址。导出后在新设备上重新确认。</small></span></label>}
      </> : <div className="preview-layout"><div className="preview-controls">
        {card && <label className="field"><span>卡片标题（可选）</span><input maxLength={100} placeholder={name} value={title} onChange={event => setTitle(event.target.value)}/></label>}
        {metrics.length > 1 && !appearance && <div className="field"><span>{card ? '选择当前卡片的指标' : '选择要添加的指标'}</span><div className="metric-picker">{metrics.map(metric => <label key={metric.id}><input type={card ? 'radio' : 'checkbox'} name="metric" checked={selected.includes(metric.id)} onChange={event => setSelected(previous => card ? [metric.id] : event.target.checked ? [...previous, metric.id] : previous.filter(id => id !== metric.id))}/>{metric.name}</label>)}</div></div>}
        <label className="field"><span>显示方式</span><select value={activeRenderer} onChange={event => setRenderer(event.target.value as Renderer)}>{allowed.map(item => <option key={item} value={item}>{rendererNames[item]}</option>)}</select></label>
        {activeRenderer==='ring'&&<label className="field"><span>圆环中心</span><select value={ringCenter} onChange={event=>setRingCenter(event.target.value as typeof ringCenter)}><option value="auto">自动（1×1 显示图标）</option><option value="icon">图标 · 下方显示百分比</option><option value="value">数值 · 圆环内显示百分比</option></select></label>}
        {activeRenderer==='fill'&&<label className="field"><span>填充方向</span><select value={fillDirection} onChange={event=>setFillDirection(event.target.value as typeof fillDirection)}><option value="bottom-up">从下向上</option><option value="left-right">从左向右</option></select></label>}
        <label className="field"><span>卡片尺寸</span><select value={layoutVariant} onChange={event => setLayoutVariant(event.target.value)}>{layoutsFor(component).variants.map(item => <option key={item.id} value={item.id}>{variantLabel(item)}</option>)}</select><small>{sizeDescription(previewVariant.span)}</small></label>
        <DisplayOptions card={{...card,id:card?.id??'preview',instanceId:candidate.id,metricId:preview?.id??'main',renderer:activeRenderer,color,display,displayPreferences}} metric={preview} metrics={metrics} onChange={setDisplayPreferences}/>

        <div className="field"><span>强调色</span><div className="color-picker">{colors.map(item => <button key={item} aria-label={`选择颜色 ${item}`} aria-pressed={color === item} style={{ backgroundColor: item }} onClick={() => setColor(item)}>{color === item && <Check size={15}/>}</button>)}</div></div>
        {metrics.length > 1 && !card && <p className="form-hint">已选 {selected.length} 个指标，将生成 {selected.length} 张卡片，共享一个数据实例。</p>}
      </div><div className="card-preview"><div className="preview-label">预览 · {variantLabel(previewVariant)}</div><CardPreview card={{...card,id:card?.id??'preview',instanceId:candidate.id,metricId:preview?.id??'main',title:title||(preview?.id!=='main'?preview?.name:name),renderer:activeRenderer,color,display,displayPreferences,ringCenter,fillDirection}} component={component} instance={candidate} snapshot={{metrics:metrics.length?metrics:preview?[preview]:[],lastSuccess:now}} now={now} variant={previewVariant}/></div></div>}
      </MotionContent>{card && <details className="advanced-details editor-card-actions"><summary>卡片操作</summary><div>{[['layout', '调整布局'], ['details', '查看详情'], ['duplicate', '复制'], ['export', '导出'], ['remove', '移除']].map(([action, label]) => <button key={action} className={`button secondary ${action === 'remove' ? 'danger' : ''}`} onClick={() => onCardAction(action as 'layout' | 'details' | 'duplicate' | 'export' | 'remove')}>{label}</button>)}</div></details>}
      {errors.length > 0 && <div role="alert" className="form-errors">{errors.map((error, index) => <p key={index}>{error}</p>)}</div>}
    </div><div className="modal-actions">{step === 1 && !appearance ? <button className="button secondary" onClick={() => setStep(0)}><ArrowLeft size={16}/>返回配置</button> : <button className="button secondary" onClick={onClose}>取消</button>}
      {step === 0 ? <button className="button primary" disabled={testing} onClick={() => void testConfig()}>{testing ? <RefreshCw size={16} className="spin"/> : null}{testing ? '检查连接中…' : '下一步'}{!testing && <ArrowRight size={16}/>}</button>
        : <button className="button primary" onClick={save}><Check size={16}/>{instance ? '保存更改' : `添加${selected.length > 1 ? ` ${selected.length} 张` : ''}卡片`}</button>}</div>
  </Modal>;
}

function RestoreDialog({ current, incoming, onClose, onSave }: { current: Workspace; incoming: Workspace; onClose: () => void; onSave: (next: Workspace) => void }) {
  const conflicts = [
    ...incoming.instances.filter(instance => current.instances.some(i => i.id === instance.id)).map(instance => ({ key: `instance:${instance.id}`, name: `${instance.name}（连接配置）` })),
    ...incoming.cards.filter(card => current.cards.some(c => c.id === card.id)).map(card => ({ key: `card:${card.id}`, name: `${card.title ?? incoming.instances.find(i => i.id === card.instanceId)?.name}（卡片）` })),
  ];
  const [mode, setMode] = useState<ConflictMode>('rename');
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState('');
  const [applyAll, setApplyAll] = useState(true);
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, ConflictMode>>({});
  return <Modal title="导入工作区" subtitle={`“${incoming.name}” · ${incoming.cards.length} 张卡片`} onClose={onClose}><div className="modal-body restore-body">
    <div className="restore-summary"><FileArchive size={28}/><div><strong>{incoming.name}</strong><span>{incoming.components.length} 个组件定义随包恢复</span></div></div>
    <label className="choice"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)}/><span>替换整个工作区<small>清空当前卡片和连接，建议先导出备份。</small></span></label>
    {!replace && conflicts.length > 0 && <><p>重复对象 {index + 1} / {conflicts.length}：{conflicts[index].name}</p><div className="conflict-choices">{(['rename', 'overwrite', 'skip'] as const).map(option => <label className="choice" key={option}><input type="radio" name="conflict" checked={mode === option} onChange={() => setMode(option)}/><span>{option === 'rename' ? '创建副本，自动重命名' : option === 'overwrite' ? '覆盖重复对象' : '跳过重复对象'}</span></label>)}</div><label className="choice"><input type="checkbox" checked={applyAll} onChange={event => setApplyAll(event.target.checked)}/><span>应用到全部剩余冲突</span></label></>}
    {!replace && !conflicts.length && <p>卡片将合并到当前工作区。</p>}
    {!!incoming.connections?.length && <div className="notice">包含 {incoming.connections.length} 个连接；恢复后需在此设备重新授权或扫描配对码。文件保留卡片与连接关系，不携带凭据。</div>}
    {incoming.instances.some(i => i.componentId === 'dev.progress.codex-usage') && <div className="notice">Codex 卡片将在恢复后等待确认本机账户。编辑配置即可重新连接。</div>}
    {incoming.instances.some(i => incoming.components.find(c => c.manifest.id === i.componentId)?.manifest.runtime.type === 'http') && <div className="notice">网络连接将在恢复后等待重新授权。编辑对应卡片配置即可连接。</div>}
    {error && <div className="form-errors" role="alert">{error}</div>}
  </div><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={() => {
    try {
      if (replace) { const next = clone(incoming); const ids = new Set(next.components.map(c => c.manifest.id)); next.components.push(...builtins.filter(c => !ids.has(c.manifest.id)).map(clone)); onSave(next); }
      else {
        const nextDecisions = { ...decisions };
        if (conflicts.length) nextDecisions[conflicts[index].key] = mode;
        if (!applyAll && index < conflicts.length - 1) { setDecisions(nextDecisions); setIndex(index + 1); return; }
        if (applyAll) conflicts.slice(index).forEach(conflict => { nextDecisions[conflict.key] = mode; });
        onSave(mergeWorkspace(current, incoming, nextDecisions));
      }
    } catch (e) { setError((e as Error).message); }
  }}>{!replace && !applyAll && index < conflicts.length - 1 ? '处理下一项' : '恢复工作区'}<ArrowRight size={16}/></button></div></Modal>;
}

function FolderDialog({workspace,id,onClose,onSave,onExport,initialDeleting,onReorder}:{workspace:Workspace;id:string;onClose:()=>void;onSave:(w:Workspace)=>void;onExport:(id:string)=>void;initialDeleting?:boolean;onReorder:(offset:-1|1)=>void}) {
  const folder=workspace.folders?.find(f=>f.id===id); const [name,setName]=useState(folder?.name??''),[icon,setIcon]=useState(folder?.icon??'folder'),[color,setColor]=useState(folder?.color??colors[0]); const [deleting,setDeleting]=useState(!!initialDeleting),[iconPicker,setIconPicker]=useState(false);
  const FolderIcon={folder:Folder,star:Star,briefcase:Briefcase,heart:Heart}[icon];
  const count=workspace.cards.filter(c=>c.folderId===id).length;
  return <Modal title={folder?'编辑文件夹':'新建文件夹'} onClose={onClose} dirtyKey={JSON.stringify({name,icon,color})}><div className="modal-body">
    {deleting?<><h3>删除「{folder?.name}」？</h3><p className="form-hint">其中 {count} 张卡片会被移除，组件仍保留。</p><div className="folder-actions"><button className="button secondary" onClick={()=>setDeleting(false)}>保留文件夹</button><button className="button secondary danger" onClick={()=>onSave({...removeCards(workspace,workspace.cards.filter(c=>c.folderId===id).map(c=>c.id)),folders:workspace.folders!.filter(f=>f.id!==id)})}>删除文件夹和卡片</button></div></>:<>
    <label className="field"><span>名称</span><input data-autofocus="" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
<div className="field"><span>图标</span><button className="button secondary" onClick={()=>setIconPicker(true)}><FolderIcon size={20}/>选择图标</button></div>{iconPicker&&<IconPicker current={icon} allowed={['folder','star','briefcase','heart']} onClose={()=>setIconPicker(false)} onConfirm={chosen=>{setIcon(chosen as typeof icon);setIconPicker(false);}}/>}
    <div className="color-picker">{colors.map(c=><button key={c} aria-label={`文件夹颜色 ${c}`} style={{background:c}} onClick={()=>setColor(c)}>{color===c&&<Check size={15}/>}</button>)}</div>
    {folder&&<div className="folder-actions"><button className="button secondary" disabled={workspace.folders![0].id === id} onClick={() => onReorder(-1)}><ArrowUp size={18}/>上移</button><button className="button secondary" disabled={workspace.folders!.at(-1)!.id === id} onClick={() => onReorder(1)}><ArrowDown size={18}/>下移</button><button className="button secondary" onClick={()=>onSave(duplicateFolder(workspace,id))}>复制文件夹</button><button className="button secondary" disabled={!count} onClick={()=>onExport(id)}><FileOutput size={16}/>导出 {count} 张卡片</button><button className="button secondary danger" disabled={workspace.folders!.length===1} title={workspace.folders!.length===1?'至少保留一个文件夹':undefined} onClick={()=>setDeleting(true)}>删除文件夹</button></div>}</>}
    </div>{!deleting&&<div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={()=>{const next=clone(workspace); const saved={id:folder?.id??uid(),name:name.trim(),icon,color};next.folders=folder?next.folders!.map(f=>f.id===id?saved:f):[...next.folders!,saved];onSave(next);}}>保存</button></div>}</Modal>;
}
