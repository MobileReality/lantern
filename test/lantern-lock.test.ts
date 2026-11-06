// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';

type Arrow = '>' | '<' | '=';

const rel = (from: string, arrow: Arrow, to: string) => ({ from, arrow, to, ext: null, symbol: null, label: '' });
const C = 'src/svc/centre.ts';

const MAP: LanternMap = mapOf({
  nodes: [node(C, 'service'), node('src/repo/in1.ts', 'repository'), node('src/repo/out1.ts', 'repository'), node('src/svc/far.ts', 'service'), node('src/other/lonely.ts', 'util')],
  relations: [rel(C, '<', 'src/repo/in1.ts'), rel(C, '>', 'src/repo/out1.ts'), rel('src/repo/out1.ts', '>', 'src/svc/far.ts')],
});

const mounted: { root: HTMLElement; dispose: () => void }[] = [];

function mount(data: LanternMap = MAP) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, data);
  mounted.push({ root, dispose: view.dispose });
  return { root, view };
}

const nodeG = (root: HTMLElement, name: string) => [...root.querySelectorAll('.lt-pixi-node-access')].find((g) => g.textContent?.endsWith(name)) as SVGGElement;
const click = (root: HTMLElement, name: string) => nodeG(root, name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const relToggle = (root: HTMLElement) => root.querySelector('.lt-rvtoggle') as HTMLButtonElement;
const lockBtn = (root: HTMLElement) => root.querySelector('.lt-lock') as HTMLButtonElement;
const labels = (nodes: Element[]) => nodes.map((node) => node.textContent?.split('/').pop());
const analysed = (root: HTMLElement) => labels([...root.querySelectorAll('.lt-pixi-node-access[aria-pressed="true"]')]);
const inspected = (root: HTMLElement) => labels([...root.querySelectorAll('.lt-pixi-node-access.insp')]);
const locks = (root: HTMLElement) => labels([...root.querySelectorAll('.lt-pixi-node-access.locked')]);
const detailPath = (root: HTMLElement) => root.querySelector('.lt-detail .path .file-label')?.getAttribute('data-tip') ?? '';
const escape = (root: HTMLElement) => root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const at = (root: HTMLElement, name: string) => {
  const node = nodeG(root, name) as unknown as HTMLElement;
  return `${node.dataset.graphX},${node.dataset.graphY}`;
};

function searchFor(root: HTMLElement, q: string) {
  vi.useFakeTimers();
  const input = root.querySelector('.search') as HTMLInputElement;
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(300);
  vi.useRealTimers();
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.dispose();
    entry.root.remove();
  }
  vi.useRealTimers();
});

describe('lock in the normal graph', () => {
  it('offers the lock only with a selection, and shows its state', () => {
    const { root } = mount();
    expect(lockBtn(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.lt-lockbar button')).toBeNull();
    click(root, 'centre.ts');
    expect(lockBtn(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(false);
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    lockBtn(root).click();
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(lockBtn(root).textContent).toBe('Locked');
    expect(root.querySelector('.lt-lockbar .lock-name')?.textContent).toBe('Locked on centre.ts');
    expect(locks(root)).toEqual(['centre.ts']);
  });

  it('keeps the same selected file when locked', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    expect(analysed(root)).toEqual(['centre.ts']);
  });

  it('keeps the analysed file and its edges when other files are clicked, and inspects them', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    const home = at(root, 'centre.ts');
    const rest = at(root, 'lonely.ts');
    click(root, 'out1.ts');
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(inspected(root)).toEqual(['out1.ts']);
    expect(detailPath(root)).toContain('out1.ts');
    expect(root.querySelector('.lt-detail.insp')).not.toBeNull();
    click(root, 'lonely.ts');
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(inspected(root)).toEqual(['lonely.ts']);
    expect(detailPath(root)).toContain('lonely.ts');
    expect(at(root, 'centre.ts')).toBe(home);
    expect(at(root, 'lonely.ts')).toBe(rest);
    expect(locks(root)).toEqual(['centre.ts']);
  });

  it('inspects from the side panel relation links without moving the lock', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    (root.querySelector('.lt-detail li button[data-go="src/repo/out1.ts"]') as HTMLElement).click();
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(detailPath(root)).toContain('out1.ts');
    expect(root.querySelector('.lt-lockbar .lock-insp')?.textContent).toContain('out1.ts');
  });

  it('clicking the inspected file again, or the locked file, goes back to the locked detail', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    click(root, 'out1.ts');
    click(root, 'out1.ts');
    expect(inspected(root)).toEqual([]);
    expect(detailPath(root)).toContain('centre.ts');
    click(root, 'out1.ts');
    click(root, 'centre.ts');
    expect(inspected(root)).toEqual([]);
    expect(analysed(root)).toEqual(['centre.ts']);
  });

  it('unlocks to the normal behaviour: the next click picks a new file', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    click(root, 'out1.ts');
    (root.querySelector('.lt-lockbar .lock-on button') as HTMLElement).click();
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    expect(locks(root)).toEqual([]);
    expect(inspected(root)).toEqual([]);
    expect(analysed(root)).toEqual(['centre.ts']);
    click(root, 'out1.ts');
    expect(analysed(root)).toEqual(['out1.ts']);
    expect(detailPath(root)).toContain('out1.ts');
  });

  it('moves the lock to the inspected file on request', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    click(root, 'out1.ts');
    (root.querySelector('[data-lock-move]') as HTMLElement).click();
    expect(analysed(root)).toEqual(['out1.ts']);
    expect(locks(root)).toEqual(['out1.ts']);
    expect(inspected(root)).toEqual([]);
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    click(root, 'centre.ts');
    expect(analysed(root)).toEqual(['out1.ts']);
  });

  it('toggles with the L key, and ignores it while typing', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    const search = root.querySelector('.search') as HTMLInputElement;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', bubbles: true }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores a held L key', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', repeat: true, bubbles: true }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('does nothing on L without a selection', () => {
    const { root } = mount();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    click(root, 'centre.ts');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Escape and empty space while locked', () => {
  function locked() {
    const mountedView = mount();
    click(mountedView.root, 'centre.ts');
    lockBtn(mountedView.root).click();
    return mountedView.root;
  }

  it('clears the inspection first, then leaves the lock and the selection alone', () => {
    const root = locked();
    click(root, 'out1.ts');
    escape(root);
    expect(inspected(root)).toEqual([]);
    expect(detailPath(root)).toContain('centre.ts');
    expect(analysed(root)).toEqual(['centre.ts']);
    escape(root);
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(detailPath(root)).toContain('centre.ts');
  });

  it('clears only the inspection when empty space is clicked, and keeps the selection when nothing is inspected', () => {
    const root = locked();
    click(root, 'out1.ts');
    escape(root);
    expect(inspected(root)).toEqual([]);
    expect(analysed(root)).toEqual(['centre.ts']);
    escape(root);
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('has no close button on the locked detail, so the selection cannot be cleared silently', () => {
    const root = locked();
    expect(root.querySelector('.lt-detail .close')).toBeNull();
    click(root, 'out1.ts');
    expect((root.querySelector('.lt-detail .close') as HTMLElement).getAttribute('aria-label')).toBe('Stop inspecting');
    (root.querySelector('.lt-detail .close') as HTMLElement).click();
    expect(inspected(root)).toEqual([]);
    expect(analysed(root)).toEqual(['centre.ts']);
  });

  it('leaves Escape alone when nothing is locked and nothing is open', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    escape(root);
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('lock in the relation view', () => {
  function open() {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    relToggle(root).click();
    return root;
  }

  it('keeps the lock when switching to the relation view and back', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    relToggle(root).click();
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(locks(root)).toEqual(['centre.ts']);
    relToggle(root).click();
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(locks(root)).toEqual(['centre.ts']);
  });

  it('inspects a clicked neighbour without re-centring, and keeps every card and edge in place', () => {
    const root = open();
    const names = labels([...root.querySelectorAll('.lt-pixi-node-access')]);
    const home = at(root, 'centre.ts');
    const neighbour = at(root, 'out1.ts');
    click(root, 'out1.ts');
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(labels([...root.querySelectorAll('.lt-pixi-node-access')])).toEqual(names);
    expect(at(root, 'centre.ts')).toBe(home);
    expect(at(root, 'out1.ts')).toBe(neighbour);
    expect(inspected(root)).toEqual(['out1.ts']);
    expect(detailPath(root)).toContain('out1.ts');
    expect(locks(root)).toEqual(['centre.ts']);
    click(root, 'in1.ts');
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(inspected(root)).toEqual(['in1.ts']);
    expect(relToggle(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves the view with Escape only after the inspection is cleared, and stays locked', () => {
    const root = open();
    click(root, 'out1.ts');
    escape(root);
    expect(relToggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(inspected(root)).toEqual([]);
    escape(root);
    expect(relToggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(analysed(root)).toEqual(['centre.ts']);
  });

  it('drops the inspection ring when the view is left and keeps it for a visible file', () => {
    const root = open();
    click(root, 'out1.ts');
    relToggle(root).click();
    expect(analysed(root)).toEqual(['centre.ts']);
    expect(inspected(root)).toEqual(['out1.ts']);
    expect(detailPath(root)).toContain('out1.ts');
  });

  it('re-centres again after unlocking', () => {
    const root = open();
    (root.querySelector('.lt-lockbar .lock-on button') as HTMLElement).click();
    click(root, 'out1.ts');
    expect(analysed(root)).toEqual(['out1.ts']);
  });
});

describe('lock and filters', () => {
  it('survives a search that keeps the file visible', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    searchFor(root, 'svc');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(locks(root)).toEqual(['centre.ts']);
    expect(analysed(root)).toEqual(['centre.ts']);
  });

  it('unlocks and says so when a search hides the locked file', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    searchFor(root, 'repo');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lt-lockbar .lock-note')?.textContent).toBe('centre.ts is hidden by the filters, so it is unlocked.');
    expect(root.querySelector('.lt-lockbar .lock-on')).toBeNull();
    click(root, 'in1.ts');
    expect(analysed(root)).toEqual(['in1.ts']);
    expect(root.querySelector('.lock-note')).toBeNull();
  });

  it('unlocks the relation view as it closes it, when a role filter hides the locked file', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    relToggle(root).click();
    (root.querySelector('[data-role="repository"]') as HTMLElement).click();
    expect(relToggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lock-note')?.textContent).toContain('centre.ts');
  });

  it('shows the locked file again as a normal selection when a search hides it during an inspection', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    click(root, 'in1.ts');
    searchFor(root, 'repo');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lt-lockbar .lock-insp')).toBeNull();
    expect(root.querySelector('.lt-detail.insp')).toBeNull();
    expect(detailPath(root)).toContain('centre.ts');
    expect((root.querySelector('.lt-detail .close') as HTMLElement).getAttribute('aria-label')).toBe('Close details');
  });

  it('keeps the lock after the search is cleared again when the file stayed visible', () => {
    const { root } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    searchFor(root, 'svc');
    searchFor(root, '');
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('true');
    expect(analysed(root)).toEqual(['centre.ts']);
  });

  it('drops the lock with a data update that removes the locked file', () => {
    const { root, view } = mount();
    click(root, 'centre.ts');
    lockBtn(root).click();
    view.update(mapOf({ nodes: MAP.nodes.filter((n) => n.path !== C), relations: [] }));
    expect(lockBtn(root).getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lock-note')?.textContent).toContain('no longer in the map');
  });
});
