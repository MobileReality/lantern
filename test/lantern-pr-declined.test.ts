// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternPr } from '../src/main/lantern';
import { unreadableReason } from '../src/main/lantern-pr-revisions';
import { overlayKey } from '../src/renderer/lib/lanternoverlay';
import { prPanelHtml } from '../src/renderer/lib/lanternprpanel';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-10T12:00:00Z');
const NODES = [node('src/page.tsx', 'page', { platform: 'web' })];
const FILES = [{ path: 'src/page.tsx', kind: 'modified' as const, mapped: true }];
const mounted: ReturnType<typeof mountLanternView>[] = [];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const declined = (id = '126', extra: Partial<LanternPr> = {}) => pr(id, { state: 'declined', opened: day(NOW), title: 'Quote shell args', files: FILES, tip: 'a'.repeat(40), ...extra });

function mount(prs: LanternPr[], opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const map: LanternMap = mapOf({ nodes: NODES, prs });
  const view = mountLanternView(root, map, { now: () => NOW, ...opts });
  mounted.push(view);
  return { root, view };
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

describe('a host-declined pull request in the strip', () => {
  it('says declined and never open, with an accessibility label', () => {
    const { root } = mount([declined()]);
    const chip = root.querySelector('.pr-chip') as HTMLElement;
    expect(chip.textContent).toBe('#126 feat/pr-126');
    expect(chip.textContent).not.toMatch(/open/i);
    expect(chip.getAttribute('aria-label')).toBe('Pull request #126, declined, 1 file');
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(chip.getAttribute('data-tip')).toBe('Declined: Quote shell args');
  });

  it('wears its own muted colour next to merged and closed, never the open one', () => {
    const { root } = mount([declined('1'), pr('2', { state: 'closed', opened: day(NOW), files: FILES }), pr('3', { state: 'merged', mergedAt: new Date(NOW - DAY).toISOString(), files: FILES })]);
    const classes = Object.fromEntries([...root.querySelectorAll('.pr-chip')].map((c) => [c.getAttribute('data-pr'), c.className]));
    expect(classes['1']).toContain('pr-declined-state');
    expect(classes['1']).toContain('pr-declined');
    expect(classes['1']).not.toContain('pr-open');
    expect(classes['2']).not.toContain('pr-declined-state');
    expect(classes['3']).toContain('pr-merged');
  });

  it('is not selectable: no click, no pressed state, no panel', () => {
    const onPr = vi.fn();
    const { root } = mount([declined()], { onPr, pr: '126' });
    (root.querySelector('.pr-chip') as HTMLElement).click();
    expect(onPr).not.toHaveBeenCalledWith('126');
    expect(root.querySelector('[data-pr-back]')).toBeNull();
    expect(root.querySelector('.pr-chip')?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('leaves PR mode when the selected open PR turns out declined', () => {
    const onPr = vi.fn();
    const { root, view } = mount([pr('126', { state: 'open', files: FILES })], { onPr });
    (root.querySelector('.pr-chip[data-pr="126"]') as HTMLElement).click();
    onPr.mockClear();
    view.update(mapOf({ nodes: NODES, prs: [declined()] }));
    expect(onPr).toHaveBeenCalledWith('');
    expect(root.querySelector('[data-pr-back]')).toBeNull();
    expect(root.querySelector('.pr-chip')?.getAttribute('aria-label')).toContain('declined');
  });

  it('can be hidden with its own dismiss button and restored', () => {
    const { root } = mount([declined()]);
    const dismiss = root.querySelector('[data-pr-dismiss="126"]') as HTMLElement;
    expect(dismiss.getAttribute('aria-label')).toBe('Hide pull request #126');
    dismiss.click();
    expect(root.querySelector('.pr-chip')).toBeNull();
    expect(root.querySelector('.pr-restore')?.textContent).toContain('Hidden (1)');
  });

  it('shows only while opened is within two days, like a closed one', () => {
    const { root } = mount([declined('1'), declined('2', { opened: day(NOW - 5 * DAY) })]);
    expect([...root.querySelectorAll('.pr-chip')].map((c) => c.getAttribute('data-pr'))).toEqual(['1']);
  });

  it('sits in the strip like the other non-open states', () => {
    const open = Array.from({ length: 6 }, (_, i) => pr(String(10 + i), { state: 'open' }));
    const { root } = mount([...open, declined('99')]);
    expect(root.querySelectorAll('.pr-chip')).toHaveLength(7);
    expect(root.querySelector('.pr-chip[data-pr="99"]')?.classList.contains('pr-declined')).toBe(true);
  });
});

describe('a host-declined pull request elsewhere', () => {
  it('shows declined in the panel badge, with the declined colour and a label', () => {
    const html = prPanelHtml({ pr: declined(), byPath: new Map(), selected: null, canOpenCode: false, activeFilters: 0 });
    const box = document.createElement('div');
    box.innerHTML = html;
    const badge = box.querySelector('.pr-badge') as HTMLElement;
    expect(badge.textContent).toBe('declined');
    expect(badge.getAttribute('aria-label')).toBe('Pull request state: declined');
    expect(badge.className).toContain('pr-declined-state');
    expect(badge.className).not.toContain('pr-open');
    expect(box.querySelector('.pr-head')?.className).not.toContain('pr-open');
    expect(box.textContent).not.toMatch(/\bopen\b/i);
  });

  it('offers no graph overlay even with a branch tip', () => {
    expect(overlayKey(declined(), 'en')).toBeNull();
    expect(overlayKey(pr('5', { state: 'open', tip: 'b'.repeat(40) }), 'en')).not.toBeNull();
  });

  it('refuses to read its diff or files, saying it was declined', () => {
    expect(unreadableReason(declined())).toBe('this pull request was declined');
    expect(unreadableReason(pr('7', { state: 'closed' }))).toBe('this pull request was declined and its branch is gone');
    expect(unreadableReason(pr('8', { state: 'open' }))).toBeNull();
    expect(unreadableReason(pr('9', { state: 'merged' }))).toBeNull();
  });
});
