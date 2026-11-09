// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternPr } from '../src/main/lantern';
import { initials, localCard, prCard, prInfoHtml } from '../src/renderer/pr-info';
import { timeAgo as ago } from '../src/renderer/lib/util';
import { pr } from './helpers/lantern-map';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const AVATAR = 'data:image/png;base64,iVBORw0KGgo=';

const HOSTED: LanternPr = pr('262', {
  title: 'Shared tooltip and popover modules',
  branch: 'feat/tooltips-popovers',
  base: 'main',
  opened: '2026-10-30',
  files: [{ path: 'src/a.ts', kind: 'added', mapped: true }],
  info: {
    from: 'host',
    author: { name: 'Patryk Babula', avatar: AVATAR },
    created: '2026-10-30T10:00:00Z',
    updated: '2026-10-30T11:55:00Z',
    comments: 4,
    tasks: 1,
    reviewers: [
      { name: 'Ada Lovelace', approved: true, changes: false },
      { name: 'Alan Turing', approved: false, changes: true },
      { name: 'Grace Hopper', approved: false, changes: false },
    ],
  },
});

afterEach(() => document.body.replaceChildren());

describe('pull request info', () => {
  it('says how long ago, by the day for a date-only stamp', () => {
    expect(ago('2026-10-30T11:55:00Z', NOW)).toBe('5 minutes ago');
    expect(ago('2026-10-28T12:00:00Z', NOW)).toBe('2 days ago');
    expect(ago('2026-10-30T11:59:40Z', NOW)).toBe('just now');
    vi.useFakeTimers({ now: new Date(2026, 9, 30, 9) });
    expect(ago('2026-10-29', Date.now())).toBe('yesterday');
    vi.useRealTimers();
  });

  it('makes initials from a name or a handle', () => {
    expect(initials('Patryk Babula')).toBe('PB');
    expect(initials('ada')).toBe('A');
    expect(initials('grace.hopper')).toBe('GH');
  });

  it('builds the hover card: id and state, title, branches, author with the open date, then counts and reviews', () => {
    const card = prCard(HOSTED, NOW);
    expect(card.querySelector('.pr-card-id')?.textContent).toBe('#262');
    expect(card.querySelector('.pr-badge')?.textContent).toBe('open');
    expect(card.querySelector('.pr-card-title')?.textContent).toBe('Shared tooltip and popover modules');
    expect(card.querySelector('.pr-card-branches')?.textContent).toBe('feat/tooltips-popovers → main');
    expect(card.querySelector('img.pr-avatar')?.getAttribute('src')).toBe(AVATAR);
    expect(card.querySelector('.pr-card-by')?.textContent).toBe('Patryk Babula ∙ opened 2 hours ago');
    expect(card.querySelector('.pr-card-foot span')?.textContent).toBe('1 file ∙ 1 added');
    expect(card.querySelector('.pr-card-review.pr-rv-changes')?.textContent).toBe('1 requested changes');
  });

  it('counts approvals when nobody asked for changes', () => {
    const reviewers = [
      { name: 'Ada Lovelace', approved: true, changes: false },
      { name: 'Grace Hopper', approved: false, changes: false },
    ];
    const card = prCard({ ...HOSTED, info: { from: 'host', reviewers } }, NOW);
    expect(card.querySelector('.pr-card-review.pr-rv-approved')?.textContent).toBe('1 of 2 approved');
  });

  it('falls back to initials, the record date and a draft badge', () => {
    const card = prCard({ ...HOSTED, info: { from: 'git', author: { name: 'Patryk Babula' }, draft: true } }, NOW);
    expect(card.querySelector('.pr-avatar-initials')?.textContent).toBe('PB');
    expect(card.querySelector('.pr-badge')?.textContent).toBe('draft');
    expect(card.querySelector('.pr-card-by')?.textContent).toBe('PBPatryk Babula ∙ opened today');
    expect(card.querySelector('.pr-card-review')).toBeNull();
    const bare = prCard({ ...HOSTED, info: undefined }, NOW);
    expect(bare.querySelector('.pr-avatar')).toBeNull();
    expect(bare.querySelector('.pr-card-by')?.textContent).toBe('Opened today');
  });

  it('keeps the recorded open date for git info and shows when a merged PR merged', () => {
    const merged = prCard({ ...HOSTED, opened: '2026-10-28', state: 'merged', mergedAt: '2026-10-30T09:00:00Z', info: { from: 'git', author: { name: 'Patryk Babula' }, updated: '2026-10-30T09:00:00Z' } }, NOW);
    expect(merged.querySelector('.pr-card-by')?.textContent).toBe('PBPatryk Babula ∙ merged 3 hours ago');
    const hosted = prCard({ ...HOSTED, opened: '2026-10-20', info: { from: 'host', created: '2026-10-30T10:00:00Z' } }, NOW);
    expect(hosted.querySelector('.pr-card-by')?.textContent).toBe('Opened 2 hours ago');
  });

  it('gives the sidebar the same byline and footer, with the exact time reachable by keyboard', () => {
    document.body.innerHTML = prInfoHtml(HOSTED, NOW);
    expect(document.querySelector('.pr-reviewer')).toBeNull();
    expect(document.querySelector('.pr-card-review')?.textContent).toBe('1 requested changes');
    expect(document.querySelector('.pr-card-by')?.textContent).toBe('Patryk Babula ∙ opened 2 hours ago');
    expect(document.querySelector('.pr-card-by time')?.getAttribute('tabindex')).toBe('0');
    expect(document.querySelector('.pr-sep')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.pr-card-by time')?.getAttribute('data-tip')).toMatch(/^30 Oct 2026, \d+:\d\d/);
  });

  it('escapes what the host sends', () => {
    const card = prCard({ ...HOSTED, title: '<img src=x onerror=alert(1)>', info: { from: 'host', author: { name: '<b>x</b>', avatar: 'javascript:alert(1)' } } }, NOW);
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelector('.pr-card-who')?.textContent).toBe('<b>x</b>');
    expect(card.querySelector('.pr-card-title')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('describes a local comparison by its points, file kinds and reasons', () => {
    const local = pr('local-1', {
      source: 'local',
      title: 'Uncommitted changes',
      branch: 'working tree',
      base: 'HEAD',
      files: [
        { path: 'a.ts', kind: 'added', mapped: true, reason: 'Why' },
        { path: 'b.ts', kind: 'modified', mapped: true },
        { path: 'c.ts', kind: 'modified', mapped: true },
      ],
    });
    const card = localCard(local);
    expect(card.querySelector('.pr-badge')?.textContent).toBe('local');
    expect(card.querySelector('.pr-card-branches')?.textContent).toBe('working tree compared with where it left HEAD');
    expect(card.querySelector('.pr-card-foot')?.textContent).toBe('3 files ∙ 1 added ∙ 2 modified1 of 3 with reasons');
  });
});
