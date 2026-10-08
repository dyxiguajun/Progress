import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { adaptCodexUsage, cacheCodexUsage, cachedCodexUsage, readCodexUsage, windowLabel, CODEX_COMPONENT_ID } from '../src/core/codex';
import { builtins, emptyWorkspace, upgradeWorkspace, demoWorkspace } from '../src/core/components';
import { sourceState } from '../src/core/sourceState';
import { assertMetrics, assertWorkspace, assertComponent, configErrors } from '../src/core/validation';
import { importFile, packageWorkspace, portableWorkspace } from '../src/core/packages';
import { commitPlacements, resolvePlacements } from '../src/core/grid';
import { QuotaView, resetText } from '../src/ui/QuotaView';
import { ProgressCard } from '../src/ui/ProgressCard';
const key = 'a'.repeat(64), other = 'b'.repeat(64), observedAt = '2026-10-07T19:00:00Z';
const w = (usedPercent: unknown = 25, windowDurationMins: unknown = 300, resetsAt: unknown = 1791400000) => ({ usedPercent, windowDurationMins, resetsAt });
const bucket = (primary: unknown = w(), secondary: unknown = w(42, 10080)) => ({ limitId: 'codex', primary, secondary });
const payload = (limits: unknown = { rateLimitsByLimitId: { codex: bucket() } }) => ({ account: { key, maskedEmail: 'x***@e***.com', plan: 'plus' }, observedAt, version: '0.160.1', limits });
const component = builtins.find(c => c.manifest.id === CODEX_COMPONENT_ID)!;
function workspace() {
  const next = emptyWorkspace();
  next.instances = [{ id: 'account', componentId: CODEX_COMPONENT_ID, name: 'Codex Usage', config: { accountKey: key }, createdAt: observedAt }];
  next.cards = [{ id: 'quota', instanceId: 'account', metricId: 'codex-usage', renderer: 'quota', color: '#197b65', quotaGroups: ['codex'], layout: { variant: 'wide' } }];
  return next;
}
describe('Codex protocol adapter', () => {
  it('maps actual used percentages into independent remaining metrics', () => {
    const usage = adaptCodexUsage(payload());
    expect(usage.groups[0].windows.map(w => [w.label, w.remainingPercent])).toEqual([['5 小时', 75], ['每周', 58]]);
    expect(usage.metrics).toHaveLength(2); assertMetrics(usage.metrics);
  });
  it.each([[null, w(), 1], [w(), null, 1], [null, null, 0]])('does not invent absent primary/secondary windows', (primary, secondary, count) => {
    expect(adaptCodexUsage(payload({ rateLimits: bucket(primary, secondary) })).groups[0].windows).toHaveLength(count);
  });
  it('prefers multi-bucket data over legacy and preserves unknown buckets', () => {
    const usage = adaptCodexUsage(payload({ rateLimits: bucket(w(99)), rateLimitsByLimitId: { codex: bucket(w(10), null), unknown_quota: { ...bucket(w(33, 47), null), limitName: 'Shared pool' } } }));
    expect(usage.groups.map(g => g.id)).toEqual(['codex', 'unknown_quota']);
    expect(usage.groups[1].name).toBe('Shared pool'); expect(usage.groups[1].windows[0].label).toBe('47 分钟');
    expect(usage.groups[0].windows[0].remainingPercent).toBe(90);
  });
  it('supports more than two windows with stable IDs', () => {
    const usage = adaptCodexUsage(payload({ rateLimits: { windows: [{ ...w(), id: 'short' }, { ...w(42, 1440), id: 'daily' }, { ...w(15, 10080), id: 'week' }] } }));
    expect(new Set(usage.metrics.map(m => m.id)).size).toBe(3);
  });
  it.each([undefined, null, -1, 101, NaN, '25'])('keeps missing or bad percentages unavailable: %s', used => {
    const window = adaptCodexUsage(payload({ rateLimits: bucket(w(used), null) })).groups[0].windows[0];
    // undefined here uses the fixture default; explicitly delete to test absence.
    if (used === undefined) { const raw = payload(); delete (raw.limits as any).rateLimitsByLimitId.codex.primary.usedPercent; expect(adaptCodexUsage(raw).groups[0].windows[0].remainingPercent).toBeNull(); }
    else expect(window.remainingPercent).toBeNull();
  });
  it('keeps unknown durations and resets absent without assigning five hours', () => {
    const window = adaptCodexUsage(payload({ rateLimits: bucket(w(0, null, null), null) })).groups[0].windows[0];
    expect(window.label).toBe('配额窗口'); expect(window.resetsAt).toBeNull(); expect(window.remainingPercent).toBe(100);
    expect(windowLabel(1440)).toBe('1 天');
  });
  it('shows relative short resets and never assumes quota recovers after reset time', () => {
    const window = adaptCodexUsage(payload()).groups[0].windows[0];
    expect(resetText(window, window.resetsAt! * 1000 - 137 * 60000)).toBe('2 小时 17 分钟后重置');
    expect(resetText(window, window.resetsAt! * 1000 + 1)).toBe('等待更新重置时间');
    expect(window.remainingPercent).toBe(75);
  });
  it('keeps the upstream limitId separate from the stable map selection key', () => {
    const usage = adaptCodexUsage(payload({ rateLimitsByLimitId: { shared: { ...bucket(), limitId: 'upstream-id' } } }));
    expect(usage.groups[0].id).toBe('shared'); expect(usage.groups[0].limitId).toBe('upstream-id');
  });
  it('rejects unsupported payloads and empty maps rather than falling back silently', () => {
    expect(() => adaptCodexUsage({})).toThrow();
    expect(() => adaptCodexUsage(payload({ rateLimitsByLimitId: {}, rateLimits: bucket() }))).toThrow();
    expect(() => adaptCodexUsage(payload({ rateLimits: { windows: [w(), { ...w(), id: '0' }] } }))).toThrow();
  });
  it('only exposes real credits and never coerces null to zero', () => {
    const usage = adaptCodexUsage(payload({ rateLimits: { ...bucket(), credits: { balance: null, hasCredits: false, unlimited: false, token: 'secret' } } }));
    expect(usage.groups[0].credits?.balance).toBeNull(); expect(JSON.stringify(usage)).not.toContain('secret');
  });
});
describe('Codex cards, lifecycle and portability', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  it('shows one window at compact size and keeps the other available in details', () => {
    const html = renderToStaticMarkup(createElement(QuotaView, { usage: adaptCodexUsage(payload()), color: '#197b65', density: 'compact' }));
    expect(html).toContain('5 小时'); expect(html).toContain('75'); expect(html).toContain('另 1 个窗口'); expect(html).not.toContain('每周'); expect(html).not.toContain('ring');
    const details = renderToStaticMarkup(createElement(QuotaView, { usage: adaptCodexUsage(payload()), color: '#197b65', details: true }));
    expect(details).toContain('每周'); expect(details).toContain('58');
  });
  it('large and expanded variants reveal real reset times and credits', () => {
    const usage = adaptCodexUsage(payload({ rateLimits: { ...bucket(), credits: { balance: '31.4', hasCredits: true, unlimited: false } } }));
    const html = renderToStaticMarkup(createElement(QuotaView, { usage, color: '#197b65', density: 'large' }));
    expect(html).toContain('重置'); expect(html).toContain('31.4');
  });
  it('retains values and timestamp during errors, auth expiry and stale states', () => {
    const next = workspace(), usage = adaptCodexUsage(payload());
    const snapshot = { metrics: usage.metrics, quota: usage, lastSuccess: Date.parse(observedAt) };
    expect(sourceState(component, next.instances[0], snapshot, undefined, Date.parse(observedAt)+901000)).toBe('stale');
    expect(sourceState(component, next.instances[0], { ...snapshot, error: 'expired', errorCode: 'auth' }, undefined, Date.parse(observedAt))).toBe('auth-required');
    const html = renderToStaticMarkup(createElement(ProgressCard, { card: next.cards[0], component, instance: next.instances[0], snapshot: { ...snapshot, error: 'lost', errorCode: 'unavailable' }, now: Date.parse(observedAt), online: true, onEdit: () => {}, onDetails: () => {}, onRetry: () => {} }));
    expect(html).toContain('75'); expect(html).toContain('本机连接不可用'); expect(html).toContain('的数据');
  });
  it('saves safe last-known samples and recovers them on restart', () => {
    const values = new Map(); vi.stubGlobal('localStorage', { setItem: (k: string,v: string) => values.set(k,v), getItem: (k: string) => values.get(k) });
    const usage = adaptCodexUsage(payload()); cacheCodexUsage(usage);
    expect(cachedCodexUsage(key)).toEqual(usage); expect(cachedCodexUsage(other)).toBeUndefined();
  });
  it('rejects account mismatch on live reads', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload()), { headers: { 'Content-Type': 'application/json' } })));
    await expect(readCodexUsage(other)).rejects.toMatchObject({ code: 'account-mismatch' });
  });
  it('keeps one instance and one composite card through grid and file round trips', async () => {
    const next = workspace(); assertWorkspace(next);
    const moved = commitPlacements(next, resolvePlacements(next, 4), 4);
    expect(moved.instances).toEqual(next.instances); expect(moved.cards[0].quotaGroups).toEqual(['codex']);
    const data = await packageWorkspace(moved), restored = (await importFile('quota.progresspack', new Uint8Array(data).buffer)).workspace!;
    expect(restored.cards).toHaveLength(1); expect(restored.instances).toHaveLength(1); expect(restored.instances[0].config).toEqual({ accountKey: '' });
    expect(portableWorkspace(next).instances[0].config).toEqual({ accountKey: '' }); expect(next.instances[0].config.accountKey).toBe(key);
  });
  it('rejects secret configuration and arbitrary executable Codex runtimes', () => {
    expect(configErrors(component, { accountKey: key, accessToken: 'secret' }).length).toBeGreaterThan(0);
    const bad = structuredClone(component); bad.manifest.id = 'unknown.codex'; expect(() => assertComponent(bad)).toThrow();
    const next = workspace(); next.cards[0].renderer = 'ring'; expect(() => assertWorkspace(next)).toThrow();
  });
  it('exports only whitelisted Codex metadata, without caches or credentials', () => {
    const next = workspace();
    Object.assign(next.cards[0], { accessToken: 'secret-card', snapshot: { accessToken: 'secret-cache' } });
    Object.assign(next.instances[0], { cookie: 'secret-cookie' });
    Object.assign(next.components.find(c => c.manifest.id === CODEX_COMPONENT_ID)!.manifest, { credential: 'secret-component' });
    const exported = JSON.stringify(portableWorkspace(next));
    expect(exported).not.toContain('secret-'); expect(exported).not.toContain(key);
  });
  it('upgrades old workspaces and renames only the legacy quota demo', () => {
    const old = demoWorkspace(); old.components = old.components.filter(c => c.manifest.id !== CODEX_COMPONENT_ID);
    old.instances.find(i => i.id === 'demo-quota')!.name = 'AI 工具额度';
    const upgraded = upgradeWorkspace(old); assertWorkspace(upgraded);
    expect(upgraded.components.some(c => c.manifest.id === CODEX_COMPONENT_ID)).toBe(true);
    expect(upgraded.instances.find(i => i.id === 'demo-quota')!.name).toBe('手动配额'); expect(upgraded.cards).toEqual(old.cards);
  });
});
