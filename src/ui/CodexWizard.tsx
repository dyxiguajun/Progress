import {DisplayOptions} from './DisplayOptions';
import {CardPreview} from './CardPreview';
import { MotionContent } from './motion';
import { sizeDescription } from '../core/presentation';
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, RefreshCw } from "lucide-react";
import {
  adaptCodexUsage,
  codexRequest,
  CodexError,
  cacheCodexUsage,
  watchCodex,
  type CodexStatus,
  type CodexUsage,
} from "../core/codex";
import {
  clone,
  colors,
  uid,
  type Card,
  type Component,
  type Instance,
  type Workspace,
} from "../core/model";
import {
  layoutsFor,
  preferredVariant,
  variantDensity,
  variantLabel,
} from "../core/grid";
import { Modal, ComponentIcon } from "./shared";
import { ConnectionPanel } from "./Pairing";
import { readInstanceConnections } from "../core/providers";
import { QuotaView } from "./QuotaView";
export function CodexWizard({
  component,
  instance,
  card,
  workspace,
  onClose,
  onSave,
  onCardAction,
  onWorkspaceChange,
}: {
  component: Component;
  instance?: Instance;
  card?: Card;
  workspace: Workspace;
  onClose: () => void;
  onSave: (w: Workspace, quota: CodexUsage) => void;
  onWorkspaceChange: (w: Workspace) => void;
  onCardAction: (
    action: "layout" | "duplicate" | "export" | "remove" | "details",
  ) => void;
}) {
  const [status, setStatus] = useState<CodexStatus>();
  const [usage, setUsage] = useState<CodexUsage>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<CodexError>();
  const [step, setStep] = useState(0),
    [name, setName] = useState(instance?.name ?? "Codex Usage");
  const [title, setTitle] = useState(card?.title ?? ""),
    [color, setColor] = useState(card?.color ?? colors[0]);
  const [displayPreferences,setDisplayPreferences]=useState<Card['displayPreferences']>(card?.displayPreferences);
  const [variant, setVariant] = useState(
    card ? preferredVariant(card, component) : "wide",
  );
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [selected, setSelected] = useState<string[]>(card?.quotaGroups ?? []);
  const [loginUrl, setLoginUrl] = useState("");
  const localSelection = useRef(false);
  const [mode, setMode] = useState<"backup" | "replace">("backup");
  const context = useRef({ workspace, instance });
  context.current = { workspace, instance };
  const operation = useRef<AbortController | null>(null),
    loginStarted = useRef(false);
  const layout = layoutsFor(component).variants.find((v) => v.id === variant)!;
  async function detect(reconnect = false) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const { workspace: current, instance: currentInstance } = context.current;
      if (
        !localSelection.current &&
        currentInstance?.connectionIds?.length &&
        current.connections?.some(
          (c) =>
            currentInstance.connectionIds?.includes(c.id) && c.kind === "relay",
        )
      ) {
        const sample = await readInstanceConnections(
          current,
          currentInstance,
          controller.signal,
        );
        if (sample.quota) {
          setUsage(sample.quota);
          setStatus({ state: "ready" });
          setSelected((previous) =>
            previous.length ? previous : [sample.quota!.groups[0].id],
          );
          return;
        }
      }
      const nextStatus = await codexRequest<CodexStatus>(
        reconnect ? "reconnect" : "status",
        reconnect ? "POST" : "GET",
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setStatus(nextStatus);
      if (nextStatus.state === "ready") {
        const next = adaptCodexUsage(
          await codexRequest<unknown>("usage", "GET", controller.signal),
        );
        if (controller.signal.aborted) return;
        setUsage(next);
        setLoginUrl("");
        setSelected((previous) =>
          previous.length
            ? previous
            : [
                next.groups.some((g) => g.id === "codex")
                  ? "codex"
                  : next.groups[0].id,
              ],
        );
      } else setUsage(undefined);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(
          e instanceof CodexError
            ? e
            : new CodexError("connection", "无法读取 Codex 配额，请重试。"),
        );
        setUsage(undefined);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void detect();
    const stop = watchCodex(() => void detect());
    return () => {
      stop();
      operation.current?.abort();
      if (loginStarted.current)
        void codexRequest("login/cancel", "POST").catch(() => {});
    };
  }, []);
  async function login() {
    setLoading(true);
    setError(undefined);
    const popup = window.open("about:blank", "_blank");
    try {
      const result = await codexRequest<{ authUrl: string }>("login", "POST");
      loginStarted.current = true;
      setLoginUrl(result.authUrl);
      if (popup) {
        popup.opener = null;
        popup.location.href = result.authUrl;
      }
    } catch (e) {
      popup?.close();
      setError(
        e instanceof CodexError
          ? e
          : new CodexError("connection", "无法开始登录，请重试。"),
      );
    } finally {
      setLoading(false);
    }
  }
  const valid =
    usage &&
    selected.length > 0 &&
    selected.every((id) => usage.groups.some((g) => g.id === id));
  function save() {
    if (!usage || !valid || !name.trim()) return;
    if (
      localSelection.current &&
      mode === "backup" &&
      instance?.config.accountKey &&
      instance.config.accountKey !== usage.account.key
    ) {
      setError(
        new CodexError(
          "account-mismatch",
          "本机账户与此卡片不同。请返回连接步骤选择替换已有连接，或创建新卡片。",
        ),
      );
      return;
    }
    const next = clone(workspace),
      instanceId = instance?.id ?? uid();
    if (!next.components.some((c) => c.manifest.id === component.manifest.id))
      next.components.push(clone(component));
    next.connections ??= [];
    let connectionIds = instance?.connectionIds;
    if (
      localSelection.current ||
      !connectionIds?.length ||
      !next.connections.some(
        (c) => connectionIds?.includes(c.id) && c.kind === "relay",
      )
    ) {
      const connectionId =
        next.connections.find(
          (c) =>
            instance?.connectionIds?.includes(c.id) &&
            c.providerId === "codex" &&
            c.kind === "direct",
        )?.id ?? uid();
      next.connections = [
        ...next.connections.filter((c) => c.id !== connectionId),
        {
          id: connectionId,
          providerId: "codex",
          method: "local",
          kind: "direct",
          label: "本机 Codex",
          accountKey: usage.account.key,
          priority: 0,
        },
      ];
      connectionIds =
        localSelection.current && mode === "replace"
          ? [connectionId]
          : [
              ...(instance?.connectionIds?.filter(
                (id) => id !== connectionId,
              ) ?? []),
              connectionId,
            ];
    }
    if ((connectionIds?.length ?? 0) > 12) {setError(new CodexError("invalid","每张配额卡片最多绑定 12 个连接，请先移除一个绑定。"));return;}
    const saved: Instance = {
      id: instanceId,
      componentId: component.manifest.id,
      name: name.trim(),
      config: { accountKey: usage.account.key },
      connectionIds,
      connectionStrategy: instance?.connectionStrategy ?? "automatic",
      createdAt: instance?.createdAt ?? new Date().toISOString(),
    };
    next.instances = [
      ...next.instances.filter((i) => i.id !== instanceId),
      saved,
    ];
    const savedCard: Card = {
      ...card,
      id: card?.id ?? uid(),
      instanceId,
      metricId: "codex-usage",
      renderer: "quota",
      color,
      displayPreferences,
      quotaGroups: selected,
      layout: { ...card?.layout, variant },
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    next.cards = card
      ? next.cards.map((c) => (c.id === card.id ? savedCard : c))
      : [...next.cards, savedCard];
    cacheCodexUsage(usage);
    onSave(next, usage);
  }
  const needsLogin = status?.state === "signed-out" || error?.code === "auth";
  return (
    <Modal
      title={instance ? "编辑 Codex 配置" : "Codex Usage"}
      onClose={onClose}
      wide
      dirtyKey={JSON.stringify({
        name,
        title,
        color,
      displayPreferences,
        variant,
        selected: selectionDirty ? selected : (card?.quotaGroups ?? []),
        localSelection: localSelection.current,
        mode,
      })}
    >
      <div className="editor-body codex-wizard">
        <div className="editor-steps">
          <span className={step === 0 ? "active" : ""}>
            <i>1</i>连接账户
          </span>
          <span className="step-line" />
          <span className={step === 1 ? "active" : ""}>
            <i>2</i>预览与添加
          </span>
        </div>
        <MotionContent stage={step}>{step === 0 ? (
          <>
            {loading ? (
              <div className="codex-connection">
                <RefreshCw className="spin" size={22} />
                <strong>正在检测 Codex 连接…</strong>
              </div>
            ) : usage ? (
              <div className="codex-connection">
                <Check size={22} />
                <div>
                  <strong>{usage.account.maskedEmail}</strong>
                  <p>{usage.account.plan} · 已读取配额</p>
                </div>
              </div>
            ) : (
              <div className="codex-connection">
                <AlertCircle size={22} />
                <div>
                  <strong>
                    {needsLogin
                      ? "请登录 ChatGPT"
                      : error?.code === "not-installed"
                        ? "未找到 Codex"
                        : status?.state === "unsupported-account"
                          ? "需要 ChatGPT 账户"
                          : "暂时无法连接"}
                  </strong>
                  <p>
                    {error?.message ??
                      (needsLogin
                        ? "登录由 Codex 完成。"
                        : "请在 Codex 中使用 ChatGPT 登录后重试。")}
                  </p>
                </div>
              </div>
            )}
            {instance &&
              usage &&
              instance.config.accountKey &&
              instance.config.accountKey !== usage.account.key && (
                <div className="notice">
                  当前 Codex
                  账户与此卡片不同。保存后此连接的卡片将使用当前账户。
                </div>
              )}
            <div className="codex-connection-actions">
              {needsLogin && (
                <button
                  className="button primary"
                  disabled={loading}
                  onClick={() => void login()}
                >
                  登录 ChatGPT
                </button>
              )}
              {error?.code === "not-installed" && (
                <a
                  className="button secondary"
                  href="https://learn.chatgpt.com/docs/cli"
                  target="_blank"
                  rel="noreferrer"
                >
                  安装 Codex
                </a>
              )}
              <button
                className="button secondary"
                disabled={loading}
                onClick={() => void detect(!needsLogin && !!error)}
              >
                重新检测
              </button>
              {instance?.connectionIds?.length && (
                <button
                  className="button secondary"
                  disabled={loading}
                  onClick={() => {
                    localSelection.current = true;
                    void detect();
                  }}
                >
                  添加或重新连接本机 Codex
                </button>
              )}
              {loginUrl && (
                <a
                  className="text-button"
                  href={loginUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开登录页面
                </a>
              )}
            </div>
            {loginUrl && (
              <p className="form-hint">
                在浏览器完成登录后，返回此页。若未自动更新，请重新检测。
              </p>
            )}
            {localSelection.current && instance?.connectionIds?.length && (
              <label className="field">
                <span>本机连接方式</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="backup">保留已有连接，添加本机直连</option>
                  <option value="replace">替换此卡片的已有连接</option>
                </select>
              </label>
            )}
            {usage && (
              <div className="codex-connection-preview">
                <QuotaView usage={usage} selected={selected} color={color} />
              </div>
            )}
            <details className="advanced-details">
              <summary>连接详情</summary>
              <p>
                来源：
                {!localSelection.current &&
                instance?.connectionIds?.some(
                  (id) =>
                    workspace.connections?.find((c) => c.id === id)?.kind ===
                    "relay",
                )
                  ? "已绑定的 Codex 连接"
                  : "本机 Codex app-server"}
                {status?.version ? ` · v${status.version}` : ""}
              </p>
              <p>
                登录信息由 Codex 保管，Progress 只读取配额。使用电脑上的
                Progress 启动器连接；Android 和独立网页暂不支持直接读取。
              </p>
            </details>
          </>
        ) : usage ? (
          <div className="preview-layout">
            <div className="preview-controls">
              <label className="field">
                <span>名称</span>
                <input
                  data-autofocus=""
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {card && (
                <label className="field">
                  <span>卡片标题（可选）</span>
                  <input
                    value={title}
                    placeholder={name}
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              )}
              {usage.groups.length > 1 && (
                <div className="field">
                  <span>显示的配额组</span>
                  <div className="metric-picker">
                    {usage.groups.map((g) => (
                      <label key={g.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(g.id)}
                          onChange={(e) => {
                            setSelectionDirty(true);
                            setSelected((p) =>
                              e.target.checked
                                ? [...p, g.id]
                                : p.filter((id) => id !== g.id),
                            );
                          }}
                        />
                        {g.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {selected.some(
                (id) => !usage.groups.some((g) => g.id === id),
              ) && (
                <div className="form-errors">
                  原来选择的配额组暂不可用。
                  <button
                    className="text-button"
                    onClick={() => setSelected([usage.groups[0].id])}
                  >
                    选择当前配额组
                  </button>
                </div>
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
              <DisplayOptions card={{...card,id:card?.id??'preview',instanceId:instance?.id??'preview',metricId:'codex-usage',renderer:'quota',color,displayPreferences}} quota onChange={setDisplayPreferences}/>
              <div className="field">
                <span>强调色</span>
                <div className="color-picker">
                  {colors.map((c) => (
                    <button
                      key={c}
                      aria-label={`选择颜色 ${c}`}
                      aria-pressed={color === c}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    >
                      {color === c && <Check size={15} />}
                    </button>
                  ))}
                </div>
              </div>
              {instance &&
                workspace.cards.filter((c) => c.instanceId === instance.id)
                  .length > 1 && (
                  <p className="form-hint">此账户连接由多张卡片共享。</p>
                )}
            </div>
            <div className="card-preview"><div className="preview-label">预览 · {variantLabel(layout)}</div><CardPreview card={{...card,id:card?.id??'preview',instanceId:instance?.id??'preview',metricId:'codex-usage',title:title||name,renderer:'quota',color,displayPreferences,quotaGroups:selected}} component={component} instance={{...(instance??{id:'preview',componentId:component.manifest.id,config:{},createdAt:new Date().toISOString()}),name}} snapshot={{metrics:[],quota:usage,lastSuccess:Date.now()}} now={Date.now()} variant={layout}/></div>
          </div>
        ) : (
          <p>请返回连接账户。</p>
        )}
        </MotionContent>{step === 1 && error && (
          <div role="alert" className="form-errors">
            {error.message}
          </div>
        )}
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
              ).map((action, i) => (
                <button
                  className={`button secondary ${action === "remove" ? "danger" : ""}`}
                  key={action}
                  onClick={() => onCardAction(action)}
                >
                  {["调整布局", "查看详情", "复制", "导出", "移除"][i]}
                </button>
              ))}
            </div>
          </details>
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
          disabled={
            loading || !usage || (step === 1 && (!valid || !name.trim()))
          }
          onClick={step ? save : () => setStep(1)}
        >
          {step ? <Check size={16} /> : <ArrowRight size={16} />}{" "}
          {step ? (instance ? "保存更改" : "添加卡片") : "下一步"}
        </button>
      </div>
    </Modal>
  );
}
