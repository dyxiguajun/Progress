import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { builtins, demoWorkspace, emptyWorkspace } from '../src/core/components';
import { refreshInterval, removeCards, restoreCards, type Instance, type Metric } from '../src/core/model';
import { sourceState, type Snapshot } from '../src/core/sourceState';
import { assertWorkspace, configErrors } from '../src/core/validation';
import { DataSourceError, fetchMetrics } from '../src/core/runtime';
import { importFile, packageWorkspace } from '../src/core/packages';
import { MetricView } from '../src/ui/MetricView';

const now = Date.parse('2026-10-06T12:00:00Z');
const instance: Instance = { id: 'service', componentId: builtins[4].manifest.id, name: '服务', config: { endpoint: 'https://example.com/progress' }, createdAt: new Date(now).toISOString(), networkConsent: true };
const metric: Metric = { id: 'main', name: '进度', kind: 'range', value: 37, max: 100, observed_at: new Date(now).toISOString(), stale_after: 30 };

describe('source states', () => {
  it('distinguishes initial loading, refreshing, and fresh data', () => {
    expect(sourceState(builtins[4], instance, { metrics: [], loading: true }, undefined, now)).toBe('loading');
    expect(sourceState(builtins[4], instance, { metrics: [metric], loading: true }, metric, now)).toBe('refreshing');
    expect(sourceState(builtins[4], instance, { metrics: [metric] }, metric, now)).toBe('fresh');
  });
  it('reports stale samples even when the last connection succeeded', () => {
    expect(sourceState(builtins[4], instance, { metrics: [metric], lastSuccess: now + 31000 }, metric, now + 31000)).toBe('stale');
  });
  it('distinguishes permission, offline, invalid data and failed refresh with retained values', () => {
    expect(sourceState(builtins[4], { ...instance, networkConsent: false }, undefined, undefined, now)).toBe('permission-required');
    expect(sourceState(builtins[4], instance, { metrics: [metric] }, metric, now, false)).toBe('offline');
    const failed: Snapshot = { metrics: [metric], lastSuccess: now, error: '连接失败', errorCode: 'connection' };
    expect(sourceState(builtins[4], instance, failed, metric, now)).toBe('error');
    expect(failed.metrics[0].value).toBe(37);
    expect(sourceState(builtins[4], instance, { metrics: [], error: 'bad', errorCode: 'invalid' }, undefined, now)).toBe('invalid');
  });
});

describe('workspace recovery and refresh configuration', () => {
  it('undoes deletion without replacing newer edits or newly added cards', () => {
    const before = demoWorkspace(); const card = before.cards[2];
    let current = removeCards(before, [card.id]);
    current.instances[0].name = '新的名称';
    current.cards.push({ ...current.cards[0], id: 'added-after-delete' });
    const restored = restoreCards(current, before, [card.id]);
    expect(restored.instances[0].name).toBe('新的名称');
    expect(restored.cards.some(item => item.id === 'added-after-delete')).toBe(true);
    expect(restored.cards[2].id).toBe(card.id);
    expect(restored.instances.some(item => item.id === card.instanceId)).toBe(true);
    assertWorkspace(restored);
  });
  it('removes only demo cards and keeps a real shared connection', () => {
    const before = demoWorkspace(); const real = { ...before.instances[2], id: 'real-quota', demo: false };
    before.instances.push(real); before.cards.push({ ...before.cards[2], id: 'real-card', instanceId: real.id });
    const current = removeCards(before, before.cards.filter(card => card.id !== 'real-card').map(card => card.id));
    expect(current.cards.map(card => card.id)).toEqual(['real-card']);
    expect(current.instances.map(item => item.id)).toEqual([real.id]);
    const restored = restoreCards(current, before, before.cards.slice(0, 6).map(card => card.id));
    expect(restored.cards).toHaveLength(7); assertWorkspace(restored);
  });
  it('validates and preserves a per-connection refresh interval through export', async () => {
    const workspace = emptyWorkspace();
    workspace.instances.push({ ...instance, refreshInterval: 60 });
    workspace.cards.push({ id: 'http-card', instanceId: instance.id, metricId: 'main', renderer: 'bar', color: '#197b65' });
    expect(refreshInterval(builtins[4], workspace.instances[0])).toBe(60);
    expect(refreshInterval(builtins[4], instance)).toBe(15);
    const imported = await importFile('interval.progresspack', new Uint8Array(await packageWorkspace(workspace)).buffer);
    expect(imported.workspace?.instances[0].refreshInterval).toBe(60);
    expect(imported.workspace?.instances[0].networkConsent).toBeUndefined();
    for (const value of [0, 4, 5.5, 86401, NaN]) { workspace.instances[0].refreshInterval = value; expect(() => assertWorkspace(workspace)).toThrow('刷新间隔'); }
  });
  it('returns localized form validation instead of schema engine wording', () => {
    const errors = configErrors(builtins[2], { value: -1, max: 100, unit: '本', meaning: 'completed' });
    expect(errors).toContain('当前值：不能小于 0');
  });
});

describe('data truthfulness', () => {
  it('shows an over-range percentage while clamping only the graphical bar', () => {
    const markup = renderToStaticMarkup(createElement(MetricView, { metric: { ...metric, value: 120 }, renderer: 'bar', color: '#197b65', now }));
    expect(markup).toContain('120'); expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('已超出范围');
  });
  it('classifies malformed HTTP payloads and derives stale timing from the configured interval', async () => {
    let valid = true;
    const server = createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(valid ? JSON.stringify({kind:'range',value:37,max:100}) : '{invalid'); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const service = { ...instance, config: { endpoint: `http://127.0.0.1:${(server.address() as {port:number}).port}` }, refreshInterval: 60 };
      expect((await fetchMetrics(builtins[4], service))[0].stale_after).toBe(180);
      valid = false;
      await expect(fetchMetrics(builtins[4], service)).rejects.toMatchObject({ code: 'invalid' });
      await expect(fetchMetrics(builtins[4], { ...service, networkConsent: false })).rejects.toBeInstanceOf(DataSourceError);
    } finally { server.close(); }
  });
});
