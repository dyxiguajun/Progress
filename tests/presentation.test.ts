import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoWorkspace } from '../src/core/components';
import { type Metric } from '../src/core/model';
import { formatQuantity, metricLabel, percentageText } from '../src/core/presentation';
import { sourceState } from '../src/core/sourceState';
import { searchCards } from '../src/core/search';
import { assertWorkspace } from '../src/core/validation';
import { importFile, packageWorkspace } from '../src/core/packages';
import { MetricView } from '../src/ui/MetricView';
import { ProgressCard } from '../src/ui/ProgressCard';

const now = Date.parse('2026-10-07T12:00:00Z');
const metric: Metric = { id: 'transfer', name: '传输', kind: 'range', value: 2915, max: 15979, unit: 'files', meaning: 'completed', status: 'running', observed_at: '2026-10-01T12:00:00Z', stale_after: 30 };
describe('metric semantics and content presentation', () => {
  it('separates completed quantity from lifecycle even at the numerical bound', () => {
    expect(metricLabel(metric)).toBe('进行中');
    expect(metricLabel({ ...metric, status: undefined })).toBe('完成量');
    expect(metricLabel({ ...metric, value: 15979 })).toBe('进行中');
    for (const [status, label] of [['completed', '已完成'], ['failed', '失败'], ['stopped', '已停止']]) expect(metricLabel({ ...metric, status })).toBe(label);
    expect(percentageText(2915 / 15979)).toBe('18');
    expect(percentageText(15978 / 15979)).toBe('99.9');
    expect(percentageText(1)).toBe('100');
  });
  it('formats byte aliases and rates centrally without changing source numbers', () => {
    for (const unit of ['By', 'B', 'bytes']) expect(formatQuantity(135612909168, unit)).toEqual({ value: '126.3', unit: 'GiB' });
    expect(formatQuantity(1815085, 'By/s')).toEqual({ value: '1.73', unit: 'MiB/s' });
    expect(formatQuantity(15979, 'files')).toEqual({ value: '15,979', unit: '文件' });
  });
  it('retains a failed partial range and hides optional information only on the card', () => {
    const html = renderToStaticMarkup(createElement(MetricView, { metric: { ...metric, status: 'failed', value: 51, max: 100 }, renderer: 'bar', color: '#197b65', now, display: { status: false, details: false, secondary: false } }));
    expect(html).toContain('51'); expect(html).toContain('aria-valuenow="51"');
    expect(html).not.toContain('metric-label'); expect(html).not.toContain('metric-details');
  });
  it('does not stale terminal tasks, while connection failures remain independent', () => {
    const w = demoWorkspace(), component = w.components.find(c => c.manifest.runtime.type === 'http')!, instance = { ...w.instances[0], componentId: component.manifest.id, config: { endpoint: 'https://example.com' }, networkConsent: true };
    for (const status of ['completed', 'failed', 'stopped']) {
      const m = { ...metric, status }, snapshot = { metrics: [m] };
      expect(sourceState(component, instance, snapshot, m, now, true)).toBe('fresh');
      expect(sourceState(component, instance, snapshot, m, now, false)).toBe('offline');
    }
    expect(sourceState(component, instance, { metrics: [metric] }, metric, now, true)).toBe('stale');
  });
  it('keeps background refresh markup stable and completion records out of cards', () => {
    const w = demoWorkspace(), card = w.cards.find(c => c.metricId === 'transfer')!, instance = w.instances.find(i => i.id === card.instanceId)!, component = w.components.find(c => c.manifest.id === instance.componentId)!;
    const props = { card, instance, component, now, online: true, onEdit() {}, onDetails() {}, onRetry() {} }, metrics = [{ ...metric, status: 'completed' }];
    const html = renderToStaticMarkup(createElement(ProgressCard, { ...props, snapshot: { metrics } }));
    expect(renderToStaticMarkup(createElement(ProgressCard, { ...props, snapshot: { metrics, loading: true } }))).toBe(html);
    expect(html).not.toContain('task-record'); expect(html).toContain('查看详情'); expect(html).toContain('已完成');
  });
  it('preserves display switches through portable export and rejects invalid switches', async () => {
    const w = demoWorkspace(); w.cards[0].display = { title: false, status: false, details: true, secondary: false };
    const restored = await importFile('display.progresspack', new Uint8Array(await packageWorkspace(w)).buffer);
    expect(restored.workspace!.cards[0].display).toEqual(w.cards[0].display);
    (w.cards[0].display as any).title = 'false'; expect(() => assertWorkspace(w)).toThrow('显示开关');
  });
  it('searches across folders and display metadata without indexing credentials', () => {
    const w = demoWorkspace(), card = w.cards[0], instance = w.instances.find(i => i.id === card.instanceId)!;
    w.folders!.push({ id: 'nas', name: '家庭 NAS', icon: 'folder', color: '#197b65' }); card.folderId = 'nas';
    instance.config.secret = 'search-secret';
    const result = searchCards(w, { [instance.id]: { metrics: [], sourceDevice: '测试设备' } }, 'NAS 测试设备');
    expect(result.map(r => r.id)).toEqual([card.id]); expect(result[0].folderId).toBe('nas');
    expect(searchCards(w, {}, 'search-secret')).toEqual([]);
  });
});
