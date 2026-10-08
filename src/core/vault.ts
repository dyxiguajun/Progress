// Device-local secrets and non-extractable keys never enter Workspace or export bundles.
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("progress-device-vault", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开设备凭据存储。"));
  }));
}
export async function vaultGet<T>(id: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("records")
      .objectStore("records")
      .get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法读取设备凭据。"));
  });
}
export async function vaultPut(id: string, value: unknown) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("records", "readwrite");
    tx.objectStore("records").put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("无法保存设备凭据。"));
  });
}
export async function vaultDelete(id: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("records", "readwrite");
    tx.objectStore("records").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("无法删除设备凭据。"));
  });
}

// Read and write in one transaction so a delayed packet cannot replace a newer sample.
export async function vaultUpdate<T>(
  id: string,
  update: (previous: T | undefined) => T,
) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("records", "readwrite");
    const records = tx.objectStore("records");
    const request = records.get(id);
    request.onsuccess = () => records.put(update(request.result), id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("无法保存设备数据。"));
    tx.onabort = () => reject(new Error("设备数据保存已取消。"));
  });
}
let keyPromise: Promise<CryptoKey> | undefined;
export async function vaultEnsure<T>(id: string, candidate: T): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("records", "readwrite"),
      records = tx.objectStore("records");
    let result: T;
    const request = records.get(id);
    request.onsuccess = () => {
      result = request.result ?? candidate;
      if (request.result === undefined) records.put(candidate, id);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(new Error("无法初始化设备凭据。"));
  });
}
function encryptionKey() {
  return (keyPromise ??= (async () => {
    const saved = await vaultGet<CryptoKey>("encryption-key");
    if (saved) return saved;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return vaultEnsure("encryption-key", key);
  })());
}
export async function saveCredential(secret: string) {
  const id = crypto.randomUUID(),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(secret),
  );
  await vaultPut(id, { iv, cipher });
  return id;
}
export async function readCredential(id?: string) {
  if (!id) return "";
  const record = await vaultGet<{ iv: Uint8Array; cipher: ArrayBuffer }>(id);
  if (!record) throw new Error("本机凭据已丢失，请重新连接。");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv as Uint8Array<ArrayBuffer> },
      await encryptionKey(),
      record.cipher,
    ),
  );
}
