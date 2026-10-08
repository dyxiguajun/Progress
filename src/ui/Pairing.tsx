import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { QrCode, ScanLine, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import {
  type Card,
  type Connection,
  type Instance,
  type Workspace,
  cardsBundle,
  clone,
  uid,
} from "../core/model";
import { portableWorkspace } from "../core/packages";
import { assertWorkspace } from "../core/validation";
import {
  parsePairingCode,
  ownerRequest,
  claimPairing,
  pollPairing,
  finishPairing,
  saveRelayBinding,
  relayRequest,
  type PairingCode,
} from "../core/pairing";
import { readInstanceConnections } from "../core/providers";
import { readCredential } from "../core/vault";
import { builtins } from "../core/components";
import { Modal } from "./shared";

export function bindRelay(
  workspace: Workspace,
  connection: Connection,
  binding: Workspace,
  target: Instance | undefined,
  choice: "backup" | "replace" | "new",
  folderId: string,
): Workspace {
  assertWorkspace(binding);
  const next = clone(workspace);
  next.connections ??= [];
  next.connections.push(connection);
  if (target && choice !== "new") {
    if(choice === "backup" && (target.connectionIds?.length ?? 0) >= 12) throw new Error("每张配额卡片最多绑定 12 个连接，请先移除一个绑定。");
    if (
      target.connectionIds?.some(
        (id) =>
          next.connections?.find((c) => c.id === id)?.providerId !==
          connection.providerId,
      )
    )
      throw new Error("此配对码来自不同 Provider，请创建新卡片。");
    if (
      choice === "backup" &&
      connection.accountKey &&
      target.config.accountKey &&
      target.config.accountKey !== connection.accountKey
    )
      throw new Error(
        "此配对码来自不同 Codex 账户。请选择替换当前连接或创建新卡片。",
      );
    next.instances = next.instances.map((i) =>
      i.id === target.id
        ? {
            ...i,
            connectionIds:
              choice === "replace"
                ? [connection.id]
                : [...(i.connectionIds ?? []), connection.id],
            connectionStrategy: "automatic",
            ...(connection.providerId === "codex" && connection.accountKey
              ? { config: { ...i.config, accountKey: connection.accountKey } }
              : {}),
          }
        : i,
    );
    return next;
  }
  const card = binding.cards[0],
    instance = binding.instances.find((i) => i.id === card.instanceId)!,
    component = binding.components.find(
      (c) => c.manifest.id === instance.componentId,
    )!;
  const installed = next.components.find(
    (c) => c.manifest.id === component.manifest.id,
  );
  if (
    installed &&
    JSON.stringify(installed.manifest) !== JSON.stringify(component.manifest)
  )
    throw new Error("来源组件与当前版本不同，请先更新组件。");
  if (!installed) next.components.push(clone(component));
  const instanceId = uid();
  next.instances.push({
    ...instance,
    id: instanceId,
    connectionIds: [connection.id],
    connectionStrategy: "automatic",
  });
  next.cards.push({
    ...card,
    id: uid(),
    instanceId,
    folderId,
    layout: card.layout ? { variant: card.layout.variant } : undefined,
  });
  return next;
}
export function ScanBody({
  workspace,
  target,
  folderId,
  onSave,
  onCancel,
}: {
  workspace: Workspace;
  target?: Instance;
  folderId: string;
  onSave: (w: Workspace) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [label, setLabel] = useState("我的设备");
  const [pending, setPending] = useState<{
      code: PairingCode;
      requestId: string;
      verification: string;
    }>(),
    [approved, setApproved] = useState<any>(),
    [choice, setChoice] = useState<"backup" | "replace" | "new">("backup");
  const camera = useRef<{ stop: () => void } | undefined>(undefined),
    video = useRef<HTMLVideoElement>(null);
  const alive = useRef(true);
  const [cameraOn, setCameraOn] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      camera.current?.stop();
    };
  }, []);
  async function scanCamera() {
    setError("");
    setCameraOn(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!alive.current) return;
      const controls = await new BrowserQRCodeReader().decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video.current!,
        (result, _error, controls) => {
          if (result) {
            controls.stop();
            setCameraOn(false);
            setText(result.getText());
          }
        },
      );
      if (!alive.current) controls.stop();
      else camera.current = controls;
    } catch {
      setCameraOn(false);
      setError("无法打开相机，请检查相机权限。也可粘贴来源设备的配对码内容。");
    }
  }
  async function connect() {
    setError("");
    setBusy(true);
    try {
      const code = parsePairingCode(text);
      const result = await claimPairing(code, label.trim() || "我的设备");
      if (alive.current)
        setPending({
          code,
          requestId: result.requestId,
          verification: result.code,
        });
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!pending || approved) return;
    let stopped = false;
    const timer = setInterval(() => {
      void pollPairing(pending.code, pending.requestId)
        .then((result) => {
          if (!stopped && result.state === "approved") {
            assertWorkspace(result.binding);
            setApproved(result);
          }
        })
        .catch((e) => {
          if (!stopped) {
            setError((e as Error).message);
            setPending(undefined);
          }
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending, approved]);
  async function save() {
    if (!approved || !pending) return;
    setBusy(true);
    try {
      const connection = await saveRelayBinding(pending.code, approved);
      const next = bindRelay(
        workspace,
        connection,
        approved.binding,
        target,
        choice,
        folderId,
      );
      await finishPairing(pending.code, pending.requestId);
      onSave(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="scan-body">
      {!pending ? (
        <>
          <p className="form-hint">
            扫描已连接设备上的 Progress 配对码。来源设备需要批准本次连接。
          </p>
          <video
            ref={video}
            muted
            playsInline
            className={cameraOn ? "scan-video" : "scan-video hidden"}
          />
          <button
            className="button secondary"
            onClick={() => void scanCamera()}
            disabled={cameraOn}
          >
            <ScanLine size={18} />
            打开相机扫描
          </button>
          <label className="field">
            <span>此设备名称</span>
            <input
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <details className="advanced-details">
            <summary>粘贴配对码内容</summary>
            <textarea
              aria-label="配对码内容"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
            />
          </details>
          <button
            className="button primary"
            disabled={busy || !text.trim()}
            onClick={() => void connect()}
          >
            {busy ? "正在连接…" : "连接来源设备"}
          </button>
        </>
      ) : !approved ? (
        <div className="pairing-wait">
          <RefreshCw size={22} className="spin" />
          <h3>等待 {pending.code.sourceDevice} 批准</h3>
          <p>请在来源设备核对设备名称和校验码：</p>
          <strong className="verification-code">{pending.verification}</strong>
        </div>
      ) : (
        <>
          <h3>来源设备已批准</h3>
          <p className="form-hint">
            {pending.code.sourceDevice} · {approved.binding.instances[0]?.name}
          </p>
          {approved.accountLabel && (
            <p className="form-hint">来源账户：{approved.accountLabel}</p>
          )}
          {target && (
            <div className="metric-picker">
              {(["backup", "replace", "new"] as const).map((c) => (
                <label key={c}>
                  <input
                    type="radio"
                    checked={choice === c}
                    onChange={() => setChoice(c)}
                  />
                  {c === "backup"
                    ? "添加为备用连接"
                    : c === "replace"
                      ? "替换当前连接"
                      : "创建新卡片"}
                </label>
              ))}
            </div>
          )}
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {target ? "确认连接方式" : "添加卡片"}
          </button>
        </>
      )}
      {error && (
        <div role="alert" className="form-errors">
          {error}
        </div>
      )}
      <button className="text-button" onClick={onCancel}>
        取消扫描
      </button>
    </div>
  );
}
export function ScanDialog(
  props: Omit<Parameters<typeof ScanBody>[0], "onCancel"> & {
    onClose: () => void;
  },
) {
  return (
    <Modal title="扫描配对码" onClose={props.onClose} wide>
      <div className="editor-body">
        <ScanBody {...props} onCancel={props.onClose} />
      </div>
    </Modal>
  );
}
export function ConnectionPanel({
  workspace,
  instance,
  card,
  onChange,
}: {
  workspace: Workspace;
  instance?: Instance;
  card?: Card;
  onChange: (w: Workspace) => void;
}) {
  const [code, setCode] = useState<PairingCode>(),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [scanning, setScanning] = useState(false),
    [remaining, setRemaining] = useState(0),
    [busy, setBusy] = useState(false),
    [address, setAddress] = useState("");
  const [addresses, setAddresses] = useState<string[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const bindings =
    workspace.connections?.filter((c) =>
      instance?.connectionIds?.includes(c.id),
    ) ?? [];
  const active = bindings.find(
    (c) =>
      !c.reconnect &&
      (c.kind === "relay" ||
        (c.providerId === "codex" && c.accountKey) ||
        c.endpoint),
  );
  useEffect(() => {
    if (!code) return;
    void QRCode.toDataURL(JSON.stringify(code), {
      width: 300,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then(setQr);
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil((code.expiresAt - Date.now()) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [code]);
  useEffect(() => {
    if (!code || Capacitor.isNativePlatform()) return;
    const reload = () =>
      void ownerRequest("status")
        .then((s) =>
          setRequests(
            s.requests.filter((r: any) => r.connectionId === code.connectionId),
          ),
        )
        .catch(() => {});
    reload();
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [code]);
  async function approve(requestId: string, action: string) {
    try {
      await ownerRequest(action, { requestId });
      setRequests((p) => p.filter((r) => r.id !== requestId));
    } catch {
      setError("请求已失效，请重新扫描。");
    }
  }
  async function share() {
    if (!active || !card || !instance) return;
    setBusy(true);
    setError("");
    try {
      const sample = await readInstanceConnections(workspace, instance);
      const current =
        bindings.find((c) => c.id === sample.connectionId) ?? active;
      if (current.kind === "relay") {
        setCode(await relayRequest(current, "reshare", {}));
        return;
      }
      const status = await ownerRequest("status");
      if (!status.relay)
        throw new Error("请先在设置 → 连接中开启局域网 Agent。");
      setAddresses(status.addresses);
      const selected = status.addresses.includes(address)
        ? address
        : status.addresses[0];
      if (!selected) throw new Error("没有可用的局域网地址，请检查网络。");
      setAddress(selected);
      setCode(
        await ownerRequest("share", {
          address: selected,
          connection: current,
          binding: portableWorkspace(cardsBundle(workspace, [card.id])),
          snapshot: { data: sample.metrics },
          upstream:
            current.providerId === "codex"
              ? undefined
              : {
                  endpoint: current.endpoint,
                  method: current.method,
                  secret: await readCredential(current.credentialRef),
                },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="advanced-details connection-panel">
      <summary>连接与跨设备</summary>
      {instance && (
        <>
          <label className="field">
            <span>连接策略</span>
            <select
              value={instance.connectionStrategy ?? "automatic"}
              onChange={(e) =>
                onChange({
                  ...workspace,
                  instances: workspace.instances.map((i) =>
                    i.id === instance.id
                      ? {
                          ...i,
                          connectionStrategy: e.target
                            .value as Instance["connectionStrategy"],
                        }
                      : i,
                  ),
                })
              }
            >
              <option value="automatic">自动选择最新可用连接</option>
              <option value="direct">仅使用直连</option>
              <option value="relay">仅使用中继</option>
            </select>
            <small>连接设置立即生效。每个窗口保留来源的真实采样时间。</small>
          </label>
          <div className="connection-list">
            {bindings.map((c) => (
              <div key={c.id}>
                <span>
                  <strong>{c.label}</strong>
                  <small>
                    {c.kind === "relay" ? "设备中继" : "直接连接"}
                    {c.reconnect ? " · 等待重连" : ""}
                  </small>
                </span>
                <label className="connection-priority">
                  优先级
                  <select
                    aria-label={`${c.label} 优先级`}
                    value={c.priority}
                    onChange={(e) =>
                      onChange({
                        ...workspace,
                        connections: workspace.connections?.map((item) =>
                          item.id === c.id
                            ? { ...item, priority: Number(e.target.value) }
                            : item,
                        ),
                      })
                    }
                  >
                    {[...new Set([0, 10, 20, 50, 100, c.priority])]
                      .sort((a, b) => a - b)
                      .map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="text-button danger"
                  disabled={bindings.length === 1}
                  onClick={() =>
                    onChange({
                      ...workspace,
                      instances: workspace.instances.map((i) =>
                        i.id === instance.id
                          ? {
                              ...i,
                              connectionIds: i.connectionIds?.filter(
                                (id) => id !== c.id,
                              ),
                            }
                          : i,
                      ),
                    })
                  }
                >
                  移除绑定
                </button>
              </div>
            ))}
          </div>
          <p className="form-hint">
            自动模式先比较真实采样时间；时间相同时，较小的优先级数值优先，再比较响应速度。
          </p>
        </>
      )}
      <div className="folder-actions">
        <button
          className="button secondary"
          onClick={() => setScanning(!scanning)}
        >
          <ScanLine size={17} />
          扫描配对码
        </button>
        <button
          className="button secondary"
          disabled={!active || !card || busy}
          onClick={() => void share()}
        >
          <QrCode size={17} />
          {code ? "重新生成配对码" : "生成配对码"}
        </button>
      </div>
      {addresses.length > 1 && (
        <label className="field">
          <span>配对网络地址</span>
          <select
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setCode(undefined);
            }}
          >
            {addresses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>选择扫描设备能访问的本机地址，再重新生成配对码。</small>
        </label>
      )}
      {!active && (
        <p className="form-hint">
          先连接真实数据源再分享。也可以扫描其他设备上的配对码。
        </p>
      )}
      {scanning && (
        <ScanBody
          workspace={workspace}
          target={instance}
          folderId={card?.folderId ?? workspace.folders?.[0]?.id ?? "default"}
          onSave={(next) => {
            onChange(next);
            setScanning(false);
          }}
          onCancel={() => setScanning(false)}
        />
      )}
      {code && (
        <div className="pairing-code">
          {remaining > 0 && qr ? (
            <img src={qr} alt="Progress 一次性设备配对码" />
          ) : (
            <p>配对码已过期，请重新生成。</p>
          )}
          <p>{remaining > 0 ? `${remaining} 秒后过期 · 只能使用一次` : ""}</p>
          <p className="form-hint">
            扫描后在来源设备批准。配对码不包含服务凭据。
          </p>
          <details>
            <summary>配对码内容</summary>
            <textarea
              aria-label="分享配对码内容"
              readOnly
              value={JSON.stringify(code)}
            />
          </details>
        </div>
      )}
      {requests.map((r) => (
        <div className="pairing-approval" key={r.id}>
          <strong>{r.label} 请求连接</strong>
          <p>
            核对扫描设备校验码：<b>{r.code}</b>
          </p>
          <div>
            <button
              className="button secondary"
              onClick={() => void approve(r.id, "deny")}
            >
              拒绝
            </button>
            <button
              className="button primary"
              onClick={() => void approve(r.id, "approve")}
            >
              批准连接
            </button>
          </div>
        </div>
      ))}
      {error && (
        <div className="form-errors" role="alert">
          {error}
        </div>
      )}
    </details>
  );
}
export function AgentSettings() {
  const [status, setStatus] = useState<any>(),
    [error, setError] = useState("");
  const native = Capacitor.isNativePlatform();
  async function reload() {
    try {
      setStatus(await ownerRequest("status"));
      setError("");
    } catch {
      setError("本机 Agent 不可用，请通过电脑上的 Progress 启动器打开。");
    }
  }
  useEffect(() => {
    if (native) return;
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  async function action(name: string, body: unknown = {}) {
    try {
      await ownerRequest(name, body);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="settings-panel">
      <h2>设备 Agent</h2>
      {native ? (
        <p className="form-hint">
          此设备可直接连接只读服务，也可以扫描电脑、NAS
          上的配对码。来源设备负责批准和刷新。
        </p>
      ) : (
        <>
          <div className="settings-row">
            <div>
              <strong>局域网连接</strong>
              <span>
                {status?.relay
                  ? "已开启 · 只有已批准设备可读取配额"
                  : "关闭 · 开启后可为同网络设备生成配对码"}
              </span>
            </div>
            <button
              className="button secondary"
              disabled={!status}
              onClick={() => void action(status.relay ? "stop" : "start")}
            >
              {status?.relay ? "关闭 Agent" : "开启 Agent"}
            </button>
          </div>
          {status?.relay && (
            <p className="form-hint">
              来源设备：{status.sourceDevice} · 端口 {status.port}。Agent
              运行期间可用；退出启动器后停止。
            </p>
          )}
          {status?.requests.map((r: any) => (
            <div className="pairing-approval" key={r.id}>
              <strong>{r.label} 请求连接</strong>
              <p>
                请与扫描设备核对校验码：<b>{r.code}</b>
              </p>
              <div>
                <button
                  className="button secondary"
                  onClick={() => void action("deny", { requestId: r.id })}
                >
                  拒绝
                </button>
                <button
                  className="button primary"
                  onClick={() => void action("approve", { requestId: r.id })}
                >
                  批准连接
                </button>
              </div>
            </div>
          ))}
          {status?.sources.map((source: any) => (
            <div className="settings-row" key={source.id}>
              <div>
                <strong>{source.providerId} 分享源</strong>
                <span>
                  {source.observedAt
                    ? `最近采样 ${new Date(source.observedAt).toLocaleString()}`
                    : "等待采样"}
                </span>
              </div>
              <button
                className="text-button danger"
                onClick={() =>
                  void action("forget", { connectionId: source.id })
                }
              >
                停止分享并撤销授权
              </button>
            </div>
          ))}
          {status?.devices.map((d: any) => (
            <div className="settings-row" key={`${d.id}:${d.connectionId}`}>
              <strong>{d.label}</strong>
              <button
                className="text-button danger"
                onClick={() =>
                  void action("revoke", {
                    deviceId: d.id,
                    connectionId: d.connectionId,
                  })
                }
              >
                撤销设备授权
              </button>
            </div>
          ))}
        </>
      )}
      {error && <p className="form-hint">{error}</p>}
    </section>
  );
}
export const quotaComponent = () =>
  builtins.find((c) => c.manifest.id === "dev.progress.connected-quota")!;
