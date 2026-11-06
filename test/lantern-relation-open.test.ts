// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const C = 'src/svc/centre.ts';
const CHANGED = 'src/repo/changed.ts';
const UNCHANGED = 'src/repo/unchanged.ts';
const SPEC = 'test/centre.test.ts';

const map = (withPr: boolean) => mapOf({
  nodes: [node(C, 'service'), node(CHANGED, 'repository'), node(UNCHANGED, 'repository'), node(SPEC, 'test')],
  relations: [CHANGED, UNCHANGED, SPEC].map((to) => ({ from: C, arrow: '>' as const, to, ext: null, symbol: null, label: '' })),
  prs: withPr ? [pr('24', { files: [{ path: CHANGED, kind: 'modified', mapped: true }, { path: SPEC, kind: 'added', mapped: true }] })] : [],
});

const mounted: ReturnType<typeof mountLanternView>[] = [];
const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(withPr: boolean) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const readFile = vi.fn(async () => ({ exists: true, text: 'live', truncated: 0 }));
  const readPrDiff = vi.fn(async () => ({ ok: true as const, diff: '', truncated: false, binary: false }));
  mounted.push(mountLanternView(root, map(withPr), { ...(withPr ? { pr: '24' } : {}), readFile, readPrDiff }));
  const tile = (path: string) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].find((el) => el.getAttribute('aria-label') === path) as HTMLElement;
  const opener = (kind: 'code' | 'diff', path: string) => root.querySelector<HTMLButtonElement>(`.lt-pixi-open-access[data-open-kind="${kind}"][data-open-path="${path}"]`);
  return { root, tile, opener, readFile, readPrDiff };
}

function relationView(withPr: boolean) {
  const view = mount(withPr);
  view.tile(C).click();
  (view.root.querySelector('.lt-rvtoggle') as HTMLButtonElement).click();
  return view;
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

describe('opening a file from its tile in the relation view', () => {
  it('offers code and diff on a tile for a file in the pull request', () => {
    const { opener } = relationView(true);
    expect(opener('code', CHANGED)).not.toBeNull();
    expect(opener('diff', CHANGED)).not.toBeNull();
    expect(opener('code', CHANGED)?.getAttribute('aria-label')).toBe(`Open code of ${CHANGED}`);
    expect(opener('diff', CHANGED)?.getAttribute('aria-label')).toBe(`Open diff of ${CHANGED}`);
  });

  it('offers code and diff on a test file that is in the pull request', () => {
    const { opener } = relationView(true);
    expect(opener('code', SPEC)).not.toBeNull();
    expect(opener('diff', SPEC)).not.toBeNull();
  });

  it('offers code only on a tile for a file outside the pull request', () => {
    const { opener } = relationView(true);
    expect(opener('code', UNCHANGED)).not.toBeNull();
    expect(opener('diff', UNCHANGED)).toBeNull();
  });

  it('offers code only on every tile when no pull request is shown', () => {
    const { root, opener } = relationView(false);
    expect(opener('code', C)).not.toBeNull();
    expect(root.querySelector('[data-open-kind="diff"]')).toBeNull();
  });

  it('shows that file and its diff in the review pane', async () => {
    const { root, opener, readFile, readPrDiff } = relationView(true);
    opener('code', CHANGED)?.click();
    await flush();
    expect(readFile).toHaveBeenCalledWith(CHANGED);
    expect(root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip')).toBe(CHANGED);
    expect(root.querySelector('.lt-review .lt-review-mode[aria-pressed="true"]')?.textContent).toBe('File');
    opener('diff', CHANGED)?.click();
    await flush();
    expect(readPrDiff).toHaveBeenCalledWith('24', CHANGED);
    expect(root.querySelector('.lt-review .lt-review-mode[aria-pressed="true"]')?.textContent).toBe('Diff');
    expect(root.querySelector('.lt-code-modal, .lt-diff-modal')).toBeNull();
  });

  it('keeps a plain click on a tile selecting it, without opening a viewer', () => {
    const { root, tile } = relationView(true);
    tile(CHANGED).click();
    expect(tile(CHANGED).getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.lt-code-modal, .lt-diff-modal')).toBeNull();
  });

  it('shows no open buttons outside the relation view', () => {
    const { root } = mount(true);
    expect(root.querySelector('.lt-pixi-open-access')).toBeNull();
  });
});
