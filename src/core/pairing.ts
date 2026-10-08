import { type Connection } from "./model";
import { vaultGet, vaultPut, vaultEnsure } from "./vault";
import { requestJson } from "./providers";
export type PairingCode = {
  schema: "progress/pairing/v1";
  token: string;
  expiresAt: number;
  sourceDevice: string;
  sourceDeviceId: string;
  connectionId: string;
  cardId: string;
  endpoint: string;
  publicKey: string;
};
export const bytes64 = (value: ArrayBuffer | Uint8Array) =>
  btoa(
    String.fromCharCode(
      ...(value instanceof Uint8Array ? value : new Uint8Array(value)),
    ),
  );
export const from64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export function parsePairingCode(text: string): PairingCode {
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("这不是 Progress 配对码。");
  }
  const keys = [
    "schema",
    "token",
    "expiresAt",
    "sourceDevice",
    "sourceDeviceId",
    "connectionId",
    "cardId",
    "endpoint",
    "publicKey",
  ];
  if (
    value?.schema !== "progress/pairing/v1" ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys
      .filter((k) => k !== "expiresAt")
      .some((k) => typeof value[k] !== "string" || value[k].length > 2048) ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    value.expiresAt > Date.now() + 180000 ||
    !/^[a-f0-9]{64}$/.test(value.token)
  )
    throw new Error("配对码已过期或格式不兼容，请在来源设备重新生成。");
  const url = new URL(value.endpoint);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/progress-relay/v1"
  )
    throw new Error("配对地址无效。");
  return value;
}
export async function ownerRequest(action: string, body: unknown = {}) {
  return requestJson(`/api/pairing/${action}`, {
    headers: { "X-Progress-Client": "pairing-v1" },
    body,
  });
}
let identityPromise:
  Promise<{ id: string; privateKey: CryptoKey; publicKey: string }> | undefined;
function identity() {
  return (identityPromise ??= createIdentity());
}
async function createIdentity() {
  let saved = await vaultGet<{
    id: string;
    privateKey: CryptoKey;
    publicKey: string;
  }>("device-identity");
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  saved = {
    id: crypto.randomUUID(),
    privateKey: pair.privateKey,
    publicKey: bytes64(await crypto.subtle.exportKey("spki", pair.publicKey)),
  };
  return vaultEnsure("device-identity", saved);
}
async function encryptedRequest(
  endpoint: string,
  publicKey: string,
  payload: unknown,
  signal?: AbortSignal,
) {
  const peer = await crypto.subtle.importKey(
    "spki",
    from64(publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "ECDH", public: peer },
    pair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const keyText = bytes64(
      await crypto.subtle.exportKey("spki", pair.publicKey),
    ),
    timestamp = Date.now(),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`${keyText}:${timestamp}`),
    },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const response = await requestJson(endpoint, {
    body: { key: keyText, timestamp, iv: bytes64(iv), cipher: bytes64(cipher) },
    signal,
  });
  const decrypted = JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: from64(response.iv),
          additionalData: new TextEncoder().encode("response"),
        },
        key,
        from64(response.cipher),
      ),
    ),
  );
  if (decrypted.error) throw new Error(decrypted.error);
  return decrypted;
}
async function signedRequest(
  endpoint: string,
  publicKey: string,
  action: string,
  fields: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const device = await identity();
  const payload = {
    action,
    ...fields,
    deviceId: device.id,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  };
  const signature = bytes64(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      device.privateKey,
      new TextEncoder().encode(JSON.stringify(payload)),
    ),
  );
  return encryptedRequest(
    endpoint,
    publicKey,
    { ...payload, signature },
    signal,
  );
}
export async function claimPairing(code: PairingCode, label: string) {
  const device = await identity();
  return signedRequest(code.endpoint, code.publicKey, "claim", {
    token: code.token,
    label,
    publicKey: device.publicKey,
  });
}
export async function pollPairing(code: PairingCode, requestId: string) {
  return signedRequest(code.endpoint, code.publicKey, "poll", { requestId });
}
export async function finishPairing(code: PairingCode, requestId: string) {
  return signedRequest(code.endpoint, code.publicKey, "finish", { requestId });
}
export async function saveRelayBinding(
  code: PairingCode,
  approved: any,
): Promise<Connection> {
  const device = await identity();
  const credentialRef = crypto.randomUUID();
  await vaultPut(credentialRef, {
    endpoint: code.endpoint,
    publicKey: code.publicKey,
  });
  return {
    id: crypto.randomUUID(),
    providerId: approved.providerId,
    method: "pairing",
    kind: "relay",
    label: code.sourceDevice,
    sourceDevice: code.sourceDevice,
    sourceConnectionId: code.connectionId,
    deviceId: device.id,
    credentialRef,
    priority: 10,
    ...(approved.providerId === "codex" &&
    /^[a-f0-9]{64}$/.test(approved.accountKey ?? "")
      ? { accountKey: approved.accountKey }
      : {}),
  };
}
export async function relayRequest(
  connection: Connection,
  action: string,
  fields: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const saved = await vaultGet<{ endpoint: string; publicKey: string }>(
    connection.credentialRef ?? "",
  );
  if (!saved) throw new Error("此设备需要重新扫描配对码。");
  return signedRequest(
    saved.endpoint,
    saved.publicKey,
    action,
    { ...fields, connectionId: connection.sourceConnectionId },
    signal,
  );
}
