import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { builtins, demoWorkspace, emptyWorkspace } from '../src/core/components';
import { clone, removeCard, type Component } from '../src/core/model';
import { commitPlacements, fillHoles, fittingVariant, intersects, layoutsFor, officialLayouts, reflow, resolveGrid, resolvePlacements, type Placement } from '../src/core/grid';
import { assertComponent, assertWorkspace } from '../src/core/validation';
import { cardBundle } from '../src/core/model';
import { importFile, packageComponent, packageWorkspace, mergeWorkspace } from '../src/core/packages';
import { ProgressCard } from '../src/ui/ProgressCard';
import { movementIntent, retainValidPlacement } from '../src/core/gestures';

function expectValid(slots: Placement[], columns: number) {
  for (const slot of slots) {
    expect(Number.isInteger(slot.column) && Number.isInteger(slot.row)).toBe(true);
    expect(slot.column).toBeGreaterThanOrEqual(0); expect(slot.row).toBeGreaterThanOrEqual(0);
    expect(slot.column + slot.span.columns).toBeLessThanOrEqual(columns);
    for (const other of slots) if (other !== slot) expect(intersects(slot, other)).toBe(false);
  }
}
const wide = officialLayouts.variants[1], large = officialLayouts.variants[2];

describe('touch and pointer intent', () => {
  it('keeps an immediate touch swipe as scrolling but picks up a held card', () => {
    expect(movementIntent('touch', 80, 20, false, true)).toBe('scroll');
    expect(movementIntent('touch', 220, 20, false, true)).toBe('scroll');
    expect(movementIntent('touch', 500, 20, false, true)).toBe('drag');
    expect(movementIntent('touch', 600, 2, false, true)).toBe('wait');
  });
  it('requires a short edit hold for either pointer and a long normal hold', () => {
    expect(movementIntent('touch', 10, 20, true, true)).toBe('scroll');
    expect(movementIntent('mouse', 10, 20, false, true)).toBe('scroll');
    expect(movementIntent('mouse', 200, 20, true, true)).toBe('drag');
    expect(movementIntent('touch', 200, 20, true, true)).toBe('drag');
    expect(movementIntent('touch', 300, 20, true, false)).toBe('scroll');
  });
  it('retains the most recent valid reflow after an outside or colliding-boundary candidate', () => {
    const original = resolvePlacements(demoWorkspace(), 6), id = original[0].id;
    const initial = { slots:original, ghost:original[0] };
    const moved = retainValidPlacement(initial, original, id, {column:2,row:3}, wide, 6);
    expect(moved.ghost).toMatchObject({column:2,row:3}); expectValid(moved.slots, 6);
    expect(retainValidPlacement(moved, original, id, null, wide, 6)).toBe(moved);
    expect(retainValidPlacement(moved, original, id, {column:5,row:3}, wide, 6)).toBe(moved);
    const committed = commitPlacements(demoWorkspace(), moved.slots, 6);
    expect(resolvePlacements(committed, 6)[0]).toMatchObject({column:2,row:3});
  });
});

describe('responsive integer grid', () => {
  it('resolves capacity from the measured canvas across five window sizes', () => {
    expect([288, 358, 574, 798, 1358].map(width => resolveGrid(width).columns)).toEqual([1, 2, 3, 4, 7]);
    expect(resolveGrid(3000).columns).toBe(12); expect(resolveGrid(0).columns).toBe(1);
  });
  it('places legacy cards first-fit without fractional spans or overlaps', () => {
    const workspace = demoWorkspace(), slots = resolvePlacements(workspace, 4);
    expect(slots.map(p => [p.column, p.row])).toEqual([[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]]);
    expectValid(slots, 4); expect(workspace.cards.every(c => c.layout === undefined)).toBe(true);
  });
  it('reserves existing hints before placing a new card into the first available region', () => {
    const workspace = demoWorkspace();
    workspace.cards[0].layout = { variant: 'large', position: { column: 0, row: 0, columns: 4 } };
    workspace.cards[1].layout = { variant: 'wide', position: { column: 2, row: 0, columns: 4 } };
    const slots = resolvePlacements(workspace, 4);
    expect(slots[2]).toMatchObject({ column: 2, row: 1 }); expectValid(slots, 4);
  });
  it('uses declared fallback chains without overwriting a preferred size', () => {
    expect(fittingVariant(builtins[0], 'expanded', 3)?.id).toBe('large');
    expect(fittingVariant(builtins[0], 'expanded', 1)?.id).toBe('compact');
    const component: Component = clone(builtins[0]); component.manifest.cardLayouts = { default: 'only', variants: [{ id: 'only', span: { columns: 3, rows: 2 } }] };
    expect(fittingVariant(component, 'only', 2)).toBeNull();
  });
  it('rejects unsupported variants, fractional sizes and invalid fallback cycles', () => {
    const workspace = demoWorkspace(); workspace.cards[0].layout = { variant: 'not-supported' };
    expect(() => assertWorkspace(workspace)).toThrow('不支持所选卡片尺寸');
    const component = clone(builtins[0]); component.manifest.cardLayouts = clone(officialLayouts);
    component.manifest.cardLayouts.variants[0].span.columns = 1.5;
    expect(() => assertComponent(component)).toThrow('整数格数');
    component.manifest.cardLayouts = clone(officialLayouts); component.manifest.cardLayouts.variants[0].fallback = 'expanded';
    expect(() => assertComponent(component)).toThrow('回退链');
  });
});

describe('stable reflow', () => {
  it('moves only directly conflicting cards, preserving every unrelated position', () => {
    const slots = resolvePlacements(demoWorkspace(), 6);
    const next = reflow(slots, slots[0].id, { column: 0, row: 0 }, large, 6)!;
    expectValid(next, 6);
    for (const slot of slots) if (slot.id !== slots[0].id && !intersects(slot, next[0])) expect(next.find(p => p.id === slot.id)).toEqual(slot);
    expect(next.find(p => p.id === slots[3].id)).not.toEqual(slots[3]);
  });
  it('previews invalid drops as invalid without modifying settled cards', () => {
    const slots = resolvePlacements(demoWorkspace(), 4), before = clone(slots);
    for (const position of [{ column: -1, row: 0 }, { column: 3, row: 0 }, { column: 0.5, row: 1 }, { column: 0, row: -1 }]) expect(reflow(slots, slots[0].id, position, wide, 4)).toBeNull();
    expect(reflow(slots, slots[0].id, { column: 0, row: 0 }, { ...wide, span: { columns: 1.5, rows: 1 } }, 4)).toBeNull();
    expect(slots).toEqual(before);
  });
  it('keeps deterministic non-overlapping placements through repeated mixed moves and resizes', () => {
    let slots = resolvePlacements(demoWorkspace(), 6);
    for (let index = 0; index < 60; index++) {
      const variant = index % 3 ? wide : large, id = slots[index % slots.length].id;
      const position = { column: (index * 3) % (7 - variant.span.columns), row: index % 5 };
      const next = reflow(slots, id, position, variant, 6)!;
      expect(next).toEqual(reflow(slots, id, position, variant, 6)); expectValid(next, 6); slots = next;
    }
  });
});

describe('layout lifecycle', () => {
  it('supports all sixteen standard rectangles and preserves extremes through export and reflow', async () => {
    expect(new Set(officialLayouts.variants.map(v => `${v.span.columns}x${v.span.rows}`)).size).toBe(16);
    for (const variant of officialLayouts.variants) {
      const w = demoWorkspace(); w.cards[0].layout = { variant:variant.id };
      const slots = resolvePlacements(w, 6); expectValid(slots, 6); expect(slots[0].span).toEqual(variant.span);
      const resized = reflow(slots, w.cards[1].id, {column:0,row:0}, variant, 6)!; expectValid(resized, 6);
      expectValid(fillHoles(resized, 6, w.cards[1].id), 6);
      const restored = (await importFile('matrix.progresspack', new Uint8Array(await packageWorkspace(commitPlacements(w, slots, 6))).buffer)).workspace!;
      expect(restored.cards[0].layout?.variant).toBe(variant.id); expect(resolvePlacements(restored, 6)[0].span).toEqual(variant.span);
      expectValid(resolvePlacements(restored, 1), 1);
    }
  });
  it('retains component-defined size restrictions through component installation', async () => {
    const component = clone(builtins[0]);
    component.manifest.id = 'dev.example.layouts';
    component.manifest.cardLayouts = { default: 'large', variants: [clone(officialLayouts.variants[0]), { ...clone(large), fallback: 'compact' }] };
    const installed = (await importFile('layouts.progressmod', new Uint8Array(await packageComponent(component)).buffer)).component!;
    expect(layoutsFor(installed)).toEqual(component.manifest.cardLayouts);
    expect(fittingVariant(installed, 'large', 1)?.id).toBe('compact');
    const workspace = demoWorkspace(); workspace.components.push(installed); workspace.instances[0].componentId = installed.manifest.id;
    workspace.cards[0].layout = { variant: 'wide' }; expect(() => assertWorkspace(workspace)).toThrow('不支持所选卡片尺寸');
    workspace.cards[0].layout = { variant: 'large' }; assertWorkspace(workspace);
  });
  it('persists cells and preferred variants without touching connections or metric data', () => {
    const workspace = demoWorkspace(), slots = resolvePlacements(workspace, 6);
    const next = commitPlacements(workspace, reflow(slots, slots[0].id, { column: 2, row: 1 }, large, 6)!, 6, { id: slots[0].id, variant: 'large' });
    expect(next.instances).toBe(workspace.instances); expect(next.components).toBe(workspace.components);
    expect(resolvePlacements(next, 6)).toEqual(next.cards.map(c => ({ ...slots.find(p => p.id === c.id)!, ...c.layout!.position, span: c.id === slots[0].id ? large.span : wide.span, variant: c.id === slots[0].id ? large : wide })).map(({ id, column, row, span, variant }) => ({ id, column, row, span, variant })));
    assertWorkspace(next);
  });
  it('preserves the preferred size through selected export, import, merging and a narrower canvas', async () => {
    const workspace = demoWorkspace(), card = workspace.cards[0];
    card.layout = { variant: 'expanded', position: { column: 2, row: 1, columns: 6 } };
    const exported = cardBundle(workspace, card);
    const restored = (await importFile('grid.progresspack', new Uint8Array(await packageWorkspace(exported)).buffer)).workspace!;
    expect(restored.cards[0].layout).toEqual(card.layout);
    const merged = mergeWorkspace(emptyWorkspace(), restored, 'rename');
    const narrow = resolvePlacements(merged, 2); expect(narrow[0].variant?.id).toBe('large'); expectValid(narrow, 2);
    expect(merged.cards[0].layout?.variant).toBe('expanded');
    expect(resolvePlacements(merged, 6)[0].variant?.id).toBe('expanded');
  });
  it('removes a card without uninstalling its component or moving unrelated cards', () => {
    const workspace = commitPlacements(demoWorkspace(), resolvePlacements(demoWorkspace(), 4), 4);
    const original = resolvePlacements(workspace, 4), removed = removeCard(workspace, workspace.cards[0].id);
    expect(removed.components).toEqual(workspace.components);
    expect(resolvePlacements(removed, 4)).toEqual(original.slice(1));
  });
  it('labels the ellipsis as direct configuration and changes compact content density', () => {
    const workspace = demoWorkspace(), card = workspace.cards[1];
    const transfer = workspace.components.find(c => c.manifest.id === workspace.instances[1].componentId)!;
    const props = { card, instance: workspace.instances[1], component: transfer, snapshot: { metrics: transfer.metrics! }, now: Date.now(), online: true, onEdit() {}, onDetails() {}, onRetry() {} };
    const compact = renderToStaticMarkup(createElement(ProgressCard, { ...props, density: 'compact' }));
    const largeMarkup = renderToStaticMarkup(createElement(ProgressCard, { ...props, density: 'large' }));
    expect(compact).toContain('aria-label="编辑 OneDrive → NAS"'); expect(compact).not.toContain('card-popover');
    expect(compact).not.toContain('38.2'); expect(largeMarkup).toContain('38.2');
  });
});
