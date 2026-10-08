import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { type Component, type Config, type ConfigSchema } from '../core/model';
import { configErrors } from '../core/validation';
import { useReducedMotion, useVeilMotion, EXIT_DURATION } from './motion';
import { OperationContext, useOperation } from './OperationLayer';
import { useContinuousSurface } from './geometry';

import { icons } from './CardIcons';
export { icons } from './CardIcons';
export function ComponentIcon({ component, icon, size = 20 }: { component: Component; icon?: keyof typeof icons; size?: number }) {
  const Icon = icons[icon ?? (component.manifest.runtime.type==='codex_usage'?'gpt':component.icon)] ?? icons.activity; return <Icon size={size} strokeWidth={1.7} />;
}
type ModalProps={title:ReactNode;accessibleTitle?:string;subtitle?:string;onClose:()=>void;children:ReactNode;wide?:boolean;dirtyKey?:string;presentation?:'spotlight'|'add';closeIcon?:ReactNode;closeShared?:string};
export function ContextVeil({open,closing,onClose}:{open:boolean;closing:boolean;onClose:()=>void}) {const ref=useRef<HTMLDivElement>(null);useVeilMotion(ref,open);return <div ref={ref} className={`context-shade animated-veil ${closing?'is-leaving':''}`} onPointerDown={onClose} aria-hidden="true"/>;}
export function Modal(props:ModalProps){const operation=useOperation();return operation?<OperationModal {...props}/>:<StandaloneModal {...props}/>;}
export function IndependentModal(props:ModalProps){return <OperationContext.Provider value={null}><StandaloneModal {...props}/></OperationContext.Provider>;}
function OperationModal({title,accessibleTitle,subtitle,onClose,children,wide,dirtyKey,presentation,closeIcon,closeShared}:ModalProps) {
  const ref=useRef<HTMLDivElement>(null),baseline=useRef(dirtyKey),[discard,setDiscard]=useState(false),pending=useRef<(()=>void)|null>(null),bypass=useRef(false),operation=useOperation()!;
  const heading=useId(),description=useId();
  const requestClose=()=>{if(operation.phase==='closing')return;if(dirtyKey!==undefined&&dirtyKey!==baseline.current){pending.current=onClose;setDiscard(true);}else onClose();};
  useEffect(()=>{const close=()=>{if(ref.current?.closest('.motion-outgoing')||ref.current?.closest('dialog')!==Array.from(document.querySelectorAll('dialog[open]')).at(-1))return;if(discard)setDiscard(false);else requestClose();};document.addEventListener('progress:request-close',close);return()=>document.removeEventListener('progress:request-close',close);});
  useEffect(()=>{if(ref.current?.closest('.motion-outgoing'))return;const dialog=ref.current?.closest('dialog');dialog?.setAttribute('aria-labelledby',heading);if(subtitle)dialog?.setAttribute('aria-describedby',description);else dialog?.removeAttribute('aria-describedby');},[heading,description,subtitle]);
  useEffect(()=>{if(discard)ref.current?.querySelector<HTMLElement>('.discard-confirm button')?.focus();else if(operation.phase==='open')ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({preventScroll:true});},[discard]);
  return <div ref={ref} className={`modal-content ${wide?'wide':''} ${presentation??''}`} onClickCapture={event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button||bypass.current||discard)return;
    if(button.textContent?.trim()==='取消'||button.textContent?.trim()==='完成'){event.preventDefault();event.stopPropagation();requestClose();return;}
    if(dirtyKey!==undefined&&dirtyKey!==baseline.current&&button.closest('.editor-card-actions')){event.preventDefault();event.stopPropagation();pending.current=()=>{bypass.current=true;button.click();bypass.current=false;};setDiscard(true);}
  }}>
    <header className="modal-head" inert={discard||operation.phase==='closing'}><div><h2 id={heading} aria-label={accessibleTitle}>{title}</h2>{subtitle&&<p id={description}>{subtitle}</p>}</div><button className="icon-button" data-shared={closeShared} aria-label="关闭" onClick={requestClose}>{closeIcon??<X size={20}/>}</button></header>
    <div className="operation-content" inert={discard||operation.phase!=='open'}>{children}</div>
    {discard&&<div className="discard-shade"><section className="discard-confirm" role="alertdialog" aria-labelledby={`${heading}-dirty`}><h3 id={`${heading}-dirty`}>有未保存的更改</h3><p>离开后会丢弃本次编辑。</p><div><button className="button primary" onClick={()=>setDiscard(false)}>继续编辑</button><button className="button secondary danger" onClick={()=>{setDiscard(false);pending.current?.();}}>放弃更改</button></div></section></div>}
  </div>;
}
function StandaloneModal({ title, accessibleTitle, subtitle, onClose, children, wide, dirtyKey, presentation, closeIcon, closeShared }:ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useContinuousSurface(ref,24);
  const baseline = useRef(dirtyKey);
  const [discard, setDiscard] = useState(false);
  const [closing, setClosing] = useState(false), reduced = useReducedMotion(), closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leave = () => { if (reduced) { onClose(); return; } clearTimeout(closeTimer.current); setClosing(true); closeTimer.current = setTimeout(onClose, EXIT_DURATION); };
  const pending = useRef<(() => void) | null>(null), bypass = useRef(false);
  const requestClose = () => { if (dirtyKey !== undefined && dirtyKey !== baseline.current) { pending.current = leave; setDiscard(true); } else leave(); };
  useEffect(() => { const close = () => { if (ref.current === Array.from(document.querySelectorAll('dialog[open]')).at(-1)) { if(discard)setDiscard(false);else requestClose(); } }; document.addEventListener('progress:request-close', close); return () => document.removeEventListener('progress:request-close', close); });
  useEffect(()=>{const nodes=ref.current?.querySelectorAll<HTMLElement>('.modal-head,.editor-body,.modal-body,.modal-actions');nodes?.forEach(node=>{node.inert=discard;});if(discard)ref.current?.querySelector<HTMLElement>('.discard-confirm button')?.focus();},[discard]);
  const headingId = useId(), descriptionId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { clearTimeout(closeTimer.current); dialog?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={headingId} aria-describedby={subtitle ? descriptionId : undefined} className={`modal continuous-surface ${wide ? 'wide' : ''} ${presentation ?? ''} ${closing ? 'is-leaving' : ''}`} onCancel={event => { event.preventDefault(); if (discard) setDiscard(false); else requestClose(); }} onClick={event => { if (presentation === 'spotlight' && event.target === ref.current) { const bounds = ref.current!.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose(); } }}
    onClickCapture={event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || bypass.current || discard) return;
      if (button.textContent?.trim() === '取消') { event.preventDefault(); event.stopPropagation(); requestClose(); return; }
      if (dirtyKey === undefined || dirtyKey === baseline.current) return;
      if (button.textContent?.trim() === '取消' || button.closest('.editor-card-actions')) { event.preventDefault(); event.stopPropagation(); pending.current = () => { bypass.current = true; button.click(); bypass.current = false; }; setDiscard(true); }
    }}>
    <header className="modal-head"><div><h2 id={headingId} aria-label={accessibleTitle}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</div><button className="icon-button" data-shared={closeShared} aria-label="关闭" onClick={requestClose}>{closeIcon??<X size={20}/>}</button></header>
    {children}
    {discard && <div className="discard-shade"><section className="discard-confirm" role="alertdialog" aria-labelledby={`${headingId}-dirty`}><h3 id={`${headingId}-dirty`}>有未保存的更改</h3><p>离开后会丢弃本次编辑。</p><div><button data-autofocus="" className="button primary" onClick={() => setDiscard(false)}>继续编辑</button><button className="button secondary danger" onClick={() => { setDiscard(false); pending.current?.(); }}>放弃更改</button></div></section></div>}
  </dialog>;
}
function localDate(value: string) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const meaningLabels: Record<string, string> = { completed: '完成量', used: '已使用', remaining: '剩余', available: '可用' };
export function SchemaForm({ schema, component, config, onChange }: { schema: ConfigSchema; component?: Component; config: Config; onChange: (value: Config) => void }) {
  const [touched, setTouched] = useState<string[]>([]);
  const errors = component ? configErrors(component, config) : [];
  const fields = Object.entries(schema.properties);
  const required = schema.required ? fields.filter(([key]) => schema.required!.includes(key)) : fields;
  const optional = schema.required ? fields.filter(([key]) => !schema.required!.includes(key)) : [];
  const renderField = ([key, field]: typeof fields[number]) => {
    const value = config[key];
    const update = (next: string | number | boolean) => onChange({ ...config, [key]: next });
    const error = touched.includes(key) ? errors.find(error => error.startsWith(`${field.title ?? key}：`)) : undefined;
    return <label className={`field ${field.type === 'boolean' ? 'field-switch' : ''}`} key={key}>
      <span>{field.title ?? key}{schema.required?.includes(key) && <i className="required-dot" />}</span>
      <span className="field-control" onBlur={() => setTouched(previous => previous.includes(key) ? previous : [...previous, key])}>
      {field.enum ? <select aria-invalid={!!error} value={String(value)} onChange={event => update(field.type === 'number' || field.type === 'integer' ? Number(event.target.value) : event.target.value)}>
        {field.enum.map(item => <option key={String(item)} value={String(item)}>{meaningLabels[String(item)] ?? item}</option>)}
      </select> : field.type === 'boolean' ? <input type="checkbox" checked={Boolean(value)} onChange={event => update(event.target.checked)} />
        : field.format === 'date-time' ? <input aria-invalid={!!error} type="datetime-local" value={localDate(String(value ?? ''))} onInput={event => update(event.currentTarget.value ? new Date(event.currentTarget.value).toISOString() : '')} onChange={event => update(event.target.value ? new Date(event.target.value).toISOString() : '')} />
        : <input aria-invalid={!!error} type={field.type === 'string' ? 'text' : 'number'} step={field.type === 'integer' ? '1' : 'any'} min={field.minimum} max={field.maximum}
          maxLength={field.maxLength} value={typeof value === 'number' && !Number.isFinite(value) ? '' : String(value ?? '')}
          onChange={event => update(field.type === 'string' ? event.target.value : event.target.value === '' ? NaN : Number(event.target.value))} />}</span>
      {field.description && <small>{field.description}</small>}
      {error && <small className="field-error" role="alert">{error}</small>}
    </label>;
  };
  return <><div className="schema-fields">{required.map(renderField)}</div>{optional.length > 0 && <details className="advanced-details optional-fields" open={optional.some(([key]) => !!config[key]) || undefined}><summary>更多设置</summary><div className="schema-fields">{optional.map(renderField)}</div></details>}</>;
}
