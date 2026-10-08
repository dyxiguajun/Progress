import { webcrypto, randomBytes, randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  chmod,
} from "node:fs/promises";
import { resolve } from "node:path";
import { hostname, networkInterfaces } from "node:os";
import { createServer } from "node:http";
const crypto = webcrypto,
  encode = (v) => Buffer.from(v).toString("base64"),
  decode = (v) => Buffer.from(v, "base64"),
  utf8 = (v) => new TextEncoder().encode(v);
class AgentError extends Error {}
async function json(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 100000) throw new AgentError("请求过大。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export class PairingAgent {
  constructor(
    codex,
    {
      directory = process.env.PROGRESS_AGENT_HOME ?? resolve(".progress-agent"),
      now = Date.now,
      ttl = 120000,
      listenHost = process.env.PROGRESS_AGENT_BIND === "127.0.0.1"
        ? "127.0.0.1"
        : "0.0.0.0",
    } = {},
  ) {
    this.codex = codex;
    this.directory = directory;
    this.now = now;
    this.ttl = ttl;
    this.listenHost = listenHost;
    this.writes = new Map();
    this.samples = new Map();
    this.rates = new Map();
    this.inFlight = 0;
    this.sessions = new Map();
    this.pending = new Map();
    this.sources = new Map();
    this.replays = new Map();
    this.devices = [];
    this.ready = this.initialize();
    this.ready.catch(() => {});
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try {
      const saved = JSON.parse(
        await readFile(resolve(this.directory, "identity.json"), "utf8"),
      );
      this.deviceId = saved.id;
      this.privateKey = await crypto.subtle.importKey(
        "pkcs8",
        decode(saved.privateKey),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveKey"],
      );
      this.publicKey = saved.publicKey;
    } catch (e) {
      if (e.code !== "ENOENT") throw new AgentError("Agent 身份文件不可用。");
      const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey"],
      );
      this.deviceId = randomUUID();
      this.privateKey = pair.privateKey;
      this.publicKey = encode(
        await crypto.subtle.exportKey("spki", pair.publicKey),
      );
      await writeFile(
        resolve(this.directory, "identity.json"),
        JSON.stringify({
          id: this.deviceId,
          privateKey: encode(
            await crypto.subtle.exportKey("pkcs8", pair.privateKey),
          ),
          publicKey: this.publicKey,
        }),
        { mode: 0o600, flag: "wx" },
      );
    }
    const self = await crypto.subtle.importKey(
      "spki",
      decode(this.publicKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    this.vaultKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: self },
      this.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    try {
      const envelope = JSON.parse(
        await readFile(resolve(this.directory, "sources.enc"), "utf8"),
      );
      const data = JSON.parse(
        new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: decode(envelope.iv),
              additionalData: utf8("progress-agent-vault/v1"),
            },
            this.vaultKey,
            decode(envelope.cipher),
          ),
        ),
      );
      this.sources = new Map(data.map((s) => [s.id, s]));
    } catch (e) {
      if (e.code !== "ENOENT") throw new AgentError("Agent 连接存储不可用。");
    }
    if (!this.closed)
      this.timer = setInterval(() => {
        for (const source of this.sources.values())
          void this.sample(source)
            .then(() => this.saveSources())
            .catch(() => {});
      }, 300000);
    this.timer?.unref();
    try {
      this.devices = JSON.parse(
        await readFile(resolve(this.directory, "devices.json"), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  persist(name, content) {
    const previous = this.writes.get(name) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const file = resolve(this.directory, name),
          temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, await content(), {
            mode: 0o600,
            flag: "wx",
          });
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writes.set(name, next);
    return next;
  }
  saveSources() {
    return this.persist("sources.enc", async () => {
      const iv = randomBytes(12);
      const cipher = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: utf8("progress-agent-vault/v1"),
        },
        this.vaultKey,
        utf8(JSON.stringify([...this.sources.values()])),
      );
      return JSON.stringify({ iv: encode(iv), cipher: encode(cipher) });
    });
  }
  saveDevices() {
    return this.persist("devices.json", async () =>
      JSON.stringify(this.devices),
    );
  }
  sweep() {
    const now = this.now();
    for (const [k, s] of this.sessions)
      if (s.expiresAt <= now) this.sessions.delete(k);
    for (const [k, p] of this.pending)
      if (p.expiresAt <= now) this.pending.delete(k);
    for (const [k, t] of this.replays) if (t <= now) this.replays.delete(k);
  }
  sample(source) {
    const identity = `${source.id}:${source.accountKey ?? source.upstream?.endpoint ?? ""}`;
    const active = this.samples.get(identity);
    if (active) return active;
    const request = this.sampleSource(source).finally(() =>
      this.samples.delete(identity),
    );
    this.samples.set(identity, request);
    return request;
  }
  async sampleSource(source) {
    if (source.providerId === "codex") {
      const data = await this.codex.usage();
      if (data.account.key !== source.accountKey)
        throw new AgentError("来源账户改变，请在电脑重新确认连接。");
      source.snapshot = {
        data,
        observedAt: data.observedAt,
        sourceDevice: hostname(),
      };
    } else if (source.upstream) {
      const { endpoint, method, secret } = source.upstream;
      const headers = { Accept: "application/json" };
      if (method === "bearer") headers.Authorization = `Bearer ${secret}`;
      if (method === "api-key") headers["X-API-Key"] = secret;
      if (method === "endpoint-secret") headers["X-Progress-Secret"] = secret;
      const response = await fetch(endpoint, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new AgentError("来源服务连接失败，请在来源设备重新连接。");
      if (Number(response.headers.get("content-length")) > 2000000)
        throw new AgentError("数据过大。");
      const reader = response.body.getReader();
      let size = 0,
        text = "";
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2000000) {
          await reader.cancel();
          throw new AgentError("数据过大。");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const data = JSON.parse(text);
      const snapshot = this.cleanSnapshot(
        { data: Array.isArray(data) ? data : (data.metrics ?? [data]) },
        source.providerId,
      );
      if (!snapshot) throw new AgentError("来源服务数据不兼容。");
      if (
        !source.snapshot ||
        Date.parse(snapshot.observedAt) >=
          Date.parse(source.snapshot.observedAt)
      )
        source.snapshot = snapshot;
    }
    if (!source.snapshot) throw new AgentError("来源设备尚未提供数据。");
    return source.snapshot;
  }
  async owner(action, body, endpoint) {
    await this.ready;
    this.sweep();
    if (action === "status")
      return {
        sourceDevice: hostname(),
        sourceDeviceId: this.deviceId,
        relay: !!this.server,
        port: this.server?.address()?.port,
        addresses:
          this.listenHost === "127.0.0.1"
            ? ["127.0.0.1"]
            : Object.values(networkInterfaces())
                .flat()
                .filter((n) => n && n.family === "IPv4" && !n.internal)
                .map((n) => n.address),
        requests: [...this.pending.values()]
          .filter((p) => p.state === "pending")
          .map((p) => ({
            id: p.id,
            label: p.label,
            code: p.code,
            expiresAt: p.expiresAt,
            connectionId: p.connectionId,
          })),
        devices: this.devices.map((d) => ({
          id: d.id,
          label: d.label,
          connectionId: d.connectionId,
        })),
        sources: [...this.sources.values()].map((s) => ({
          id: s.id,
          providerId: s.providerId,
          observedAt: s.snapshot?.observedAt,
        })),
      };
    if (action === "start") {
      if (!this.server) {
        this.server = createServer(
          {
            requestTimeout: 10000,
            headersTimeout: 10000,
            maxHeaderSize: 16384,
          },
          (req, res) => void this.remoteHandler(req, res),
        );
        await new Promise((resolve, reject) => {
          this.server.once("error", reject);
          this.server.listen(0, this.listenHost, resolve);
        });
      }
      const status = await this.owner("status", {}, endpoint);
      for (const source of this.sources.values()) {
        const previous = source.endpoint
          ? new URL(source.endpoint).hostname
          : "";
        const address = status.addresses.includes(previous)
          ? previous
          : status.addresses[0];
        if (address)
          source.endpoint = `http://${address}:${status.port}/progress-relay/v1`;
      }
      await this.saveSources();
      return status;
    }
    if (action === "stop") {
      this.server?.closeAllConnections();
      this.server?.close();
      this.server = undefined;
      this.sessions.clear();
      this.pending.clear();
      return {};
    }
    if (action === "share") {
      const { connection, binding, snapshot } = body;
      if (
        !connection ||
        typeof connection.id !== "string" ||
        typeof connection.providerId !== "string" ||
        !/^[a-z][a-z0-9.-]{0,199}$/.test(connection.providerId) ||
        !binding ||
        binding.cards?.length !== 1 ||
        JSON.stringify(binding).length > 60000
      )
        throw new AgentError("连接元数据无效。");
      if (this.sessions.size >= 32) throw new AgentError("请稍后重试。");
      const source = {
        id: connection.id,
        providerId: connection.providerId,
        accountKey: connection.accountKey,
        binding,
        snapshot: this.cleanSnapshot(snapshot, connection.providerId),
      };
      await this.sample(source);
      if (body.upstream && source.providerId !== "codex") {
        const u = new URL(body.upstream.endpoint);
        if (
          (u.protocol !== "https:" &&
            !(
              u.protocol === "http:" &&
              ["127.0.0.1", "localhost"].includes(u.hostname)
            )) ||
          u.username ||
          u.password ||
          u.search ||
          u.hash ||
          !["read-only-url", "bearer", "api-key", "endpoint-secret"].includes(
            body.upstream.method,
          ) ||
          typeof body.upstream.secret !== "string" ||
          body.upstream.secret.length > 16000
        )
          throw new AgentError("来源连接信息无效。");
        source.upstream = {
          endpoint: u.href,
          method: body.upstream.method,
          secret: body.upstream.secret,
        };
      }
      source.endpoint = endpoint;
      this.sources.set(source.id, source);
      await this.saveSources();
      for (const [k, s] of this.sessions)
        if (s.connectionId === source.id) this.sessions.delete(k);
      const token = randomBytes(32).toString("hex"),
        expiresAt = this.now() + this.ttl;
      const code = {
        schema: "progress/pairing/v1",
        token,
        expiresAt,
        sourceDevice: hostname(),
        sourceDeviceId: this.deviceId,
        connectionId: source.id,
        cardId: binding.cards[0].id,
        endpoint,
        publicKey: this.publicKey,
      };
      this.sessions.set(token, { ...code, source });
      return code;
    }
    if (action === "publish") {
      const source = this.sources.get(body.connectionId);
      if (source && source.providerId !== "codex") {
        const sample = this.cleanSnapshot(body.snapshot, source.providerId);
        if (
          sample &&
          (!source.snapshot ||
            Date.parse(sample.observedAt) >
              Date.parse(source.snapshot.observedAt))
        )
          source.snapshot = sample;
        await this.saveSources();
      }
      return {};
    }
    if (action === "approve" || action === "deny") {
      const pending = this.pending.get(body.requestId);
      if (
        !pending ||
        pending.state !== "pending" ||
        pending.expiresAt <= this.now()
      )
        throw new AgentError("请求已经失效，请重新扫描。");
      pending.state = action === "approve" ? "approved" : "denied";
      if (action === "approve") {
        this.devices = this.devices.filter(
          (d) =>
            !(
              d.id === pending.deviceId &&
              d.connectionId === pending.connectionId
            ),
        );
        this.devices.push({
          id: pending.deviceId,
          label: pending.label,
          publicKey: pending.publicKey,
          connectionId: pending.connectionId,
        });
        await this.saveDevices();
      }
      return {};
    }
    if (action === "forget") {
      this.sources.delete(body.connectionId);
      this.devices = this.devices.filter(
        (d) => d.connectionId !== body.connectionId,
      );
      for (const [key, session] of this.sessions)
        if (session.connectionId === body.connectionId)
          this.sessions.delete(key);
      for (const [key, pending] of this.pending)
        if (pending.connectionId === body.connectionId)
          this.pending.delete(key);
      await Promise.all([this.saveDevices(), this.saveSources()]);
      return {};
    }
    if (action === "revoke") {
      this.devices = this.devices.filter(
        (d) =>
          !(d.id === body.deviceId && d.connectionId === body.connectionId),
      );
      for (const [k, p] of this.pending)
        if (p.deviceId === body.deviceId) this.pending.delete(k);
      await this.saveDevices();
      return {};
    }
    throw new AgentError("不支持此操作。");
  }
  cleanSnapshot(snapshot, providerId) {
    if (!snapshot) return undefined;
    const data = snapshot.data;
    if (providerId === "codex") return undefined;
    if (!Array.isArray(data) || data.length < 1 || data.length > 100)
      return undefined;
    const keys = [
      "id",
      "name",
      "kind",
      "value",
      "min",
      "max",
      "unit",
      "meaning",
      "observed_at",
      "stale_after",
      "reset_at",
      "window_minutes",
    ];
    const metrics = data.filter(m => m?.kind === "range").map((m) =>
      Object.fromEntries(
        keys.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]),
      ),
    );
    if (
      !metrics.length || metrics.some(
        (m) =>
          m.kind !== "range" ||
          !Number.isFinite(m.value) ||
          !Number.isFinite(m.max) ||
          !Number.isFinite(m.min ?? 0) ||
          m.max <= (m.min ?? 0) ||
          m.value < (m.min ?? 0) ||
          m.value > m.max ||
          typeof m.id !== "string" ||
          typeof m.name !== "string" ||
          (m.reset_at !== undefined &&
            !Number.isFinite(Date.parse(m.reset_at))) ||
          (m.window_minutes !== undefined &&
            (!Number.isFinite(m.window_minutes) || m.window_minutes <= 0)) ||
          !["used", "remaining", "available"].includes(m.meaning) ||
          !Number.isFinite(Date.parse(m.observed_at)),
      )
    )
      return undefined;
    const observedAt = metrics.reduce(
      (a, m) => (Date.parse(m.observed_at) < Date.parse(a) ? m.observed_at : a),
      metrics[0].observed_at,
    );
    return { data: metrics, observedAt, sourceDevice: hostname() };
  }
  async handle(payload) {
    await this.ready;
    this.sweep();
    const { signature, ...signed } = payload;
    if (
      typeof signed.nonce !== "string" ||
      signed.nonce.length > 100 ||
      typeof signed.deviceId !== "string" ||
      signed.deviceId.length > 200 ||
      !Number.isFinite(signed.timestamp) ||
      Math.abs(this.now() - signed.timestamp) > 60000 ||
      this.replays.has(`${signed.deviceId}:${signed.nonce}`)
    )
      throw new AgentError("请求已过期或被重复使用。");
    let peer;
    if (signed.action === "claim") {
      const session = this.sessions.get(signed.token);
      if (!session || session.expiresAt <= this.now())
        throw new AgentError("配对码已使用或过期。");
      peer = signed.publicKey;
    } else if (["poll", "finish"].includes(signed.action))
      peer = this.pending.get(signed.requestId)?.publicKey;
    else if (["snapshot", "reshare"].includes(signed.action))
      peer = this.devices.find(
        (d) =>
          d.id === signed.deviceId && d.connectionId === signed.connectionId,
      )?.publicKey;
    if (!peer) throw new AgentError("设备未获授权，请重新配对。");
    const key = await crypto.subtle.importKey(
      "spki",
      decode(peer),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        decode(signature),
        utf8(JSON.stringify(signed)),
      ))
    )
      throw new AgentError("设备签名无效。");
    if (this.replays.size >= 4096)
      throw new AgentError("请求过多，请稍后重试。");
    this.replays.set(`${signed.deviceId}:${signed.nonce}`, this.now() + 120000);
    if (signed.action === "claim") {
      if (
        this.pending.size >= 32 ||
        typeof signed.label !== "string" ||
        signed.label.length > 100
      )
        throw new AgentError("配对请求无效。");
      const session = this.sessions.get(signed.token);
      this.sessions.delete(signed.token);
      const id = randomUUID(),
        code = createHash("sha256")
          .update(`${peer}:${session.token}`)
          .digest("hex")
          .slice(0, 6)
          .toUpperCase();
      this.pending.set(id, {
        id,
        code,
        deviceId: signed.deviceId,
        label: signed.label,
        publicKey: peer,
        connectionId: session.connectionId,
        state: "pending",
        expiresAt: this.now() + 120000,
      });
      return { requestId: id, code, state: "pending" };
    }
    if (["poll", "finish"].includes(signed.action)) {
      const pending = this.pending.get(signed.requestId);
      if (!pending || pending.deviceId !== signed.deviceId)
        throw new AgentError("配对请求已过期。");
      if (pending.state === "denied")
        throw new AgentError("来源设备拒绝了配对。");
      if (signed.action === "finish") {
        if (pending.state !== "approved")
          throw new AgentError("请先在来源设备批准。");
        this.pending.delete(signed.requestId);
        return { state: "complete" };
      }
      const source = this.sources.get(pending.connectionId);
      if (!source) throw new AgentError("来源连接已失效，请重新扫描。");
      return pending.state === "approved"
        ? {
            state: "approved",
            providerId: source.providerId,
            ...(source.providerId === "codex"
              ? {
                  accountKey: source.accountKey,
                  accountLabel: source.snapshot?.data?.account?.maskedEmail,
                }
              : {}),
            binding: source.binding,
          }
        : { state: "pending" };
    }
    if (signed.action === "reshare") {
      const source = this.sources.get(signed.connectionId);
      if (!source || !source.endpoint) throw new AgentError("来源连接不可用。");
      const token = randomBytes(32).toString("hex"),
        expiresAt = this.now() + this.ttl;
      const code = {
        schema: "progress/pairing/v1",
        token,
        expiresAt,
        sourceDevice: hostname(),
        sourceDeviceId: this.deviceId,
        connectionId: source.id,
        cardId: source.binding.cards[0].id,
        endpoint: source.endpoint,
        publicKey: this.publicKey,
      };
      if (this.sessions.size >= 32)
        throw new AgentError("配对会话过多，请稍后重试。");
      this.sessions.set(token, { ...code, source });
      return code;
    }
    if (signed.action === "snapshot") {
      const source = this.sources.get(signed.connectionId);
      if (!source)
        throw new AgentError("来源连接已失效，请在来源设备重新生成配对码。");
      return this.sample(source);
    }
    throw new AgentError("不支持此操作。");
  }
  async remoteHandler(req, res) {
    if (req.url !== "/progress-relay/v1") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type,Accept",
      });
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    const now = this.now(),
      address = req.socket.remoteAddress ?? "unknown";
    for (const [ip, record] of this.rates)
      if (record.until <= now) this.rates.delete(ip);
    const rate = this.rates.get(address) ?? { count: 0, until: now + 60000 };
    if (
      this.inFlight >= 32 ||
      (this.rates.size >= 256 && !this.rates.has(address)) ||
      ++rate.count > 120
    ) {
      res.writeHead(429);
      res.end();
      return;
    }
    this.rates.set(address, rate);
    this.inFlight++;
    req.setTimeout(10000, () => req.destroy());
    let key;
    try {
      await this.ready;
      const envelope = await json(req);
      if (
        !Number.isFinite(envelope.timestamp) ||
        Math.abs(this.now() - envelope.timestamp) > 60000 ||
        typeof envelope.key !== "string" ||
        envelope.key.length > 512 ||
        typeof envelope.iv !== "string" ||
        decode(envelope.iv).length !== 12 ||
        typeof envelope.cipher !== "string"
      )
        throw new Error();
      const peer = await crypto.subtle.importKey(
        "spki",
        decode(envelope.key),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      key = await crypto.subtle.deriveKey(
        { name: "ECDH", public: peer },
        this.privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      const payload = JSON.parse(
        new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: decode(envelope.iv),
              additionalData: utf8(`${envelope.key}:${envelope.timestamp}`),
            },
            key,
            decode(envelope.cipher),
          ),
        ),
      );
      let result;
      try {
        result = await this.handle(payload);
      } catch (e) {
        result = {
          error:
            e instanceof AgentError
              ? e.message
              : "来源连接暂不可用，请检查来源设备。",
        };
      }
      const iv = randomBytes(12),
        cipher = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: utf8("response") },
          key,
          utf8(JSON.stringify(result)),
        );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ iv: encode(iv), cipher: encode(cipher) }));
    } catch {
      res.writeHead(400);
      res.end();
    } finally {
      this.inFlight--;
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.server?.closeAllConnections();
    this.server?.close();
  }
}
export function createPairingMiddleware(codex, options) {
  const agent = new PairingAgent(codex, options);
  return {
    agent,
    close: () => agent.close(),
    handler: async (req, res, next) => {
      if (req.url === "/progress-relay/v1")
        return agent.remoteHandler(req, res);
      const path = req.url?.split("?")[0];
      if (!path?.startsWith("/api/pairing/")) return next?.();
      const host = req.headers.host,
        origin = req.headers.origin;
      if (
        !/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host ?? "") ||
        req.headers["x-progress-client"] !== "pairing-v1" ||
        (origin && origin !== `http://${host}`) ||
        req.headers["sec-fetch-site"] === "cross-site" ||
        req.method !== "POST"
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const body = await json(req);
        let endpoint = `http://${host}/progress-relay/v1`;
        if (agent.server) {
          const address = body.address;
          const allowed =
            (agent.listenHost === "127.0.0.1" && address === "127.0.0.1") ||
            Object.values(networkInterfaces())
              .flat()
              .some(
                (n) =>
                  n &&
                  !n.internal &&
                  n.family === "IPv4" &&
                  n.address === address,
              );
          if (!allowed && path.endsWith("/share"))
            throw new AgentError("请选择本机可用的局域网地址。");
          if (allowed)
            endpoint = `http://${address}:${agent.server.address().port}/progress-relay/v1`;
        }
        const data = await agent.owner(
          path.slice("/api/pairing/".length),
          body,
          endpoint,
        );
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Agent 操作失败，请检查连接或重新生成配对码。",
          }),
        );
      }
    },
  };
}
