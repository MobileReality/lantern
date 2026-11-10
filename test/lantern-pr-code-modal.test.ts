// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrFile } from '../src/main/lantern-prfile';
import type { CodeSource } from '../src/shared/code-highlighting';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';
import { openPrFile } from './helpers/pr-rows';

const PR = pr('24', {
  files: [
    { path: 'test/new-a.ts', kind: 'added', mapped: false },
    { path: 'src/svc.ts', kind: 'modified', mapped: true },
    { path: 'src/gone.ts', kind: 'removed', mapped: false },
  ],
});

const good = (text: string, extra: Partial<PrFile> = {}): PrFile => ({ ok: true, text, truncated: false, binary: false, version: 'branch', ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));
const source: CodeSource = { token: 'token', kind: 'revision', revision: 'a'.repeat(40), contentHash: 'hash' };
const mounted: ReturnType<typeof mountLanternView>[] = [];

function open(readPrFile?: (pr: string, path: string) => Promise<PrFile>, readSemantic?: Parameters<typeof mountLanternView>[2]['readSemantic']) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [PR] }), { pr: '24', readPrFile, readFile: async () => ({ exists: true, text: 'live', truncated: 0 }), readSemantic }));
  return root;
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

describe('pull request file version from a row', () => {
  it('makes every row, in the map or not, the one click target, with no code buttons', async () => {
    const read = vi.fn(async () => good('x'));
    const root = open(read);
    const off = [...root.querySelectorAll('.pr-file.off')];
    expect(off).toHaveLength(2);
    for (const row of off) expect(row.querySelectorAll('button')).toHaveLength(1);
    expect(off.map((row) => row.querySelector('button.pr-path')?.getAttribute('data-pr-go'))).toEqual(['test/new-a.ts', 'src/gone.ts']);
    const live = root.querySelector('.pr-file:not(.off)') as HTMLElement;
    expect(live.querySelectorAll('button')).toHaveLength(1);
    expect(live.querySelector('button.pr-path[data-pr-go="src/svc.ts"]')).not.toBeNull();
    expect(root.querySelector('.pr-file [data-pr-code], .pr-file [data-code], .pr-file .code-open')).toBeNull();
    openPrFile(root, 'src/gone.ts', 'file');
    await flush();
    expect(read).toHaveBeenCalledWith('24', 'src/gone.ts');
    expect(root.querySelector('.lt-review .file-name')?.textContent).toBe('gone.ts');
  });

  it('gives a not-in-map row no click target when the reader is not wired', () => {
    const root = open();
    expect(root.querySelectorAll('.pr-file.off')).toHaveLength(2);
    expect(root.querySelector('.pr-file.off button')).toBeNull();
    expect(root.querySelector('[data-pr-code]')).toBeNull();
  });

  it('opens the modal with the version note and the file text', async () => {
    const read = vi.fn(async () => good('const a = 1;\n'));
    const root = open(read);
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    expect(read).toHaveBeenCalledWith('24', 'test/new-a.ts');
    expect(root.querySelector('.lt-code-note')?.textContent).toBe('PR #24 branch version');
    expect(root.querySelector('.lt-code-body')?.textContent).toContain('const a = 1;');
  });

  it('notes the before-PR version for a removed file', async () => {
    const root = open(async () => good('old\n', { version: 'before' }));
    openPrFile(root, 'src/gone.ts', 'file');
    await flush();
    expect(root.querySelector('.lt-code-note')?.textContent).toBe('version before PR #24');
  });

  it('forwards pull request source provenance to semantic highlighting', async () => {
    const semantic = vi.fn(async () => ({ ok: true, source, spans: [] }));
    const root = open(async () => good('const a = 1;\n', { source }), semantic);

    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();

    expect(semantic).toHaveBeenCalledWith('test/new-a.ts', source);
  });

  it.each([
    ['revision snapshot exceeds the preview safety limit', 'this revision exceeds the preview size or file limit'],
    ['historical semantic snapshot limit reached', 'too many historical revisions are open'],
  ])('explains the semantic limit while keeping the file visible: %s', async (reason, message) => {
    const semantic = vi.fn(async () => ({ ok: false, source, spans: [], reason }));
    const root = open(async () => good('const a = 1;\n', { source }), semantic);

    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();

    expect(root.querySelector('.lt-code-body')?.textContent).toContain('const a = 1;');
    expect(root.querySelector('.semantic-limit-notice[role="status"]')?.textContent).toContain(message);
  });

  it('does not expose arbitrary semantic failures', async () => {
    const semantic = vi.fn(async () => ({ ok: false, source, spans: [], reason: 'server exploded' }));
    const root = open(async () => good('const a = 1;\n', { source }), semantic);

    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();

    expect(root.querySelector('.semantic-limit-notice')).toBeNull();
    expect(root.textContent).not.toContain('server exploded');
  });

  it('does not show a limit notice for a successful semantic result', async () => {
    const semantic = vi.fn(async () => ({ ok: true, source, spans: [], reason: 'historical semantic snapshot limit reached' }));
    const root = open(async () => good('const a = 1;\n', { source }), semantic);

    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();

    expect(root.querySelector('.semantic-limit-notice')).toBeNull();
  });

  it('keeps HTML in the file inert', async () => {
    const root = open(async () => good('<img src=x onerror=alert(1)>\n'));
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    expect(root.querySelector('.lt-code-modal img:not(.file-label-icon)')).toBeNull();
    expect(root.querySelector('.lt-code-body')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows File not available with the reason', async () => {
    const root = open(async () => ({ ok: false, text: '', truncated: false, binary: false, version: 'branch', reason: 'declined' }));
    openPrFile(root, 'test/new-a.ts', 'file');
    await flush();
    expect(root.querySelector('.lt-code-body')?.textContent).toContain('File not available: declined');
  });

  it('Esc closes only the modal', () => {
    const root = open(async () => good('x'));
    openPrFile(root, 'test/new-a.ts', 'file');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(root.querySelector('.lt-code-modal')).toBeNull();
    expect(root.querySelector('.pr-head')).not.toBeNull();
  });
});
