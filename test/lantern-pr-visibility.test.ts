// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternPr } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-10T12:00:00Z');
const NODES = [node('src/page.tsx', 'page', { platform: 'web' })];
const FILES = [{ path: 'src/page.tsx', kind: 'modified' as const, mapped: true }];
const mounted: ReturnType<typeof mountLanternView>[] = [];

function mapWith(prs: LanternPr[]): LanternMap {
  return mapOf({ nodes: NODES, prs });
}

function mount(prs: LanternPr[], opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, mapWith(prs), { now: () => NOW, ...opts });
  mounted.push(view);
  return { root, view };
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

const ids = (root: HTMLElement) => [...root.querySelectorAll('.pr-chip')].map((c) => c.getAttribute('data-pr'));
const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => iso(ms).slice(0, 10);

describe('pull request strip visibility', () => {
  it('always shows open, however old', () => {
    const { root } = mount([pr('1', { state: 'open', opened: '2020-01-01' })]);
    expect(ids(root)).toEqual(['1']);
  });

  it('shows merged only while mergedAt is within two days', () => {
    const inside = pr('2', { state: 'merged', opened: '2020-01-01', mergedAt: iso(NOW - 2 * DAY) });
    const outside = pr('3', { state: 'merged', opened: '2026-10-10', mergedAt: iso(NOW - 2 * DAY - 1000) });
    const { root } = mount([inside, outside]);
    expect(ids(root)).toEqual(['2']);
  });

  it('falls back to opened for a merged PR without mergedAt', () => {
    const fresh = pr('4', { state: 'merged', opened: day(NOW - DAY) });
    const stale = pr('5', { state: 'merged', opened: day(NOW - 4 * DAY) });
    const { root } = mount([fresh, stale]);
    expect(ids(root)).toEqual(['4']);
  });

  it('shows declined only while opened is within two days', () => {
    const fresh = pr('6', { state: 'closed', opened: day(NOW - DAY) });
    const stale = pr('7', { state: 'closed', opened: day(NOW - 5 * DAY) });
    const { root } = mount([fresh, stale]);
    expect(ids(root)).toEqual(['6']);
  });

  it('hides the whole strip when nothing is visible', () => {
    const { root } = mount([pr('8', { state: 'merged', mergedAt: iso(NOW - 9 * DAY) }), pr('9', { state: 'closed', opened: '2020-01-01' })]);
    expect(root.querySelector('.lt-prs')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.pr-chip')).toBeNull();
  });

  it('shows every visible PR and collapses nothing', () => {
    const open = Array.from({ length: 8 }, (_, i) => pr(String(30 + i), { state: 'open' }));
    const old = Array.from({ length: 5 }, (_, i) => pr(String(50 + i), { state: 'merged', mergedAt: iso(NOW - 30 * DAY) }));
    const { root } = mount([...open, ...old]);
    expect(root.querySelectorAll('.pr-chip')).toHaveLength(8);
    expect(root.querySelector('.pr-more')).toBeNull();
  });
});

describe('declined chip', () => {
  const declined = () => pr('12', { state: 'closed', opened: day(NOW), title: 'Dropped idea', files: FILES });

  it('says declined, is muted, aria-disabled and carries a tooltip', () => {
    const { root } = mount([declined()]);
    const chip = root.querySelector('.pr-chip') as HTMLElement;
    expect(chip.textContent).toBe('#12 feat/pr-12');
    expect(chip.classList.contains('pr-declined')).toBe(true);
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(chip.getAttribute('data-tip')).toMatch(/declined/i);
  });

  it('does not enter PR mode when clicked', () => {
    const onPr = vi.fn();
    const { root } = mount([declined()], { onPr });
    const chip = root.querySelector('.pr-chip') as HTMLElement;
    chip.click();
    expect(onPr).not.toHaveBeenCalled();
    expect(chip.hasAttribute('aria-pressed')).toBe(false);
    expect(root.querySelector('[data-pr-back]')).toBeNull();
  });

  it('is not initially selected even when asked for', () => {
    const onPr = vi.fn();
    const { root } = mount([declined()], { pr: '12', onPr });
    expect(root.querySelector('[data-pr-back]')).toBeNull();
  });
});

describe('selection when a PR disappears', () => {
  it('leaves PR mode when the selected PR is hidden after a reload', () => {
    const onPr = vi.fn();
    const live = pr('20', { state: 'open', files: FILES });
    const { root, view } = mount([live], { onPr });
    (root.querySelector('.pr-chip[data-pr="20"]') as HTMLElement).click();
    expect(root.querySelector('.pr-chip[data-pr="20"]')?.getAttribute('aria-pressed')).toBe('true');
    onPr.mockClear();

    view.update(mapWith([pr('20', { state: 'merged', files: FILES, mergedAt: iso(NOW - 10 * DAY) })]));

    expect(onPr).toHaveBeenCalledWith('');
    expect(root.querySelector('.pr-chip')).toBeNull();
  });

  it('leaves PR mode when the selected PR becomes declined', () => {
    const onPr = vi.fn();
    const { root, view } = mount([pr('21', { state: 'open', files: FILES })], { onPr });
    (root.querySelector('.pr-chip[data-pr="21"]') as HTMLElement).click();
    onPr.mockClear();

    view.update(mapWith([pr('21', { state: 'closed', opened: day(NOW), files: FILES })]));

    expect(onPr).toHaveBeenCalledWith('');
    expect(root.querySelector('.pr-chip')?.getAttribute('aria-pressed')).toBeNull();
  });
});

describe('dismissing merged and declined PRs', () => {
  const merged = (id: string, extra = {}) => pr(id, { state: 'merged', mergedAt: iso(NOW - DAY), files: FILES, ...extra });
  const declined = (id: string) => pr(id, { state: 'closed', opened: day(NOW), files: FILES });
  const x = (root: HTMLElement, id: string) => root.querySelector(`[data-pr-dismiss="${id}"]`) as HTMLButtonElement | null;

  it('puts a labelled x on merged and declined chips only', () => {
    const { root } = mount([pr('1', { state: 'open', files: FILES }), merged('2'), declined('3')]);
    expect(x(root, '1')).toBeNull();
    for (const id of ['2', '3']) {
      const b = x(root, id) as HTMLButtonElement;
      expect(b.tagName).toBe('BUTTON');
      expect(b.dataset.tip).toBeUndefined();
      expect(b.getAttribute('aria-label')).toBe(`Hide pull request #${id}`);
    }
  });

  it('hides the PR at once, calls the handler and shows the restore button', () => {
    const onDismissPr = vi.fn();
    const { root } = mount([pr('1', { state: 'open', files: FILES }), merged('2'), merged('3')], { onDismissPr });
    x(root, '2')?.click();
    expect(onDismissPr).toHaveBeenCalledWith('2');
    expect(ids(root)).toEqual(['1', '3']);
    expect(root.querySelector('.pr-restore')?.textContent).toBe('Hidden (1) — restore');
  });

  it('restores the hidden PRs and calls the handler', () => {
    const onRestorePrs = vi.fn();
    const { root } = mount([merged('2'), declined('3')], { dismissedPrs: ['2', '3'], onRestorePrs });
    expect(ids(root)).toEqual([]);
    (root.querySelector('.pr-restore') as HTMLElement).click();
    expect(onRestorePrs).toHaveBeenCalled();
    expect(ids(root)).toEqual(['2', '3']);
    expect(root.querySelector('.pr-restore')).toBeNull();
  });

  it('shows only the restore button when every visible PR is hidden', () => {
    const { root } = mount([merged('2')], { dismissedPrs: ['2'] });
    expect(root.querySelector('.lt-prs')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.pr-chip')).toBeNull();
    expect(root.querySelector('.pr-restore')?.textContent).toBe('Hidden (1) — restore');
  });

  it('does not count hidden PRs that already aged out, and hides the strip then', () => {
    const { root } = mount([pr('9', { state: 'merged', mergedAt: iso(NOW - 9 * DAY) })], { dismissedPrs: ['9'] });
    expect(root.querySelector('.lt-prs')?.hasAttribute('hidden')).toBe(true);
  });

  it('drops a dismissed PR from the strip and shows the rest', () => {
    const open = Array.from({ length: 6 }, (_, i) => pr(String(30 + i), { state: 'open' }));
    const { root } = mount([...open, merged('40'), merged('41'), merged('42')], { dismissedPrs: ['40'] });
    expect(root.querySelectorAll('.pr-chip')).toHaveLength(8);
    expect(root.querySelector('.pr-chip[data-pr="40"]')).toBeNull();
  });

  it('leaves PR mode when the selected merged PR is dismissed', () => {
    const onPr = vi.fn();
    const { root } = mount([merged('2')], { onPr });
    (root.querySelector('.pr-chip[data-pr="2"]') as HTMLElement).click();
    expect(root.querySelector('[data-pr-back]')).not.toBeNull();
    onPr.mockClear();
    x(root, '2')?.click();
    expect(onPr).toHaveBeenCalledWith('');
    expect(root.querySelector('[data-pr-back]')).toBeNull();
    expect(root.querySelector('.pr-chip')).toBeNull();
  });

  it('moves focus to the next chip, or to the restore button after the last one', () => {
    const { root } = mount([merged('2'), merged('3')]);
    x(root, '2')?.focus();
    x(root, '2')?.click();
    expect(document.activeElement).toBe(root.querySelector('.pr-chip[data-pr="3"]'));
    x(root, '3')?.click();
    expect(document.activeElement).toBe(root.querySelector('[data-pr-restore]'));
  });

  it('keeps a dismissed PR hidden after a re-render with the same data', () => {
    const list = [merged('2'), merged('3')];
    const { root, view } = mount(list);
    x(root, '2')?.click();
    view.update(mapWith(list));
    expect(ids(root)).toEqual(['3']);
    expect(x(root, '2')).toBeNull();
  });

  it('starts hidden for ids loaded from settings', () => {
    const { root } = mount([merged('2'), merged('3')], { dismissedPrs: ['2'] });
    expect(ids(root)).toEqual(['3']);
  });

  it('never hides an open PR even if its id is in the list', () => {
    const { root } = mount([pr('5', { state: 'open', files: FILES })], { dismissedPrs: ['5'] });
    expect(ids(root)).toEqual(['5']);
  });
});
