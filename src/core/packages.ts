import JSZip from "jszip";
import {pruneCardGroups} from "./cardGroups";
import { migrateFolders } from "./folders";
import { builtins } from "./components";
import { CODEX_COMPONENT_ID } from "./codex";
import { clone, uid, type Component, type Workspace } from "./model";
import {
  assertComponent,
  assertWorkspace,
  normalizeMetrics,
} from "./validation";

const MAX_SIZE = 8_000_000;
async function readZip(bytes: ArrayBuffer): Promise<JSZip> {
  if (bytes.byteLength > MAX_SIZE)
    throw new Error("文件超过 8 MB，请使用较小的组件或工作区包。");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch {
    throw new Error("无法读取 ZIP 包。");
  }
  const files = Object.values(zip.files);
  if (
    files.length > 100 ||
    files.some(
      (f) =>
        f.name.startsWith("/") ||
        f.name.split("/").includes("..") ||
        (f as any).unsafeOriginalName?.split("/").includes(".."),
    )
  )
    throw new Error("组件包路径或文件数量无效。");
  // JSZip records the uncompressed size before allocation. This is a prototype limit, not a general sandbox.
  if (
    files.reduce(
      (sum, file) => sum + ((file as any)._data?.uncompressedSize ?? 0),
      0,
    ) > MAX_SIZE
  )
    throw new Error("解压后的文件超过 8 MB。");
  return zip;
}
async function readJson(zip: JSZip, name: string): Promise<unknown> {
  const file = zip.file(name);
  if (!file) throw new Error(`文件包缺少 ${name}。`);
  try {
    return JSON.parse(await file.async("string"));
  } catch {
    throw new Error(`${name} 不是有效 JSON。`);
  }
}
export async function readComponent(bytes: ArrayBuffer): Promise<Component> {
  const zip = await readZip(bytes);
  const manifest: any = await readJson(zip, "manifest.json");
  const category =
    manifest.runtime?.type === "time_range"
      ? "time"
      : ["manual", "quota"].includes(manifest.runtime?.type)
        ? "manual"
        : "services";
  const component = {
    manifest,
    configSchema: await readJson(zip, "config.schema.json"),
    category,
    icon: category === "time" ? "timer" : "activity",
    ...(manifest.runtime?.type === "static"
      ? { metrics: await readJson(zip, "data.json") }
      : {}),
  };
  assertComponent(component);
  return component;
}
export async function packageComponent(
  component: Component,
): Promise<Uint8Array> {
  assertComponent(component);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(component.manifest, null, 2));
  zip.file(
    "config.schema.json",
    JSON.stringify(component.configSchema, null, 2),
  );
  if (component.metrics)
    zip.file("data.json", JSON.stringify(component.metrics, null, 2));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
export async function packageWorkspace(
  workspace: Workspace,
): Promise<Uint8Array> {
  assertWorkspace(workspace);
  const zip = new JSZip();
  const exported = portableWorkspace(workspace);
  zip.file("workspace.json", JSON.stringify(exported, null, 2));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
export async function importFile(
  name: string,
  bytes: ArrayBuffer,
): Promise<{ component?: Component; workspace?: Workspace }> {
  if (bytes.byteLength > MAX_SIZE) throw new Error("文件超过 8 MB。");
  if (name.toLowerCase().endsWith(".progressmod"))
    return { component: await readComponent(bytes) };
  let workspace: unknown;
  if (name.toLowerCase().endsWith(".progresspack"))
    workspace = await readJson(await readZip(bytes), "workspace.json");
  else if (name.toLowerCase().endsWith(".progress")) {
    try {
      workspace = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("卡片文件不是有效 JSON。");
    }
  } else
    throw new Error("请选择 .progressmod、.progress 或 .progresspack 文件。");
  assertWorkspace(workspace);
  // Network authorization belongs to this device, never to imported data.
  workspace.instances.forEach((instance) => {
    delete instance.networkConsent;
    if (instance.componentId === CODEX_COMPONENT_ID)
      instance.config = { accountKey: "" };
  });
  workspace.components.forEach((component) => {
    delete component.builtin;
  });
  const safe = portableWorkspace(workspace);
  return { workspace: migrateFolders(safe) };
}
export type ConflictMode = "overwrite" | "rename" | "skip";
export function mergeWorkspace(
  current: Workspace,
  incoming: Workspace,
  choices: ConflictMode | Record<string, ConflictMode>,
): Workspace {
  assertWorkspace(current);
  assertWorkspace(incoming);
  const next = clone(current);
  const choiceFor = (type: "instance" | "card", id: string) =>
    typeof choices === "string"
      ? choices
      : (choices[`${type}:${id}`] ?? "rename");
  for (const component of incoming.components) {
    const installed = next.components.find(
      (c) => c.manifest.id === component.manifest.id,
    );
    if (!installed) next.components.push(clone(component));
    else if (
      JSON.stringify(installed.manifest) !==
        JSON.stringify(component.manifest) ||
      JSON.stringify(installed.configSchema) !==
        JSON.stringify(component.configSchema) ||
      JSON.stringify(installed.metrics) !== JSON.stringify(component.metrics)
    )
      throw new Error(
        `组件“${component.manifest.name}”与已安装版本不同。请先使用独立工作区恢复。`,
      );
  }
  const connectionIds = new Map<string, string>();
  next.connections ??= [];
  for (const connection of incoming.connections ?? []) {
    const copy = clone(connection);
    delete copy.credentialRef;
    delete copy.accountKey;
    copy.reconnect = true;
    if (next.connections.some((c) => c.id === copy.id)) copy.id = uid();
    connectionIds.set(connection.id, copy.id);
    next.connections.push(copy);
  }
  const folderIds = new Map<string, string>();
  if (incoming.folders) {
    next.folders ??= [];
    for (const folder of incoming.folders) {
      const existing = next.folders.find((f) => f.id === folder.id);
      const copy = clone(folder);
      if (existing && JSON.stringify(existing) !== JSON.stringify(folder))
        copy.id = uid();
      folderIds.set(folder.id, copy.id);
      if (!next.folders.some((f) => f.id === copy.id)) next.folders.push(copy);
    }
  }
  const instanceIds = new Map<string, string>();
  for (const instance of incoming.instances) {
    const mode = choiceFor("instance", instance.id);
    const existing = next.instances.find((i) => i.id === instance.id);
    if (existing && mode === "skip") {
      instanceIds.set(instance.id, existing.id);
      continue;
    }
    const copy = clone(instance);
    delete copy.networkConsent;
    if (copy.connectionIds)
      copy.connectionIds = copy.connectionIds.map(
        (id) => connectionIds.get(id) ?? id,
      );
    if (existing && mode === "rename") {
      copy.id = uid();
      const names = new Set(next.instances.map((i) => i.name));
      let suffix = 2;
      while (names.has(`${copy.name} (${suffix})`)) suffix++;
      copy.name = `${copy.name} (${suffix})`;
    } else if (existing)
      next.instances = next.instances.filter((i) => i.id !== instance.id);
    instanceIds.set(instance.id, copy.id);
    next.instances.push(copy);
  }
  const cardIds=new Map<string,string>();
  for (const card of incoming.cards) {
    const mode = choiceFor("card", card.id);
    const existing = next.cards.find((c) => c.id === card.id);
    if (existing && mode === "skip") {cardIds.set(card.id,existing.id);continue;}
    const copy = clone(card);
    if (copy.folderId)
      copy.folderId = folderIds.get(copy.folderId) ?? copy.folderId;
    copy.instanceId = instanceIds.get(card.instanceId)!;
    if (existing && mode === "rename") copy.id = uid();
    else if (existing) next.cards = next.cards.filter((c) => c.id !== card.id);
    cardIds.set(card.id,copy.id);
    next.cards.push(copy);
  }
  next.cardGroups=pruneCardGroups(next).cardGroups;
  for(const group of incoming.cardGroups??[]) {
    const mapped=group.cardIds.map(id=>cardIds.get(id)!);
    if(typeof choices==='string'&&choices==='overwrite')next.cardGroups=next.cardGroups?.filter(g=>g.id!==group.id);
    const members=mapped.filter(id=>!next.cardGroups?.some(g=>g.cardIds.includes(id)));
    if(members.length<2)continue;
    next.cardGroups??=[];
    next.cardGroups.push({...clone(group),id:next.cardGroups.some(g=>g.id===group.id)?uid():group.id,cardIds:members});
  }
  const result=pruneCardGroups(next);assertWorkspace(result);
  return result;
}

export function portableWorkspace(workspace: Workspace): Workspace {
  for (const instance of workspace.instances) {
    if (instance.componentId === CODEX_COMPONENT_ID) continue;
    for (const [key, value] of Object.entries(instance.config)) {
      let sensitive =
        /^(api[-_]?key|(?:access|refresh|bearer|session|id)[-_]?token|token|(?:client[-_]?)?secret|private[-_]?key|password|cookie|authorization|credential)$/i.test(
          key,
        ) &&
        typeof value === "string" &&
        !!value;
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        try {
          const url = new URL(value);
          sensitive ||=
            !!url.username ||
            !!url.password ||
            [...url.searchParams.keys()].some((k) =>
              /token|secret|password|key|auth|cookie/i.test(k),
            );
        } catch {
          /* Config validation reports malformed addresses. */
        }
      }
      if (sensitive)
        throw new Error(
          `“${instance.name}”的旧组件配置包含凭据。请先改用只读配额连接，凭据存入本机后再导出。`,
        );
    }
  }
  const copied = clone(workspace);
  copied.components.forEach((component) => {
    if (component.metrics)
      component.metrics = normalizeMetrics(component.metrics);
  });
  const exported: Workspace = {
    schema: copied.schema,
    name: copied.name,
    theme: copied.theme,
    components: copied.components,
    instances: copied.instances,
    cards: copied.cards,
    ...(copied.cardGroups?{cardGroups:copied.cardGroups.map(g=>({id:g.id,name:g.name,cardIds:g.cardIds,style:g.style,...(g.simple!==undefined?{simple:g.simple}:{}),...(g.layout?{layout:{variant:g.layout.variant,...(g.layout.position?{position:{column:g.layout.position.column,row:g.layout.position.row,columns:g.layout.position.columns}}:{}),...(g.layout.horizontalPosition?{horizontalPosition:{column:g.layout.horizontalPosition.column,row:g.layout.horizontalPosition.row,rows:g.layout.horizontalPosition.rows}}:{})}}:{})}))}:{}),
    ...(copied.folders
      ? {
          folders: copied.folders.map((f) => ({
            id: f.id,
            name: f.name,
            icon: f.icon,
            color: f.color,
          })),
        }
      : {}),
    ...(copied.connections ? { connections: copied.connections } : {}),
    ...(copied.autoFill !== undefined ? { autoFill: copied.autoFill } : {}),
    ...(copied.groupValues!==undefined?{groupValues:copied.groupValues}:{}),
    ...(copied.scrollDirection ? { scrollDirection: copied.scrollDirection } : {}),
  };
  exported.connections = exported.connections?.map((c) => ({
    id: c.id,
    providerId: c.providerId,
    method: c.method,
    kind: c.kind,
    label: c.label,
    priority: c.priority,
    reconnect: true,
    ...(c.sourceDevice ? { sourceDevice: c.sourceDevice } : {}),
    ...(c.sourceConnectionId
      ? { sourceConnectionId: c.sourceConnectionId }
      : {}),
  }));
  exported.instances = exported.instances.map((i) => {
    delete i.networkConsent;
    return i.componentId === CODEX_COMPONENT_ID
      ? {
          id: i.id,
          componentId: i.componentId,
          name: i.name,
          config: { accountKey: "" },
          createdAt: i.createdAt,
          ...(i.connectionIds
            ? {
                connectionIds: i.connectionIds,
                connectionStrategy: i.connectionStrategy,
              }
            : {}),
        }
      : {
          id: i.id,
          componentId: i.componentId,
          name: i.name,
          config: i.config,
          createdAt: i.createdAt,
          ...(i.demo ? { demo: true } : {}),
          ...(i.refreshInterval ? { refreshInterval: i.refreshInterval } : {}),
          ...(i.connectionIds
            ? {
                connectionIds: i.connectionIds,
                connectionStrategy: i.connectionStrategy,
              }
            : {}),
        };
  });
  const codexInstances = new Set(
    exported.instances
      .filter((i) => i.componentId === CODEX_COMPONENT_ID)
      .map((i) => i.id),
  );
  exported.cards = exported.cards.map((c) => ({
    id: c.id,
    instanceId: c.instanceId,
    ...(c.folderId ? { folderId: c.folderId } : {}),
    metricId: codexInstances.has(c.instanceId) ? "codex-usage" : c.metricId,
    renderer: c.renderer,
    color: c.color,
    ...(c.title ? { title: c.title } : {}),
    ...(c.quotaGroups ? { quotaGroups: c.quotaGroups } : {}),
    ...(c.display ? { display: c.display } : {}),
    ...(c.displayPreferences ? { displayPreferences: c.displayPreferences } : {}),
    ...(c.icon ? { icon: c.icon } : {}),
    ...(c.fillDirection ? { fillDirection: c.fillDirection } : {}),
    ...(c.ringCenter ? { ringCenter: c.ringCenter } : {}),
    ...(c.layout
      ? {
          layout: {
            variant: c.layout.variant,
            ...(c.layout.horizontalPosition ? {horizontalPosition:{column:c.layout.horizontalPosition.column,row:c.layout.horizontalPosition.row,rows:c.layout.horizontalPosition.rows}} : {}),
            ...(c.layout.position
              ? {
                  position: {
                    column: c.layout.position.column,
                    row: c.layout.position.row,
                    columns: c.layout.position.columns,
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
  exported.components = exported.components.map((c) =>
    c.manifest.id === CODEX_COMPONENT_ID
      ? clone(builtins.find((b) => b.manifest.id === CODEX_COMPONENT_ID)!)
      : c,
  );
  return exported;
}
