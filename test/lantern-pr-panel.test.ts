// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternPr } from '../src/main/lantern';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { mapOf, node, pr } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { formatDay } from '../src/renderer/lib/util';
import type { ViewOptions } from '../src/renderer/lib/lanternview';

const NODES = [node('src/page.tsx', 'page'), node('src/svc.ts', 'service'), node('src/deep/repo.ts', 'repository')];

const PR = pr('24', {
  title: 'Refuse to signal pids 0, 1 and -1',
  branch: 'fix/guard',
  base: 'main',
  opened: '2026-09-29',
  summary: 'Guards process.kill in tests.',
  files: [
    { path: 'test/new-a.ts', kind: 'added', mapped: false },
    { path: 'src/svc.ts', kind: 'modified', mapped: true },
    { path: 'src/deep/repo.ts', kind: 'modified', mapped: true },
    { path: 'src/page.tsx', kind: 'removed', mapped: true },
  ],
});
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

function open(p: LanternPr, opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, mapOf({ nodes: NODES, prs: [p] }), { pr: p.id, ...opts }));
  return root;
}

describe('pull request panel', () => {
  it('shows the header: id, title, state, branch to base, opened date and summary', () => {
    const root = open(PR);
    const head = root.querySelector('.pr-head') as HTMLElement;
    expect(head.querySelector('.pr-id')?.textContent).toContain('#24');
    expect(head.querySelector('.pr-title')?.textContent).toBe('Refuse to signal pids 0, 1 and -1');
    expect(head.querySelector('.pr-badge')?.textContent).toBe('open');
    expect(head.querySelector('.pr-badge')?.classList.contains('pr-open')).toBe(true);
    expect(head.textContent).toContain('fix/guard → main');
    expect(head.querySelector('.pr-card-by')?.textContent).toMatch(/^Opened /);
    expect(head.querySelector('.pr-card-by time')?.getAttribute('data-tip')).toBe(formatDay(new Date(2026, 8, 29).getTime()));
    expect(head.querySelector('.pr-summary')?.textContent).toBe('Guards process.kill in tests.');
    expect(root.querySelector('.search')).toBeNull();
  });

  it('groups files by kind with counts, in added, modified, removed order', () => {
    const root = open(PR);
    const heads = [...root.querySelectorAll('.lt-side h2')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
    expect(heads).toEqual(['+ Added1', '~ Modified2', '- Removed1']);
    const lists = [...root.querySelectorAll('.pr-files')].map((ul) => [...ul.querySelectorAll('.pr-path')].map((p) => p.textContent));
    expect(lists).toEqual([['new-a.ts test/'], ['svc.ts src/', 'repo.ts src/deep/'], ['page.tsx src/']]);
  });

  it('omits a group with no files', () => {
    const root = open(pr('3', { files: [{ path: 'src/svc.ts', kind: 'modified', mapped: true }] }));
    expect([...root.querySelectorAll('.lt-side h2')].map((h) => h.textContent)).toEqual(['~ Modified1']);
  });

  it('shows the base name bold and the folder dim', () => {
    const row = open(PR).querySelector('[data-pr-go="src/deep/repo.ts"]') as HTMLElement;
    expect(row.querySelector('b')?.textContent).toBe('repo.ts');
    expect(row.querySelector('.file-label')?.textContent).toBe('repo.ts src/deep/');
    expect(row.querySelector('.file-label-icon')?.getAttribute('src')).toContain('/assets/file-icons/typescript.svg');
    expect(row.querySelector('.file-directory')?.textContent).toBe('src/deep/');
  });

  it('tags files that are not in the map and gives them no click target or code button', () => {
    const root = open(PR, { readFile: vi.fn() });
    const row = [...root.querySelectorAll('.pr-file')].find((r) => r.textContent?.includes('new-a.ts')) as HTMLElement;
    expect(row.querySelector('.pr-tag')?.textContent).toBe('not in map');
    expect(row.querySelector('button')).toBeNull();
    expect(root.querySelectorAll('.pr-file .code-open')).toHaveLength(3);
    expect(root.querySelectorAll('.pr-file .pr-tag')).toHaveLength(1);
  });

  it('offers no code button without a file reader', () => {
    expect(open(PR).querySelector('.pr-file .code-open')).toBeNull();
  });

  it('the code button shows that file in the review pane, not in a modal', async () => {
    const readFile = vi.fn().mockResolvedValue({ exists: true, text: 'const a = 1;\n', truncated: 0, clipped: false, refused: false });
    const root = open(PR, { readFile });
    (root.querySelector('.pr-file .code-open[data-code="src/svc.ts"]') as HTMLElement).click();
    expect(readFile).toHaveBeenCalledWith('src/svc.ts');
    await vi.waitFor(() => expect(root.querySelector('.lt-review .lt-code-body .cl')).not.toBeNull());
    expect(root.querySelector('.lt-code-modal')).toBeNull();
  });

  it('clicking a mapped file selects it in the graph', () => {
    const root = open(PR);
    (root.querySelector('[data-pr-go="src/svc.ts"]') as HTMLElement).click();
    expect(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]')?.textContent).toBe('svc.ts');
    expect(root.querySelector('.pr-file.sel')?.textContent).toContain('svc.ts');
    expect(root.querySelector('.pr-head')).not.toBeNull();
  });

  it('links to the pull request in a new window only for an https url', () => {
    const link = open(PR).querySelector('a.pr-open-link') as HTMLAnchorElement;
    expect(link.textContent).toBe('Open PR');
    expect(link.getAttribute('href')).toBe(PR.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x/y', 'http://host/pr/1', '']) {
      expect(open({ ...PR, url }).querySelector('a.pr-open-link')).toBeNull();
    }
  });

  it('escapes markup in the title and paths', () => {
    const root = open({ ...PR, title: '<img src=x onerror=alert(1)>', files: [{ path: 'a<b>.ts', kind: 'added', mapped: false }] });
    expect(root.querySelector('.lt-side img:not(.file-label-icon)')).toBeNull();
    expect(root.querySelector('.pr-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  describe('reasons under changed files', () => {
    const REASON = 'Guards the kill path so tests cannot signal pid 1.';
    const withReason = pr('24', {
      files: [
        { path: 'src/svc.ts', kind: 'modified', mapped: true, reason: REASON },
        { path: 'test/new-a.ts', kind: 'added', mapped: false, reason: 'Covers the new guard.' },
        { path: 'src/page.tsx', kind: 'removed', mapped: true },
      ],
    });

    it('shows the reason under a mapped file and under a file that is not in the map', () => {
      const root = open(withReason);
      const rows = [...root.querySelectorAll('.pr-file')];
      const svc = rows.find((r) => r.textContent?.includes('svc.ts')) as HTMLElement;
      expect(svc.querySelector('.pr-reason')?.textContent).toBe(REASON);
      expect(svc.classList.contains('has-reason')).toBe(true);
      expect(svc.querySelector('.pr-reason')?.previousElementSibling).not.toBeNull();
      const added = rows.find((r) => r.textContent?.includes('new-a.ts')) as HTMLElement;
      expect(added.querySelector('.pr-reason')?.textContent).toBe('Covers the new guard.');
      expect(added.classList.contains('off')).toBe(true);
    });

    it('marks a file without a reason with a visible "no reason" tag, and only that file', () => {
      const root = open(withReason);
      const rows = [...root.querySelectorAll('.pr-file')];
      const removed = rows.find((r) => r.textContent?.includes('page.tsx')) as HTMLElement;
      expect(removed.querySelector('.pr-reason')).toBeNull();
      expect(removed.querySelector('.pr-noreason')?.textContent).toBe('no reason');
      expect(removed.classList.contains('has-reason')).toBe(false);
      expect(root.querySelectorAll('.pr-reason')).toHaveLength(2);
      expect(root.querySelectorAll('.pr-noreason')).toHaveLength(1);
      const svc = rows.find((r) => r.textContent?.includes('svc.ts')) as HTMLElement;
      expect(svc.querySelector('.pr-noreason')).toBeNull();
    });

    it('marks every file of a record that has no reasons at all', () => {
      const root = open(PR);
      expect(root.querySelector('.pr-reason')).toBeNull();
      expect(root.querySelector('.has-reason')).toBeNull();
      expect(root.querySelectorAll('.pr-file')).toHaveLength(4);
      expect(root.querySelectorAll('.pr-noreason')).toHaveLength(4);
    });

    it('renders the reasons of a record as sync.mjs writes it, and an old record without them', () => {
      const head = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
      const base = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${head}`, '~ src/svc.ts', '~ src/deep/repo.ts'];
      const parse = (lines: string[]) => {
        const { pr: parsed } = parsePrRecord(`${lines.join('\n')}\n`, '7.pr');
        return pr('7', { files: parsed!.files.map((f) => ({ ...f, mapped: true })) });
      };
      const withReason = open(parse([...base, '#reason src/svc.ts Keeps the service pure.']));
      const rows = [...withReason.querySelectorAll('.pr-file')];
      expect(rows[0].querySelector('.pr-reason')?.textContent).toBe('Keeps the service pure.');
      expect(rows[1].querySelector('.pr-reason')).toBeNull();
      const old = open(parse(base));
      expect(old.querySelectorAll('.pr-file')).toHaveLength(2);
      expect(old.querySelector('.pr-reason')).toBeNull();
    });

    it('escapes markup in a reason and keeps the file click target working', () => {
      const root = open(pr('3', { files: [{ path: 'src/svc.ts', kind: 'modified', mapped: true, reason: '<img src=x onerror=alert(1)> & more' }] }));
      expect(root.querySelector('.pr-file img:not(.file-label-icon)')).toBeNull();
      expect(root.querySelector('.pr-reason')?.textContent).toBe('<img src=x onerror=alert(1)> & more');
      (root.querySelector('[data-pr-go="src/svc.ts"]') as HTMLElement).click();
      expect(root.querySelector('.pr-file.sel .pr-reason')).not.toBeNull();
    });
  });

  describe('review order', () => {
    const ORDERED = pr('24', {
      ordered: true,
      files: [
        { path: 'src/page.tsx', kind: 'removed', mapped: true },
        { path: 'src/svc.ts', kind: 'modified', mapped: true, reason: 'Defines the contract.' },
        { path: 'test/new-a.ts', kind: 'added', mapped: false },
        { path: 'src/deep/repo.ts', kind: 'modified', mapped: true },
      ],
    });

    it('lists every file in one list in review order, each row numbered from 1', () => {
      const root = open(ORDERED);
      expect(root.querySelectorAll('.pr-files')).toHaveLength(1);
      const rows = [...root.querySelectorAll('.pr-file')];
      expect(rows.map((r) => r.querySelector('.pr-num')?.textContent)).toEqual(['1', '2', '3', '4']);
      expect(rows.map((r) => r.querySelector('.pr-path')?.textContent)).toEqual(['page.tsx src/', 'svc.ts src/', 'new-a.ts test/', 'repo.ts src/deep/']);
      expect([...root.querySelectorAll('.lt-side h2')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Review order4']);
    });

    it('keeps the kind marker, the code and diff actions and the reason on every row', () => {
      const root = open(ORDERED, { readFile: vi.fn(), readPrDiff: vi.fn(), readPrFile: vi.fn() });
      const rows = [...root.querySelectorAll('.pr-file')];
      expect(rows.map((r) => r.querySelector('.pr-kind')?.textContent)).toEqual(['-', '~', '+', '~']);
      expect(rows.map((r) => r.querySelector('.pr-kind')?.getAttribute('data-tip'))).toEqual(['Removed', 'Modified', 'Added', 'Modified']);
      for (const row of rows) expect(row.querySelectorAll('.diff-open')).toHaveLength(1);
      expect(rows[1].querySelector('.code-open[data-code="src/svc.ts"]')).not.toBeNull();
      expect(rows[2].querySelector('[data-pr-code="test/new-a.ts"]')).not.toBeNull();
      expect(rows[1].querySelector('.pr-reason')?.textContent).toBe('Defines the contract.');
      expect(rows[1].querySelector('[data-pr-go="src/svc.ts"]')).not.toBeNull();
    });

    it('shows no numbers and the kind groups when the pull request has no order', () => {
      const root = open(PR);
      expect(root.querySelector('.pr-num')).toBeNull();
      expect(root.querySelector('.pr-kind')).toBeNull();
      expect(root.querySelectorAll('.pr-files')).toHaveLength(3);
    });

    it('renders a record as the app reader returns it', () => {
      const head = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
      const lines = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${head}`, '~ src/svc.ts', '~ src/deep/repo.ts', '#order src/deep/repo.ts'];
      const { pr: parsed } = parsePrRecord(`${lines.join('\n')}\n`, '7.pr');
      const root = open(pr('7', { ordered: parsed!.ordered, files: parsed!.files.map((f) => ({ ...f, mapped: true })) }));
      expect([...root.querySelectorAll('.pr-file')].map((r) => `${r.querySelector('.pr-num')?.textContent} ${r.querySelector('.pr-path')?.textContent}`)).toEqual(['1 repo.ts src/deep/', '2 svc.ts src/']);
    });
  });
});
