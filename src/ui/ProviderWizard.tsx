import {DisplayOptions} from './DisplayOptions';
import {CardPreview} from './CardPreview';
import { MotionContent } from './motion';
import { sizeDescription } from '../core/presentation';
import { useEffect, useRef, useState } from "react";
import { Check, ArrowRight, RefreshCw, ScanLine } from "lucide-react";
import {
  type Card,
  type Component,
  type Connection,
  type ConnectionMethod,
  type Instance,
  type QuotaProvider,
  type Workspace,
  clone,
  colors,
  uid,
} from "../core/model";
import { type CodexUsage } from "../core/codex";
import {
  manualProvider,
  providers,
  readConnection,
  readInstanceConnections,
  safeEndpoint,
} from "../core/providers";
import { saveCredential, vaultDelete } from "../core/vault";
import {
  layoutsFor,
  preferredVariant,
  variantDensity,
  variantLabel,
} from "../core/grid";
import { Modal } from "./shared";
import { QuotaView } from "./QuotaView";
import { ConnectionPanel } from "./Pairing";
const methodLabels: Record<ConnectionMethod, string> = {
  local: "本机自动连接",
  oauth: "授权登录",
  "api-key": "API Key",
  bearer: "Bearer Token",
  "read-only-url": "只读 URL",
  "endpoint-secret": "Endpoint + Secret",
  pairing: "设备配对",
};
export function ProviderPicker({
  components,
  onSelect,
  onScan,
  onClose,
}: {
  components: Component[];
  onSelect: (p: QuotaProvider) => void;
  onScan: () => void;
  onClose: () => void;
}) {
  const [claude, setClaude] = useState(false);
  return (
    <Modal title="选择配额 Provider" onClose={onClose}>
      <div className="preset-list">
        {providers(components)
          .filter((p) => p.id !== "manual")
          .map((p) => (
            <button key={p.id} onClick={() => onSelect(p)}>
              <div>
                <strong>{p.name}</strong>
                <p>
                  {p.id === "codex"
                    ? "本机账户或来源设备中继"
                    : "已安装的配额 Provider"}
                </p>
              </div>
              <ArrowRight size={18} />
            </button>
          ))}
        <button onClick={() => setClaude(!claude)}>
          <div>
            <strong>Claude</strong>
            <p>查看支持范围</p>
          </div>
          <ArrowRight size={18} />
        </button>
        {claude && (
          <div className="provider-guidance">
            <p>
              当前未接入个人 Claude 订阅的剩余配额。官方组织 API
              提供历史用量报告，不能直接作为订阅剩余额度。
            </p>
            <a
              href="https://platform.claude.com/docs/en/manage-claude/usage-cost-api"
              target="_blank"
              rel="noreferrer"
            >
              查看官方支持范围
            </a>
          </div>
        )}
        <button onClick={() => onSelect(manualProvider)}>
          <div>
            <strong>手动连接</strong>
            <p>输入真实服务的数据地址与只读凭据</p>
          </div>
          <ArrowRight size={18} />
        </button>
        <button onClick={onScan}>
          <ScanLine size={20} />
          <div>
            <strong>扫描配对码</strong>
            <p>连接电脑、NAS 或另一台设备</p>
          </div>
        </button>
      </div>
    </Modal>
  );
}
export function ProviderWizard({
  component,
  provider = manualProvider,
  instance,
  card,
  workspace,
  onClose,
  onSave,
  onWorkspaceChange,
  onCardAction,
}: {
  component: Component;
  provider?: QuotaProvider;
  instance?: Instance;
  card?: Card;
  workspace: Workspace;
  onClose: () => void;
  onSave: (w: Workspace, usage: CodexUsage) => void;
  onWorkspaceChange: (w: Workspace) => void;
  onCardAction: (
    action: "layout" | "duplicate" | "export" | "remove" | "details",
  ) => void;
}) {
  const methods = provider.connectionMethods.filter(
    (m) => !["pairing", "oauth", "local"].includes(m),
  );
  const [method, setMethod] = useState<ConnectionMethod>(
      methods[0] ?? "read-only-url",
    ),
    [endpoint, setEndpoint] = useState(provider.endpoint ?? ""),
    [secret, setSecret] = useState("");
  const [name, setName] = useState(
      instance?.name ?? (provider.id === "manual" ? "配额" : provider.name),
    ),
    [color, setColor] = useState(card?.color ?? colors[0]),
    [title, setTitle] = useState(card?.title ?? "");
  const [displayPreferences,setDisplayPreferences]=useState<Card['displayPreferences']>(card?.displayPreferences);
  const [variant, setVariant] = useState(
      card ? preferredVariant(card, component) : layoutsFor(component).default,
    ),
    [step, setStep] = useState(0),
    [usage, setUsage] = useState<CodexUsage>(),
    [connection, setConnection] = useState<Connection>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(!instance),
    [mode, setMode] = useState<"backup" | "replace">("backup");
  const provisional = useRef<string | undefined>(undefined),
    saved = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!instance) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    void readInstanceConnections(workspace, instance, controller.signal)
      .then((sample) => {
        setUsage(sample.quota);
      })
      .catch(() => setForm(true))
      .finally(() => setBusy(false));
    return () => controller.abort();
  }, []);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (provisional.current && !saved.current)
        void vaultDelete(provisional.current);
    },
    [],
  );
  async function test() {
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(
      () => controller.abort(new DOMException("Timeout", "TimeoutError")),
      15000,
    );
    let credentialRef: string | undefined;
    try {
      if (secret.length > 16000)
        throw new Error("凭据超过支持的长度，请检查复制内容。");
      if (method !== "read-only-url" && !secret.trim())
        throw new Error("请填写此认证方式需要的只读凭据。");
      const url = safeEndpoint(endpoint);
      if (method !== "read-only-url")
        credentialRef = await saveCredential(secret);
      const candidate: Connection = {
        id: uid(),
        providerId: provider.id,
        method,
        kind: "direct",
        label: name.trim() || provider.name,
        endpoint: url,
        credentialRef,
        priority: 0,
      };
      const sample = await readConnection(candidate, controller.signal);
      if (provisional.current) await vaultDelete(provisional.current);
      provisional.current = credentialRef;
      setConnection(candidate);
      setUsage(sample.quota);
      setStep(1);
    } catch (e) {
      if (credentialRef) await vaultDelete(credentialRef);
      setError((e as Error).message);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  function save() {
    if (!usage || !name.trim()) return;
    const next = clone(workspace),
      instanceId = instance?.id ?? uid();
    next.connections ??= [];
    if (connection) next.connections.push(connection);
    const original = next.instances.find((i) => i.id === instanceId);
    const ids = connection
      ? mode === "replace"
        ? [connection.id]
        : [...(original?.connectionIds ?? []), connection.id]
      : (original?.connectionIds ?? []);
    if (ids.length > 12) { setError("每张配额卡片最多绑定 12 个连接，请先移除一个绑定。"); return; }
    if (!ids.length) {
      setError("请先验证并连接真实数据源。");
      return;
    }
    const savedInstance: Instance = {
      ...original,
      id: instanceId,
      componentId: component.manifest.id,
      name: name.trim(),
      config: {},
      createdAt: original?.createdAt ?? new Date().toISOString(),
      connectionIds: ids,
      connectionStrategy: original?.connectionStrategy ?? "automatic",
    };
    next.instances = [
      ...next.instances.filter((i) => i.id !== instanceId),
      savedInstance,
    ];
    if (!next.components.some((c) => c.manifest.id === component.manifest.id))
      next.components.push(component);
    const savedCard: Card = {
      ...card,
      id: card?.id ?? uid(),
      instanceId,
      metricId: "provider-quota",
      renderer: "quota",
      color,
      displayPreferences,
      title: title.trim() || undefined,
      layout: { ...card?.layout, variant },
    };
    next.cards = card
      ? next.cards.map((c) => (c.id === card.id ? savedCard : c))
      : [...next.cards, savedCard];
    saved.current = true;
    onSave(next, usage);
  }
  const layout = layoutsFor(component).variants.find((v) => v.id === variant)!;
  return (
    <Modal
      title={instance ? "编辑配额配置" : `连接 ${provider.name}`}
      onClose={onClose}
      wide
      dirtyKey={JSON.stringify({
        method,
        endpoint,
        secret,
        name,
        color,
      displayPreferences,
        title,
        variant,
        mode,
      })}
    >
      <div className="editor-body">
        <div className="editor-steps">
          <span className={step === 0 ? "active" : ""}>
            <i>1</i>连接服务
          </span>
          <span className="step-line" />
          <span className={step === 1 ? "active" : ""}>
            <i>2</i>预览与添加
          </span>
        </div>
        <MotionContent stage={step}>{step === 0 ? (
          <>
            {usage && !form ? (
              <>
                <div className="codex-connection">
                  <Check size={22} />
                  <strong>已读取 {usage.account.maskedEmail}</strong>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setForm(true)}
                >
                  添加或替换直接连接
                </button>
              </>
            ) : (
              <>
                <label className="field">
                  <span>连接方式</span>
                  <select
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value as ConnectionMethod);
                      setSecret("");
                    }}
                  >
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {methodLabels[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>
                    {method === "endpoint-secret" ? "Endpoint" : "只读数据地址"}
                  </span>
                  <input
                    type="url"
                    data-autofocus=""
                    placeholder="https://你的服务/配额"
                    autoComplete="off"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </label>
                {method !== "read-only-url" && (
                  <label className="field">
                    <span>
                      {method === "api-key"
                        ? "API Key"
                        : method === "bearer"
                          ? "Bearer Token"
                          : "Secret"}
                    </span>
                    <input
                      type="password"
                      maxLength={16000}
                      autoComplete="new-password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                    />
                    <small>
                      只保存在本机加密凭据存储中。不会写入卡片包或配对码。
                    </small>
                  </label>
                )}
                <div className="provider-guidance">
                  <h3>获取连接信息</h3>
                  <ol>
                    {provider.credentialInstructions.map((instruction, i) => (
                      <li key={i}>{instruction}</li>
                    ))}
                  </ol>
                  <p>所需权限：{provider.requiredScopes.join("、")}</p>
                  {provider.id !== "manual" && (
                    <a href={provider.helpUrl} target="_blank" rel="noreferrer">
                      打开 Provider 官方帮助
                    </a>
                  )}
                </div>
                {instance && (
                  <label className="field">
                    <span>验证后的连接用途</span>
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as typeof mode)}
                    >
                      <option value="backup">添加为备用连接</option>
                      <option value="replace">替换现有连接</option>
                    </select>
                  </label>
                )}
                <details className="advanced-details">
                  <summary>数据接口说明</summary>
                  <p>
                    返回 Progress PDM range 指标，包含
                    observed_at、meaning（used / remaining / available），可选
                    reset_at 与 window_minutes。API Key 使用 X-API-Key；Token
                    使用 Authorization: Bearer；Secret 使用
                    X-Progress-Secret。网页直连需要服务允许跨域请求。
                  </p>
                </details>
              </>
            )}
          </>
        ) : (
          usage && (
            <div className="preview-layout">
              <div>
                <label className="field">
                  <span>名称</span>
                  <input
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {card && (
                  <label className="field">
                    <span>卡片标题</span>
                    <input
                      value={title}
                      maxLength={100}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  <span>卡片尺寸</span>
                  <select
                    value={variant}
                    onChange={(e) => setVariant(e.target.value)}
                  >
                    {layoutsFor(component).variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {variantLabel(v)}
                      </option>
                    ))}
                  </select>
                <small>{sizeDescription(layout.span)}</small>
</label>
                <DisplayOptions card={{...card,id:card?.id??'preview',instanceId:instance?.id??'preview',metricId:'provider-quota',renderer:'quota',color,displayPreferences}} quota onChange={setDisplayPreferences}/>
                <div className="color-picker">
                  {colors.map((c) => (
                    <button
                      key={c}
                      aria-label={`选择颜色 ${c}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    >
                      {c === color && <Check size={15} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="card-preview"><div className="preview-label">预览 · {variantLabel(layout)}</div><CardPreview card={{...card,id:card?.id??'preview',instanceId:instance?.id??'preview',metricId:'provider-quota',title:title||name,renderer:'quota',color,displayPreferences}} component={component} instance={{...(instance??{id:'preview',componentId:component.manifest.id,config:{},createdAt:new Date().toISOString()}),name}} snapshot={{metrics:[],quota:usage,lastSuccess:Date.now()}} now={Date.now()} variant={layout}/></div>
            </div>
          )
        )}
        </MotionContent>
        <ConnectionPanel
          {...{ workspace, instance, card }}
          onChange={onWorkspaceChange}
        />
        {card && (
          <details className="advanced-details editor-card-actions">
            <summary>卡片操作</summary>
            <div>
              {(
                ["layout", "details", "duplicate", "export", "remove"] as const
              ).map((a, i) => (
                <button
                  className="button secondary"
                  key={a}
                  onClick={() => onCardAction(a)}
                >
                  {["调整布局", "查看详情", "复制", "导出", "移除"][i]}
                </button>
              ))}
            </div>
          </details>
        )}
        {error && (
          <div className="form-errors" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={step ? () => setStep(0) : onClose}
        >
          {step ? "返回连接" : "取消"}
        </button>
        <button
          className="button primary"
          disabled={busy || (step === 1 && !name.trim())}
          onClick={
            step ? save : usage && !form ? () => setStep(1) : () => void test()
          }
        >
          {busy ? (
            <RefreshCw size={16} className="spin" />
          ) : (
            <ArrowRight size={16} />
          )}{" "}
          {busy
            ? "验证连接中…"
            : step === 1
              ? instance
                ? "保存更改"
                : "添加卡片"
              : form
                ? "验证并预览"
                : "下一步"}
        </button>
      </div>
    </Modal>
  );
}
