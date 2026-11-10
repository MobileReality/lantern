// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrFileDiff, PrFileStats } from '../src/main/lantern-prdiff';
import { parseDiffRows } from '../src/renderer/lib/codeview';
import { planDiff } from '../src/renderer/lib/diffcollapse';
import { diffLexicalLines, renderDiff } from '../src/renderer/lib/diffview';
import { CODE_HL_MAX_BYTES } from '../src/shared/code-preview';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { fullContextDiff, numbered, pureAddDiff, pureRemoveDiff } from './helpers/diff-text';
import { mapOf, node, pr } from './helpers/lantern-map';
import { openPrFile } from './helpers/pr-rows';
import { highlightLines } from '../src/renderer/lib/syntax-highlighting';

beforeAll(() => vi.stubGlobal('Worker', class {
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage(request: { id: number; items: { lang: string; text: string }[] }) {
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, lines: request.items.map((item) => highlightLines(item.text, item.lang)) } } as MessageEvent));
  }
  terminate() {}
}));

const good = (diff: string, extra: Partial<PrFileDiff> = {}): PrFileDiff => ({ ok: true, diff, truncated: false, binary: false, ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];

async function view(diff: string, showAll = false) {
  const rows = parseDiffRows(diff);
  const host = document.createElement('div');
  host.appendChild(renderDiff(rows, await diffLexicalLines(rows, 'typescript'), planDiff(rows, !showAll)));
  document.body.appendChild(host);
  return host;
}

const lines = [...numbered(3), 'export class Store {', '  async load(id: string) {', ...numbered(70, '    '), '  }', '}'];
const MIXED = fullContextDiff(lines, [{ line: 40, to: '    const changed = true;' }]);

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

describe('row rendering', async () => {
  it('keeps multiline grammar state independently for old and new hunk sides', async () => {
    const rows = parseDiffRows(['@@ -1,3 +1,3 @@', ' /*', '-old value', '+new value', ' */'].join('\n'));
    const lexical = await diffLexicalLines(rows, 'typescript');
    expect(lexical.get(2)).toContain('#8B94AD');
    expect(lexical.get(3)).toContain('#8B94AD');
  });

  it('colours added and removed rows and renders no +/- marker', async () => {
    const host = await view(fullContextDiff(numbered(8), [{ line: 4, to: 'const fresh = 1;' }]));
    const add = host.querySelector('.cl.add') as HTMLElement;
    const del = host.querySelector('.cl.del') as HTMLElement;
    expect(add.querySelector('.code')?.textContent).toBe('const fresh = 1;');
    expect(del.querySelector('.code')?.textContent).toBe('const line4 = 4;');
    for (const row of host.querySelectorAll('.cl')) {
      expect(row.querySelectorAll('.ln')).toHaveLength(2);
      expect(row.textContent?.startsWith('+')).toBe(false);
      expect(row.textContent?.startsWith('-')).toBe(false);
      expect(row.querySelector('.mark, .sign')).toBeNull();
    }
    expect([...add.querySelectorAll('.ln')].map((n) => n.textContent)).toEqual(['', '4']);
    expect([...del.querySelectorAll('.ln')].map((n) => n.textContent)).toEqual(['4', '']);
  });

  it('labels changed rows for assistive tech and leaves context unlabelled', async () => {
    const host = await view(fullContextDiff(numbered(8), [{ line: 4, to: 'x' }]));
    const add = host.querySelector('.cl.add') as HTMLElement;
    const del = host.querySelector('.cl.del') as HTMLElement;
    expect([add.dataset.tip, add.getAttribute('aria-label')]).toEqual(['added', 'added']);
    expect([del.dataset.tip, del.getAttribute('aria-label')]).toEqual(['removed', 'removed']);
    expect(host.querySelector('.cl.ctx')?.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps HTML inert in added and removed code', async () => {
    const diff = fullContextDiff(['<b>old</b>'], [{ line: 1, to: '<img src=x onerror=alert(1)>' }]);
    const host = await view(diff);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.cl.add .code')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(host.querySelector('.cl.del .code')?.textContent).toBe('<b>old</b>');
  });
});

describe('collapsed context', async () => {
  it('shows an expander with the hidden count and the enclosing scope above the change', async () => {
    const host = await view(MIXED);
    const kids = [...host.children] as HTMLElement[];
    const classes = kids.map((k) => (k.classList.contains('df-fold') ? 'fold' : k.className.replace('cl ', '')));
    expect(classes).toEqual(['fold', 'ctx', 'del', 'add', 'ctx', 'fold']);
    const lead = kids[0];
    expect(lead.querySelector('.df-more')?.textContent).toBe('38 unchanged lines');
    const scope = lead.querySelector('.cl.scope') as HTMLElement;
    expect(scope.textContent).toContain('async load(id: string) {');
    expect(scope.hidden).toBe(false);
    expect(kids[5].querySelector('.cl.scope')).toBeNull();
  });

  it('shows far fewer rows than the diff has lines', async () => {
    const host = await view(MIXED);
    const total = parseDiffRows(MIXED).length;
    expect(host.querySelectorAll('.cl:not(.fold):not(.scope)')).toHaveLength(4);
    expect(total).toBeGreaterThan(70);
  });

  it('does not offer an expander for one or two unchanged lines', async () => {
    const near = fullContextDiff(numbered(20), [{ line: 6, to: 'a' }, { line: 10, to: 'b' }]);
    const host = await view(near);
    expect(host.querySelectorAll('.df-fold')).toHaveLength(2);
    expect(host.textContent).toContain('const line8 = 8;');
  });

  it('shows new and removed files in full with no expander', async () => {
    for (const diff of [pureAddDiff(numbered(120)), pureRemoveDiff(numbered(120))]) {
      document.body.textContent = '';
      const host = await view(diff);
      expect(host.querySelectorAll('.df-fold, .cl.fold')).toHaveLength(0);
      expect(host.querySelectorAll('.cl.add, .cl.del')).toHaveLength(120);
    }
  });
});

describe('expanders', async () => {
  const more = (host: HTMLElement) => host.querySelector('.df-more') as HTMLButtonElement;

  it('expands in steps of 20 from the edge nearest the change and re-collapses', async () => {
    const host = await view(MIXED);
    const lead = host.querySelector('.df-fold') as HTMLElement;
    more(host).click();
    expect(lead.querySelectorAll('.cl.ctx')).toHaveLength(20);
    expect(more(host).textContent).toBe('18 more unchanged lines');
    const shown = [...lead.querySelectorAll('.cl.ctx .ln')].filter((n) => n.textContent).map((n) => Number(n.textContent));
    expect(Math.max(...shown)).toBe(38);
    more(host).click();
    expect(lead.querySelectorAll('.cl.ctx')).toHaveLength(38);
    expect(lead.querySelector('.df-more')).toBeNull();
    (lead.querySelector('.df-less') as HTMLElement).click();
    expect(lead.querySelectorAll('.cl.ctx')).toHaveLength(0);
    expect(more(host).textContent).toBe('38 unchanged lines');
    expect(more(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps multiline token colors when hidden context is revealed', async () => {
    const source = ['/*', ...Array.from({ length: 60 }, (_, index) => `comment ${index}`), '*/'];
    const host = await view(fullContextDiff(source, [{ line: 40, to: 'changed comment' }]));
    (host.querySelector('.df-more') as HTMLButtonElement).click();
    const revealedComment = [...host.querySelectorAll<HTMLElement>('.df-fold .cl.ctx .code')].find((line) => line.textContent?.includes('comment'));
    expect(revealedComment?.innerHTML).toContain('#8B94AD');
  });

  it('expands everything at once with Show all', async () => {
    const host = await view(MIXED);
    const lead = host.querySelector('.df-fold') as HTMLElement;
    (lead.querySelector('.df-all') as HTMLElement).click();
    expect(lead.querySelectorAll('.cl.ctx')).toHaveLength(38);
    expect(lead.querySelector('.df-less')?.textContent).toBe('Collapse 38 unchanged lines');
  });

  it('expands a short run in one click', async () => {
    const host = await view(fullContextDiff(numbered(30), [{ line: 15, to: 'x' }]));
    const lead = host.querySelector('.df-fold') as HTMLElement;
    expect(lead.querySelector('.df-all')).toBeNull();
    more(host).click();
    expect(lead.querySelectorAll('.cl.ctx')).toHaveLength(13);
  });

  it('hides the scope row once its own line is on screen', async () => {
    const host = await view(MIXED);
    const lead = host.querySelector('.df-fold') as HTMLElement;
    const scope = lead.querySelector('.cl.scope') as HTMLElement;
    (lead.querySelector('.df-all') as HTMLElement).click();
    expect(scope.hidden).toBe(true);
    (lead.querySelector('.df-less') as HTMLElement).click();
    expect(scope.hidden).toBe(false);
  });
});

describe('keyboard', async () => {
  it('uses real buttons that are reachable by Tab and keep focus after they act', async () => {
    const host = await view(MIXED);
    const lead = host.querySelector('.df-fold') as HTMLElement;
    const buttons = [...lead.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(1);
    for (const b of buttons) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.type).toBe('button');
      expect(b.tabIndex).toBe(0);
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
    (lead.querySelector('.df-more') as HTMLButtonElement).focus();
    (lead.querySelector('.df-more') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(lead.querySelector('.df-more'));
    (lead.querySelector('.df-more') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(lead.querySelector('.df-less'));
    (lead.querySelector('.df-less') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(lead.querySelector('.df-more'));
  });
});

describe('large diffs', async () => {
  it('uses escaped fallback when a hunk side exceeds the byte cap', async () => {
    const rows = parseDiffRows(`@@ -1,1 +1,1 @@\n-${'x'.repeat(CODE_HL_MAX_BYTES)}<old>\n+${'y'.repeat(CODE_HL_MAX_BYTES)}<new>`);
    const lexical = await diffLexicalLines(rows, 'typescript');
    expect(lexical.get(1)).toContain('&lt;old&gt;');
    expect(lexical.get(1)).not.toContain('<span');
    expect(lexical.get(2)).toContain('&lt;new&gt;');
    expect(lexical.get(2)).not.toContain('<span');
  });

  it('renders a few thousand lines of context as a handful of rows', async () => {
    const big = numbered(2400, '  ');
    const edits = Array.from({ length: 12 }, (_, i) => ({ line: 100 + i * 190, to: `  const changed${i} = true;` }));
    const diff = fullContextDiff(['function big() {', ...big], edits);
    const rows = parseDiffRows(diff);
    const host = await view(diff);
    const painted = host.querySelectorAll('.cl:not(.fold):not(.scope)').length;
    expect(rows.length).toBeGreaterThan(2400);
    expect(painted).toBeLessThan(80);
    expect(host.querySelectorAll('.cl.scope')).toHaveLength(12);
  }, 60_000);

  it('builds the lines of a region only when it is expanded', async () => {
    const diff = fullContextDiff(numbered(2000), [{ line: 1000, to: 'x' }]);
    const host = await view(diff);
    expect(host.querySelectorAll('.cl.ctx').length).toBeLessThan(5);
    (host.querySelector('.df-more') as HTMLElement).click();
    expect(host.querySelectorAll('.cl.ctx').length).toBeLessThan(30);
  });
});

describe('diff chrome in the review pane', async () => {
  const NODES = [node('src/svc.ts', 'service'), node('src/page.tsx', 'page')];
  const PR = pr('24', {
    files: [
      { path: 'src/svc.ts', kind: 'modified', mapped: true },
      { path: 'src/new.ts', kind: 'added', mapped: false },
    ],
  });

  function open(diffs: Record<string, string>, stats?: PrFileStats) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, mapOf({ nodes: NODES, prs: [PR] }), { pr: '24', readPrDiff: async (_pr, path) => good(diffs[path]), ...(stats ? { readPrStats: async () => stats } : {}) }));
    return root;
  }
  const toggle = (root: HTMLElement) => root.querySelector('.lt-diff-fold') as HTMLButtonElement;
  const openFile = async (root: HTMLElement, path: string) => {
    openPrFile(root, path, 'diff');
    await flush();
  };

  it('summarises added and removed lines in the header from the pull request stats', async () => {
    const root = open({ 'src/svc.ts': MIXED }, { 'src/svc.ts': { added: 1, removed: 1 } });
    await openFile(root, 'src/svc.ts');
    await vi.waitFor(() => expect(root.querySelector('.lt-review-path .lt-diff-stat')?.textContent).toBe('+1 −1'));
    expect(root.querySelectorAll('.lt-review .lt-diff-stat')).toHaveLength(1);
  });

  it('shows no line counts in the header without pull request stats', async () => {
    const root = open({ 'src/svc.ts': MIXED });
    await openFile(root, 'src/svc.ts');
    expect(root.querySelector('.lt-review .lt-diff-stat')).toBeNull();
  });

  it('opens collapsed and the toggle shows every line, then collapses again', async () => {
    const root = open({ 'src/svc.ts': MIXED });
    await openFile(root, 'src/svc.ts');
    expect(toggle(root).hidden).toBe(false);
    expect(toggle(root).getAttribute('aria-label')).toBe('Show all lines');
    expect(root.querySelectorAll('.lt-review .df-fold')).toHaveLength(2);
    toggle(root).click();
    expect(root.querySelectorAll('.lt-review .df-fold')).toHaveLength(0);
    expect(root.querySelectorAll('.lt-review .cl.ctx').length).toBe(parseDiffRows(MIXED).filter((r) => r.type === 'ctx').length);
    expect(toggle(root).getAttribute('aria-label')).toBe('Collapse unchanged lines');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    toggle(root).click();
    expect(root.querySelectorAll('.lt-review .df-fold')).toHaveLength(2);
  });

  it('remembers the choice for the next diff shown in the session', async () => {
    const root = open({ 'src/svc.ts': MIXED, 'src/new.ts': MIXED });
    await openFile(root, 'src/svc.ts');
    toggle(root).click();
    await openFile(root, 'src/new.ts');
    expect(root.querySelectorAll('.lt-review .df-fold')).toHaveLength(0);
    expect(toggle(root).getAttribute('aria-label')).toBe('Collapse unchanged lines');
    toggle(root).click();
    await openFile(root, 'src/svc.ts');
    expect(root.querySelectorAll('.lt-review .df-fold')).toHaveLength(2);
  });

  it('hides the toggle for a diff with nothing to collapse', async () => {
    const root = open({ 'src/new.ts': pureAddDiff(numbered(50)) });
    await openFile(root, 'src/new.ts');
    expect(toggle(root).hidden).toBe(true);
    expect(root.querySelectorAll('.lt-review .cl.add')).toHaveLength(50);
  });
});
