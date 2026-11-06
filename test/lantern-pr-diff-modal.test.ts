// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import type { CodeSource } from '../src/shared/code-highlighting';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const NODES = [node('src/svc.ts', 'service'), node('src/page.tsx', 'page')];

const PR = pr('24', {
  files: [
    { path: 'test/new-a.ts', kind: 'added', mapped: false },
    { path: 'src/svc.ts', kind: 'modified', mapped: true },
    { path: 'src/page.tsx', kind: 'removed', mapped: true },
    { path: 'src/gone.ts', kind: 'modified', mapped: true },
  ],
});

const DIFF = [
  'diff --git a/src/svc.ts b/src/svc.ts',
  'index 111..222 100644',
  '--- a/src/svc.ts',
  '+++ b/src/svc.ts',
  '@@ -3,3 +3,3 @@ function run() {',
  ' keep',
  '-const old = 1;',
  '+const fresh = "<img src=x onerror=alert(1)>";',
  ' tail',
].join('\n');

const good = (diff: string, extra: Partial<PrFileDiff> = {}): PrFileDiff => ({ ok: true, diff, truncated: false, binary: false, ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));
const source = (contentHash: string): CodeSource => ({ token: contentHash, kind: 'revision', revision: 'a'.repeat(40), contentHash });
const mounted: ReturnType<typeof mountLanternView>[] = [];

function open(readPrDiff?: (pr: string, path: string, sides?: { base?: string; branch?: string }) => Promise<PrFileDiff>, readSemantic?: Parameters<typeof mountLanternView>[2]['readSemantic']) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, mapOf({ nodes: NODES, prs: [PR] }), { pr: '24', readPrDiff, readSemantic }));
  return root;
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

describe('diff button in the pull request panel', () => {
  it('sits on every file row, mapped or not, of every kind', () => {
    const root = open(async () => good(DIFF));
    const rows = [...root.querySelectorAll('.pr-file')];
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.querySelectorAll('button.diff-open')).toHaveLength(1);
    expect([...root.querySelectorAll('.diff-open')].map((b) => b.getAttribute('data-pr-diff'))).toEqual(['test/new-a.ts', 'src/svc.ts', 'src/gone.ts', 'src/page.tsx']);
    expect(rows.find((r) => r.classList.contains('off'))?.querySelector('.diff-open')).not.toBeNull();
    expect((root.querySelector('.diff-open') as HTMLElement).getAttribute('aria-label')).toBe('Show diff of test/new-a.ts');
  });

  it('is absent when no diff reader is wired', () => {
    expect(open().querySelector('.diff-open')).toBeNull();
  });
});

describe('diff in the review pane', () => {
  it('opens with the PR id and path, and reads that file of that PR', async () => {
    const read = vi.fn(async () => good(DIFF));
    const root = open(read);
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    expect(root.querySelector('.lt-review .lt-code-path')?.textContent).toBe('svc.ts src/ #24');
    expect(root.querySelector('.modal')).toBeNull();
    await flush();
    expect(read).toHaveBeenCalledWith('24', 'src/svc.ts');
  });

  it('renders numbered green and red rows and a hunk header', async () => {
    const root = open(async () => good(DIFF));
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    const rows = [...root.querySelectorAll('.lt-review .cl')];
    expect(rows.map((r) => r.className)).toEqual(['cl hunk', 'cl ctx', 'cl del', 'cl add', 'cl ctx']);
    expect(rows[0].textContent).toContain('function run()');
    const del = rows[2];
    expect([...del.querySelectorAll('.ln')].map((n) => n.textContent)).toEqual(['4', '']);
    expect(del.querySelector('.code')?.textContent).toBe('const old = 1;');
    const add = rows[3];
    expect([...add.querySelectorAll('.ln')].map((n) => n.textContent)).toEqual(['', '4']);
  });

  it('keeps HTML in the file content inert', async () => {
    const root = open(async () => good(DIFF));
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    const modal = root.querySelector('.lt-review') as HTMLElement;
    expect(modal.querySelector('img:not(.file-label-icon)')).toBeNull();
    expect(modal.querySelector('.cl.add .code')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps HTML in the path inert', async () => {
    const hostile = pr('25', { files: [{ path: 'src/<img src=x onerror=alert(2)>.ts', kind: 'modified', mapped: false }] });
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, mapOf({ nodes: NODES, prs: [hostile] }), { pr: '25', readPrDiff: async () => good(DIFF) }));
    (root.querySelector('.diff-open') as HTMLElement).click();
    await flush();
    expect(root.querySelector('img:not(.file-label-icon)')).toBeNull();
    expect(root.querySelector('.lt-review .lt-code-path')?.textContent).toContain('<img src=x onerror=alert(2)>');
  });

  it('stays put on Esc: the pane is not a dialog and the pull request stays selected', async () => {
    const root = open(async () => good(DIFF));
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.lt-review .cl')).not.toBeNull();
    expect(root.querySelector('.pr-head')).not.toBeNull();
    expect(root.querySelector('.lt-review')?.getAttribute('aria-modal')).toBeNull();
  });

  it.each([
    ['binary', good('', { binary: true }), 'Binary file'],
    ['truncated', good(DIFF, { truncated: true }), 'Diff too large'],
    ['unavailable', { ok: false, diff: '', truncated: false, binary: false, reason: 'this pull request was declined' } as PrFileDiff, 'Diff not available: this pull request was declined'],
  ])('shows a message for a %s diff', async (_name, res, text) => {
    const root = open(async () => res);
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-review .rv-code')?.textContent).toContain(text);
  });

  it('says which base the diff is against when a fallback base was used', async () => {
    const root = open(async () => good(DIFF, { against: { name: 'main', source: 'default' }, recordedBase: 'feat/parent' }));
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    const body = root.querySelector('.lt-review .rv-code') as HTMLElement;
    expect(body.textContent).toContain('Compared against main (the default line)');
    expect(body.textContent).toContain('the recorded base feat/parent is not available here');
    expect(body.querySelector('.cl.add')).not.toBeNull();
  });

  it('stays quiet about the base when the recorded one was used', async () => {
    const root = open(async () => good(DIFF));
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-review .rv-code')?.textContent).not.toContain('Compared against');
  });

  describe('when no base can be found', () => {
    const NONE: PrFileDiff = {
      ok: false,
      diff: '',
      truncated: false,
      binary: false,
      reason: 'the base branch feat/parent of this pull request no longer exists here',
      recordedBase: 'feat/parent',
      candidates: { bases: ['main', 'feat/other'], branches: ['feat/child', 'feat/other'] },
    };
    const pick = async (root: HTMLElement) => {
      (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
      await flush();
    };

    it('says why and offers the base and branch choices', async () => {
      const root = open(async () => NONE);
      await pick(root);
      const body = root.querySelector('.lt-review .rv-code') as HTMLElement;
      expect(body.textContent).toContain('Diff not available: the base branch feat/parent of this pull request no longer exists here');
      const selects = [...body.querySelectorAll<HTMLSelectElement>('.lt-diff-pick select')];
      expect(selects.map((s) => [...s.options].map((o) => o.value))).toEqual([['main', 'feat/other'], ['feat/child', 'feat/other']]);
      expect(body.textContent).toContain('the pull request record is not edited');
    });

    it('reads again with the chosen sides, remembers them for the next file, and can go back', async () => {
      const read = vi.fn(async (_pr: string, _path: string, sides?: { base?: string; branch?: string }) =>
        sides ? good(DIFF, { against: { name: sides.base!, source: 'chosen' }, recordedBase: 'feat/parent' }) : NONE);
      const root = open(read);
      await pick(root);
      const body = root.querySelector('.lt-review .rv-code') as HTMLElement;
      body.querySelectorAll<HTMLSelectElement>('.lt-diff-pick select')[0].value = 'feat/other';
      (body.querySelector('.lt-diff-pick button') as HTMLElement).click();
      await flush();
      expect(read).toHaveBeenLastCalledWith('24', 'src/svc.ts', { base: 'feat/other', branch: 'feat/child' });
      expect(body.textContent).toContain('Compared against feat/other (the base you chose)');
      expect(body.querySelector('.cl.add')).not.toBeNull();

      (root.querySelector('[data-pr-diff="src/gone.ts"]') as HTMLElement).click();
      await flush();
      expect(read).toHaveBeenLastCalledWith('24', 'src/gone.ts', { base: 'feat/other', branch: 'feat/child' });

      const undo = [...body.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Use the default comparison')!;
      undo.click();
      await flush();
      expect(read).toHaveBeenLastCalledWith('24', 'src/gone.ts');
      expect(body.querySelector('.lt-diff-pick')).not.toBeNull();
    });
  });

  it('shows a message when the reader fails', async () => {
    const root = open(async () => {
      throw new Error('boom');
    });
    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-review .rv-code')?.textContent).toContain('Diff not available');
  });

  it('deduplicates matching old/new limit notices after lexical highlighting', async () => {
    const oldSource = source('old');
    const newSource = source('new');
    const semantic = vi.fn(async (_path: string, semanticSource: CodeSource) => ({
      ok: false,
      source: semanticSource,
      spans: [],
      reason: 'historical semantic snapshot limit reached',
    }));
    const root = open(async () => good(DIFF, { oldSource, newSource }), semantic);

    (root.querySelector('[data-pr-diff="src/svc.ts"]') as HTMLElement).click();
    await flush();

    expect(root.querySelectorAll('.semantic-limit-notice')).toHaveLength(1);
    expect(root.querySelector('.semantic-limit-notice')?.nextElementSibling?.classList).toContain('cl');
    expect(root.querySelector('.cl.add .code')?.textContent).toContain('const fresh');
  });
});
