import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { builtins, demoWorkspace, emptyWorkspace } from '../src/core/components';
import { cardBundle, cardsBundle, defaultConfig, isStale, proportion, removeCard, type Metric } from '../src/core/model';
import { assertComponent, assertMetrics, assertWorkspace, configErrors, normalizeMetrics } from '../src/core/validation';
import { importFile, mergeWorkspace, packageComponent, packageWorkspace } from '../src/core/packages';
import { fetchMetrics } from '../src/core/runtime';

const bytes = (data: Uint8Array) => new Uint8Array(data).buffer;
describe('PDM semantics and validation', () => {
  it('preserves remaining semantics without inverting the displayed fraction', () => {
    const metric: Metric = { id: 'quota', name: '配额', kind: 'range', value: 37, max: 100, meaning: 'remaining' };
    expect(proportion(metric)).toBe(.37);
  });
  it('keeps over-range data while clamping only the graphical fraction', () => {
    const metric: Metric = { id: 'main', name: '超额', kind: 'range', value: 120, max: 100 };
    assertMetrics([metric]); expect(proportion(metric)).toBe(1); expect(metric.value).toBe(120);
  });
  it('supports single-target countdowns without inventing a percentage', () => {
    const metric: Metric = { id: 'main', name: '倒计时', kind: 'time_range', end: '2026-12-01T00:00:00Z' };
    assertMetrics([metric]); expect(proportion(metric)).toBeNull();
  });
  it('rejects invalid bounds, nonfinite values and reversed dates', () => {
    expect(() => normalizeMetrics({ kind: 'range', value: 1, max: 0 })).toThrow();
    expect(() => normalizeMetrics({ kind: 'gauge', value: Infinity })).toThrow();
    expect(() => normalizeMetrics({ kind: 'time_range', start: '2026-12-01', end: '2026-11-01' })).toThrow();
  });
  it('requires unique metric IDs and distinguishes stale observations', () => {
    const metric: Metric = { id: 'main', name: '温度', kind: 'gauge', value: 63, observed_at: '2026-10-06T00:00:00Z', stale_after: 30 };
    expect(() => assertMetrics([metric, metric])).toThrow();
    expect(isStale(metric, Date.parse(metric.observed_at!) + 31000)).toBe(true);
  });
  it('validates required dates, URL schemes and numeric form inputs', () => {
    expect(configErrors(builtins[0], { start: '', end: '' }).length).toBeGreaterThan(0);
    expect(configErrors(builtins[4], { endpoint: 'javascript:alert(1)' }).length).toBeGreaterThan(0);
    expect(configErrors(builtins[2], { ...defaultConfig(builtins[2].configSchema), value: NaN }).length).toBeGreaterThan(0);
  });
});
describe('workspace references and migration', () => {
  it('validates the example and empty workspaces', () => {
    expect(() => assertWorkspace(demoWorkspace())).not.toThrow();
    expect(() => assertWorkspace(emptyWorkspace())).not.toThrow();
  });
  it('removes an instance only when its final card is removed', () => {
    const workspace = demoWorkspace(); const original = workspace.cards[0];
    workspace.cards.push({ ...original, id: 'duplicate' });
    const first = removeCard(workspace, original.id);
    expect(first.instances.some(i => i.id === original.instanceId)).toBe(true);
    const second = removeCard(first, 'duplicate');
    expect(second.instances.some(i => i.id === original.instanceId)).toBe(false);
  });
  it('exports a single card with its component and instance', () => {
    const workspace = demoWorkspace(); const bundle = cardBundle(workspace, workspace.cards[1]);
    expect(bundle.cards).toHaveLength(1); expect(bundle.instances).toHaveLength(1); expect(bundle.components).toHaveLength(1);
    assertWorkspace(bundle);
  });
  it('exports selected cards in layout order and preserves shared instances once', () => {
    const workspace = demoWorkspace(); const transfer = workspace.cards[1];
    workspace.cards.push({ ...transfer, id: 'transfer-files', metricId: 'files' });
    const bundle = cardsBundle(workspace, ['transfer-files', transfer.id, transfer.id]);
    expect(bundle.cards.map(card => card.id)).toEqual([transfer.id, 'transfer-files']);
    expect(bundle.instances).toHaveLength(1); expect(bundle.components).toHaveLength(1);
    expect(bundle.cards.every(card => card.instanceId === bundle.instances[0].id)).toBe(true);
    bundle.instances[0].name = 'changed';
    expect(workspace.instances.find(instance => instance.id === transfer.instanceId)?.name).not.toBe('changed');
    assertWorkspace(bundle);
  });
  it('handles empty selections and rejects missing selected cards', () => {
    const workspace = demoWorkspace();
    const empty = cardsBundle(workspace, []);
    expect(empty.cards).toHaveLength(0); expect(empty.instances).toHaveLength(0); expect(empty.components).toHaveLength(0);
    expect(() => cardsBundle(workspace, ['missing'])).toThrow('不存在');
  });
  it('restores a selection package without unrelated cards or component definitions', async () => {
    const workspace = demoWorkspace(); const selected = [workspace.cards[1].id, workspace.cards[2].id];
    const bundle = cardsBundle(workspace, selected);
    const result = await importFile('selected.progresspack', bytes(await packageWorkspace(bundle)));
    expect(result.workspace?.cards.map(card => card.id)).toEqual(selected);
    expect(result.workspace?.instances).toHaveLength(2); expect(result.workspace?.components).toHaveLength(2);
    expect(result.workspace?.name).toBe(workspace.name); expect(result.workspace?.theme).toBe(workspace.theme);
    assertWorkspace(result.workspace);
  });
  it('renames conflicting instances once and preserves shared metric bindings', () => {
    const workspace = demoWorkspace(); workspace.cards.push({ ...workspace.cards[1], id: 'second-transfer', metricId: 'files' });
    const merged = mergeWorkspace(workspace, workspace, 'rename');
    expect(merged.cards).toHaveLength(14);
    const copies = merged.cards.slice(7).filter(c => c.metricId === 'transfer' || c.metricId === 'files');
    expect(new Set(copies.map(c => c.instanceId)).size).toBe(1);
    expect(copies[0].instanceId).not.toBe('demo-transfer'); assertWorkspace(merged);
  });
  it('skip does not modify existing configurations; overwrite updates them', () => {
    const current = demoWorkspace(), incoming = structuredClone(current);
    incoming.instances[2].config.value = 9;
    expect(mergeWorkspace(current, incoming, 'skip').instances[2].config.value).toBe(37);
    expect(mergeWorkspace(current, incoming, 'overwrite').instances.find(i => i.id === 'demo-quota')?.config.value).toBe(9);
  });
  it('supports choosing different conflict policies per object', () => {
    const current = demoWorkspace(), incoming = structuredClone(current);
    incoming.instances[2].config.value = 9;
    const decisions = Object.fromEntries([
      ...incoming.instances.map(i => [`instance:${i.id}`, i.id === 'demo-quota' ? 'overwrite' : 'skip']),
      ...incoming.cards.map(c => [`card:${c.id}`, 'skip']),
    ]) as Record<string, 'overwrite' | 'skip'>;
    const result = mergeWorkspace(current, incoming, decisions);
    expect(result.cards).toHaveLength(6); expect(result.instances).toHaveLength(6);
    expect(result.instances.find(i => i.id === 'demo-quota')?.config.value).toBe(9);
  });
  it('restores a portable workspace and revokes imported network consent', async () => {
    const workspace = emptyWorkspace(); const component = builtins[4];
    workspace.instances.push({ id: 'http', componentId: component.manifest.id, name: '服务', config: { endpoint: 'https://example.com/progress' }, networkConsent: true, createdAt: new Date().toISOString() });
    workspace.cards.push({ id: 'card', instanceId: 'http', metricId: 'main', renderer: 'bar', color: '#197b65' });
    const result = await importFile('backup.progresspack', bytes(await packageWorkspace(workspace)));
    expect(result.workspace?.instances[0].networkConsent).toBeUndefined();
    expect(result.workspace?.cards[0].metricId).toBe('main');
  });
  it('rejects missing references and duplicate IDs instead of silently rebinding cards', () => {
    const workspace = demoWorkspace(); workspace.cards[0].instanceId = 'missing';
    expect(() => assertWorkspace(workspace)).toThrow();
    const other = demoWorkspace(); other.cards.push(other.cards[0]); expect(() => assertWorkspace(other)).toThrow();
  });
});
describe('component packages and HTTP runtime', () => {
  it('imports the supplied rclone v0.1.3 archive, including its companion files', async () => {
    const fixture = await readFile(new URL('./fixtures/rclone-transfer-v0.1.3.progressmod', import.meta.url));
    const { component } = await importFile('rclone-transfer-v0.1.3.progressmod', bytes(fixture));
    expect(component?.manifest.id).toBe('dev.xigua.rclone-transfer');
    expect(component?.manifest.version).toBe('0.1.3');
    expect(component?.manifest.runtime).toEqual({ type: 'http', url: '{{endpoint}}', refresh_interval: 30 });
    expect(configErrors(component!, defaultConfig(component!.configSchema))).toEqual([]);
  });
  it('preserves standard schema titles and descriptions while importing generated forms', async () => {
    const component = structuredClone(builtins[4]);
    component.configSchema.title = 'rclone 配置'; component.configSchema.description = '连接 NAS 只读进度服务。';
    const imported = await importFile('rclone.progressmod', bytes(await packageComponent(component)));
    expect(imported.component?.configSchema).toEqual(component.configSchema);
    expect(configErrors(imported.component!, { endpoint: 'https://example.com/progress' })).toEqual([]);
  });
  it('imports the earlier rclone schema using its declared draft-2020-12 validator', async () => {
    const fixture = await readFile(new URL('./fixtures/rclone-transfer-fixed.progressmod', import.meta.url));
    const { component } = await importFile('rclone-transfer-fixed.progressmod', bytes(fixture));
    expect(component?.configSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(component?.configSchema.title).toBeTruthy();
    expect(configErrors(component!, { endpoint: 'https://example.com/progress' })).toEqual([]);
    expect(configErrors(component!, { endpoint: '' }).length).toBeGreaterThan(0);
    expect(configErrors(component!, { endpoint: 'https://example.com/progress', extra: true }).length).toBeGreaterThan(0);
    const unsupported = structuredClone(component!); (unsupported.configSchema as any).unevaluatedProperties = false;
    expect(() => assertComponent(unsupported)).toThrow('关键字：unevaluatedProperties');
  });
  it('names unsupported root and field constraints instead of silently ignoring them', () => {
    const root = structuredClone(builtins[4]); (root.configSchema as any).allOf = [];
    expect(() => assertComponent(root)).toThrow('关键字：allOf');
    const field = structuredClone(builtins[4]); (field.configSchema.properties.endpoint as any).pattern = '^https:';
    expect(() => assertComponent(field)).toThrow('配置字段“endpoint”包含尚不支持的 Schema 关键字：pattern');
    const title = structuredClone(builtins[4]); (title.configSchema as any).title = 42;
    expect(() => assertComponent(title)).toThrow('标题和说明必须是文字');
  });
  it('round-trips a multi-metric component package', async () => {
    const component = demoWorkspace().components.at(-1)!;
    const result = await importFile('transfer.progressmod', bytes(await packageComponent(component)));
    expect(result.component?.metrics).toHaveLength(2); expect(result.component?.manifest.id).toBe(component.manifest.id);
  });
  it('rejects executable runtimes and unsupported schema fields', () => {
    const component = structuredClone(builtins[0]); (component.manifest.runtime as any).type = 'executable';
    expect(() => assertComponent(component)).toThrow();
    const other = structuredClone(builtins[0]); (other.configSchema.properties.end as any).secret = true;
    expect(() => assertComponent(other)).toThrow();
  });
  it('rejects corrupt zip files and packages missing required files', async () => {
    await expect(importFile('bad.progressmod', new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow();
    const zip = new JSZip(); zip.file('README.md', 'hello');
    await expect(importFile('missing.progressmod', bytes(await zip.generateAsync({ type: 'uint8array' })))).rejects.toThrow('manifest.json');
  });
  it('fetches real HTTP JSON and attaches observation and stale timing', async () => {
    const server = createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ kind: 'range', value: 72, max: 100 })); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const address = server.address() as { port: number };
      const instance = { id: 'test', componentId: builtins[4].manifest.id, name: 'Test', config: { endpoint: `http://127.0.0.1:${address.port}` }, networkConsent: true, createdAt: new Date().toISOString() };
      const metrics = await fetchMetrics(builtins[4], instance);
      expect(metrics[0].value).toBe(72); expect(metrics[0].observed_at).toBeTruthy(); expect(metrics[0].stale_after).toBe(45);
      await expect(fetchMetrics(builtins[4], { ...instance, networkConsent: false })).rejects.toThrow('允许');
    } finally { server.close(); }
  });
  it('published schemas validate the built-in manifests and example metrics', async () => {
    const schemaAjv = new Ajv({ strict: false, validateFormats: false });
    const manifestSchema = JSON.parse(await readFile(new URL('../spec/module-v0.1.schema.json', import.meta.url), 'utf8'));
    const pdmSchema = JSON.parse(await readFile(new URL('../spec/pdm-v0.1.schema.json', import.meta.url), 'utf8'));
    const manifest = schemaAjv.compile(manifestSchema), metric = schemaAjv.compile(pdmSchema);
    expect(builtins.every(c => manifest(c.manifest))).toBe(true);
    expect(demoWorkspace().components.at(-1)!.metrics!.every(m => metric(m))).toBe(true);
    expect(metric({ id: 'main', name: 'bad', kind: 'range', value: 'invalid', max: 100 })).toBe(false);
  });
});
