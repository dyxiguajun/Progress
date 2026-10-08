import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  type Component,
  type QuotaProvider,
  type Connection,
  type Instance,
  type Workspace,
} from "./model";
import {
  adaptCodexUsage,
  CodexError,
  readCodexUsage,
  type CodexUsage,
} from "./codex";
import { normalizeMetrics } from "./validation";
import { readCredential } from "./vault";
import { relayRequest } from "./pairing";
import type { Snapshot } from "./sourceState";
export const manualProvider: QuotaProvider = {
  id: "manual",
  name: "手动连接",
  connectionMethods: [
    "read-only-url",
    "bearer",
    "api-key",
    "endpoint-secret",
    "pairing",
  ],
  helpUrl: "",
  credentialInstructions: [
    "在你自己的服务或 NAS 中启用 Progress 只读数据接口。",
    "在该服务的访问管理中创建仅能读取配额的凭据。",
    "复制数据地址，并选择服务使用的认证方式。不要授予写入或管理权限。",
  ],
  requiredScopes: ["读取配额（GET）"],
};
export const codexProvider: QuotaProvider = {
  id: "codex",
  name: "Codex",
  connectionMethods: ["local", "oauth", "pairing"],
  helpUrl: "https://developers.openai.com/codex/app-server/",
  credentialInstructions: [
    "在来源电脑安装 Codex，并使用 ChatGPT 登录。",
    "由 Codex 保管登录信息；Progress 读取 app-server 配额。",
    "手机请扫描来源电脑生成的配对码，等待电脑批准。",
  ],
  requiredScopes: ["读取账户与配额"],
};
export function providers(components: Component[]) {
  return [
    codexProvider,
    ...components.flatMap((c) =>
      c.manifest.quotaProvider ? [c.manifest.quotaProvider] : [],
    ),
    manualProvider,
  ];
}
export function safeEndpoint(value: string, allowLocal = true) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请填写完整的 HTTPS 数据地址。");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(allowLocal && local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.href.length > 2048
  )
    throw new Error(
      "地址需使用 HTTPS，且不能包含凭据、查询参数或片段。本机调试可使用 HTTP。",
    );
  return url.href;
}
export async function requestJson(
  url: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
) {
  const method = options.body === undefined ? "GET" : "POST";
  const headers = {
    Accept: "application/json",
    ...options.headers,
    ...(options.body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
  };
  if (options.signal?.aborted) throw options.signal.reason;
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: options.body,
      connectTimeout: 10000,
      readTimeout: 15000,
      disableRedirects: true,
    });
    if (options.signal?.aborted) throw options.signal.reason;
    if (result.status < 200 || result.status >= 300)
      throw new CodexError(
        result.status === 401 ? "auth" : "connection",
        "连接失败，请检查服务和凭据。",
      );
    const text =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data);
    if (text.length > 2_000_000)
      throw new CodexError("invalid", "服务数据过大。");
    return JSON.parse(text);
  }
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new CodexError(
      response.status === 401 ? "auth" : "connection",
      response.status === 401
        ? "凭据失效，请重新连接。"
        : "连接失败，请检查服务是否在线。",
    );
  if (Number(response.headers.get("content-length")) > 2_000_000)
    throw new CodexError("invalid", "服务数据过大。");
  const reader = response.body?.getReader();
  if (!reader) throw new CodexError("invalid", "服务没有返回数据。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new CodexError("invalid", "服务数据过大。");
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new CodexError("invalid", "服务返回的不是 JSON 数据。");
  }
}
export function adaptPdmQuota(
  value: unknown,
  providerId: string,
  label: string,
): CodexUsage {
  const metrics = normalizeMetrics(value);
  const ranges = metrics.filter((m) => m.kind === "range");
  if (
    !ranges.length ||
    ranges.some(
      (m) =>
        !m.observed_at ||
        !["used", "remaining", "available"].includes(m.meaning ?? "") ||
        typeof m.value !== "number" ||
        m.value < (m.min ?? 0) ||
        m.value > m.max!,
    )
  )
    throw new CodexError(
      "invalid",
      "配额接口需要带真实 observed_at 的 range 指标，meaning 为 used、remaining 或 available。",
    );
  const observedAt = ranges.reduce(
    (a, m) => (Date.parse(m.observed_at!) < Date.parse(a) ? m.observed_at! : a),
    ranges[0].observed_at!,
  );
  return {
    account: { key: providerId, maskedEmail: label, plan: "配额" },
    observedAt,
    metrics,
    groups: [
      {
        id: providerId,
        limitId: providerId,
        name: label,
        windows: ranges.map((m) => {
          const percent =
            ((Number(m.value) - (m.min ?? 0)) / (m.max! - (m.min ?? 0))) * 100;
          const remaining = m.meaning === "used" ? 100 - percent : percent;
          return {
            id: m.id,
            metricId: m.id,
            label: m.name,
            usedPercent: 100 - remaining,
            remainingPercent: remaining,
            durationMinutes: m.window_minutes ?? null,
            resetsAt: m.reset_at ? Date.parse(m.reset_at) / 1000 : null,
          };
        }),
      },
    ],
  };
}
export type ConnectionSample = Snapshot & {
  observedAt: string;
  receivedAt: string;
  sourceDevice: string;
  connectionId: string;
  latency: number;
};
export function newestSnapshot(
  previous: Snapshot | undefined,
  incoming: Snapshot,
): Snapshot {
  return previous?.observedAt &&
    incoming.observedAt &&
    Date.parse(incoming.observedAt) < Date.parse(previous.observedAt)
    ? { ...previous, loading: false, error: undefined, errorCode: undefined }
    : incoming;
}

export function sourceSignature(workspace: Workspace, instance: Instance) {
  return JSON.stringify({
    instance,
    component: workspace.components.find(
      (c) => c.manifest.id === instance.componentId,
    ),
    connections: (instance.connectionIds ?? []).map((id) =>
      workspace.connections?.find((c) => c.id === id),
    ),
  });
}
export function sampleCacheKey(workspace: Workspace, instance: Instance) {
  return `sample:v5:${instance.id}:${sourceSignature(workspace, instance)}`;
}
export function chooseConnection(
  samples: ConnectionSample[],
  connections: Connection[],
  strategy: Instance["connectionStrategy"] = "automatic",
) {
  const eligible = samples.filter(
    (s) =>
      strategy === "automatic" ||
      connections.find((c) => c.id === s.connectionId)?.kind === strategy,
  );
  return eligible.sort(
    (a, b) =>
      Date.parse(b.observedAt) - Date.parse(a.observedAt) ||
      (connections.find((c) => c.id === a.connectionId)?.priority ?? 100) -
        (connections.find((c) => c.id === b.connectionId)?.priority ?? 100) ||
      a.latency - b.latency,
  )[0];
}
export async function readConnection(
  connection: Connection,
  signal?: AbortSignal,
): Promise<ConnectionSample> {
  if (connection.reconnect) throw new CodexError("auth", "连接等待重新授权。");
  const started = Date.now();
  let quota: CodexUsage,
    sourceDevice = connection.sourceDevice ?? "当前设备";
  if (connection.kind === "relay") {
    let packet;
    try {
      packet = await relayRequest(connection, "snapshot", {}, signal);
    } catch (e) {
      const message = (e as Error).message;
      throw new CodexError(
        /账户改变/.test(message)
          ? "account-mismatch"
          : /未获授权|重新配对|连接已失效|重新扫描/.test(message)
            ? "auth"
            : "connection",
        message,
      );
    }
    quota =
      connection.providerId === "codex"
        ? adaptCodexUsage(packet.data)
        : adaptPdmQuota(packet.data, connection.providerId, connection.label);
    if (connection.accountKey && quota.account.key !== connection.accountKey)
      throw new CodexError(
        "account-mismatch",
        "来源账户改变，请重新确认连接。",
      );
    sourceDevice = packet.sourceDevice;
    if (packet.observedAt !== quota.observedAt)
      throw new CodexError("invalid", "中继采样时间与数据不一致。");
  } else if (connection.providerId === "codex")
    quota = await readCodexUsage(connection.accountKey ?? "", signal);
  else {
    const secret = await readCredential(connection.credentialRef);
    const headers: Record<string, string> = {};
    if (connection.method === "bearer")
      headers.Authorization = `Bearer ${secret}`;
    if (connection.method === "api-key") headers["X-API-Key"] = secret;
    if (connection.method === "endpoint-secret")
      headers["X-Progress-Secret"] = secret;
    quota = adaptPdmQuota(
      await requestJson(safeEndpoint(connection.endpoint ?? ""), {
        headers,
        signal,
      }),
      connection.providerId,
      connection.label,
    );
  }
  return {
    quota,
    metrics: quota.metrics,
    lastSuccess: Date.parse(quota.observedAt),
    observedAt: quota.observedAt,
    receivedAt: new Date().toISOString(),
    sourceDevice,
    connectionId: connection.id,
    latency: Date.now() - started,
  };
}
export async function readInstanceConnections(
  workspace: Workspace,
  instance: Instance,
  signal?: AbortSignal,
): Promise<ConnectionSample> {
  const connections = (workspace.connections ?? []).filter(
    (c) =>
      instance.connectionIds?.includes(c.id) &&
      (instance.connectionStrategy === undefined ||
        instance.connectionStrategy === "automatic" ||
        c.kind === instance.connectionStrategy),
  );
  const results = await Promise.allSettled(
    connections.map((c) => readConnection(c, signal)),
  );
  const samples = results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );
  const selected = chooseConnection(
    samples,
    connections,
    instance.connectionStrategy,
  );
  if (selected) return selected;
  throw (
    results.find((r) => r.status === "rejected")?.reason ??
    new CodexError("auth", "请为此卡片添加连接。")
  );
}
