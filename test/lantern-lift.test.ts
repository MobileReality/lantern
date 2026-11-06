// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { MOVE_MS } from '../src/renderer/lib/lanternmove';

const rel = (from: string, arrow: '>' | '<' | '=', to: string) => ({ from, arrow, to, ext: null, symbol: null, label: '' });

const SVC = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => node(`src/svc/${n}.ts`, 'service'));
const REPO = ['r1', 'r2', 'r3', 'r4'].map((n) => node(`src/repo/${n}.ts`, 'repository'));
const UTIL = ['u1', 'u2', 'u3'].map((n) => node(`src/util/${n}.ts`, 'util'));

const MAP: LanternMap = mapOf({
  nodes: [...SVC, ...REPO, ...UTIL],
  relations: [rel('src/svc/f.ts', '>', 'src/repo/r3.ts'), rel('src/svc/f.ts', '>', 'src/repo/r4.ts'), rel('src/svc/e.ts', '>', 'src/svc/f.ts'), rel('src/svc/a.ts', '>', 'src/repo/r1.ts')],
});

const mounted: { root: HTMLElement; view: ReturnType<typeof mountLanternView> }[] = [];

function mount(data: LanternMap = MAP) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, data);
  mounted.push({ root, view });
  return root;
}

const nodeG = (root: HTMLElement, name: string) => [...root.querySelectorAll('.lt-pixi-node-access')].find((g) => g.textContent === name) as SVGGElement;
const click = (root: HTMLElement, name: string) => nodeG(root, name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const at = (root: HTMLElement, name: string) => {
  const node = nodeG(root, name) as unknown as HTMLElement;
  return { x: Number(node.dataset.graphX), y: Number(node.dataset.graphY) };
};
const ys = (root: HTMLElement, names: string[]) => names.map((n) => at(root, n).y);
const column = (root: HTMLElement, names: string[]) => [...names].sort((a, b) => at(root, a).y - at(root, b).y);
const layout = (root: HTMLElement) => Object.fromEntries([...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].map((button) => [button.textContent, `${button.dataset.graphX},${button.dataset.graphY}`]));
const SVC_NAMES = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
const REPO_NAMES = ['r1.ts', 'r2.ts', 'r3.ts', 'r4.ts'];

function reduceMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }));
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.view.dispose();
    entry.root.remove();
  }
  vi.unstubAllGlobals();
});

describe('related elements rise to the top of their columns', () => {
  it('puts the clicked node and its related nodes first in every column, in their original order', () => {
    const root = mount();
    expect(column(root, SVC_NAMES)).toEqual(SVC_NAMES);
    click(root, 'f.ts');
    expect(column(root, SVC_NAMES)).toEqual(['e.ts', 'f.ts', 'a.ts', 'b.ts', 'c.ts', 'd.ts']);
    expect(column(root, REPO_NAMES)).toEqual(['r3.ts', 'r4.ts', 'r1.ts', 'r2.ts']);
  });

  it('leaves a column without related nodes where it was', () => {
    const root = mount();
    const before = ys(root, ['u1.ts', 'u2.ts', 'u3.ts']);
    click(root, 'a.ts');
    expect(ys(root, ['u1.ts', 'u2.ts', 'u3.ts'])).toEqual(before);
    expect(column(root, REPO_NAMES)[0]).toBe('r1.ts');
  });

  it('marks the lifted run as related and clears it on a second click', () => {
    const root = mount();
    const related = () => [...root.querySelectorAll('.lt-pixi-node-access')].filter((node) => node.getAttribute('aria-description')?.match(/selected|related/)).map((node) => node.textContent).sort();
    expect(related()).toEqual([]);
    click(root, 'f.ts');
    expect(related()).toEqual(['e.ts', 'f.ts', 'r3.ts', 'r4.ts']);
    click(root, 'f.ts');
    expect(related()).toEqual([]);
  });

  it('restores the original arrangement on a second click on the node', () => {
    const root = mount();
    const initial = layout(root);
    click(root, 'f.ts');
    expect(layout(root)).not.toEqual(initial);
    click(root, 'f.ts');
    expect(layout(root)).toEqual(initial);
  });

  it('switches straight to the arrangement of the new selection', () => {
    const root = mount();
    click(root, 'f.ts');
    click(root, 'a.ts');
    const switched = layout(root);
    click(root, 'f.ts');
    click(root, 'a.ts');
    expect(switched).toEqual(layout(root));
    expect(column(root, SVC_NAMES).slice(0, 1)).toEqual(['a.ts']);
    expect(column(root, REPO_NAMES)[0]).toBe('r1.ts');
  });

  it('keeps the clicked node at the top with its relations, so it never ends up out of sight', () => {
    const root = mount();
    click(root, 'f.ts');
    expect(at(root, 'f.ts').y).toBeLessThan(at(root, 'a.ts').y);
  });

  it('projects the final positions of the selected node and its neighbours', () => {
    const root = mount();
    click(root, 'f.ts');
    expect(at(root, 'f.ts').y).toBeLessThan(at(root, 'a.ts').y);
    expect(at(root, 'r3.ts').y).toBeLessThan(at(root, 'r1.ts').y);
    expect(nodeG(root, 'e.ts').getAttribute('aria-description')).toContain('related');
    expect(nodeG(root, 'r4.ts').getAttribute('aria-description')).toContain('related');
  });

  it('draws no edge and moves nothing by default', () => {
    const root = mount();
    expect(root.querySelector('[aria-description*="related"]')).toBeNull();
  });

  it('keeps the arrangement through a search that redraws the graph', () => {
    const root = mount();
    click(root, 'f.ts');
    const input = root.querySelector('.search') as HTMLInputElement;
    vi.useFakeTimers();
    input.value = 'svc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    expect(column(root, SVC_NAMES)).toEqual(['e.ts', 'f.ts', 'a.ts', 'b.ts', 'c.ts', 'd.ts']);
  });

  it('lifts for a node picked in the side panel as for a click', () => {
    const root = mount();
    click(root, 'f.ts');
    (root.querySelector('.lt-detail button[data-go="src/repo/r3.ts"]') as HTMLElement).click();
    expect(column(root, REPO_NAMES)[0]).toBe('r3.ts');
    expect(column(root, SVC_NAMES).slice(0, 1)).toEqual(['f.ts']);
  });
});

describe('the move animation', () => {
  it('caps movement at 300 ms and projects final positions immediately', () => {
    reduceMotion(false);
    const root = mount();
    click(root, 'f.ts');
    expect(MOVE_MS).toBeLessThanOrEqual(300);
    expect(column(root, SVC_NAMES).slice(0, 2)).toEqual(['e.ts', 'f.ts']);
  });

  it('projects final positions under prefers-reduced-motion', () => {
    reduceMotion(true);
    const root = mount();
    click(root, 'f.ts');
    expect(column(root, SVC_NAMES).slice(0, 2)).toEqual(['e.ts', 'f.ts']);
    click(root, 'f.ts');
    expect(column(root, SVC_NAMES)).toEqual(SVC_NAMES);
  });

  it('does not write transform styles on semantic controls', () => {
    const root = mount();
    nodeG(root, 'f.ts').dispatchEvent(new Event('mouseenter'));
    nodeG(root, 'f.ts').dispatchEvent(new Event('focus'));
    click(root, 'f.ts');
    for (const g of root.querySelectorAll('.lt-pixi-node-access')) expect((g as SVGElement).style.transform).toBe('');
  });
});

describe('nodes far outside the view', () => {
  const MANY: LanternMap = mapOf({
    nodes: [...Array.from({ length: 200 }, (_, i) => node(`src/svc/n${String(i).padStart(3, '0')}.ts`, 'service')), node('src/repo/r1.ts', 'repository')],
    relations: [rel('src/svc/n199.ts', '>', 'src/repo/r1.ts'), rel('src/svc/n198.ts', '>', 'src/svc/n199.ts')],
  });

  function stubSizes() {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('lt-main') ? 200 : Number(this.getAttribute('width')) || 0;
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('projects offscreen nodes at their final places after selection settles', () => {
    reduceMotion(false);
    stubSizes();
    vi.useFakeTimers();
    const root = mount(MANY);
    const far = at(root, 'n100.ts').y;
    click(root, 'n199.ts');
    expect(at(root, 'n100.ts').y).toBe(far + 2 * 26 + 34);
    vi.advanceTimersByTime(MOVE_MS + 1000);
    expect(at(root, 'n100.ts').y).toBe(far + 2 * 26 + 34);
    click(root, 'n199.ts');
    vi.advanceTimersByTime(MOVE_MS + 1000);
    expect(at(root, 'n100.ts').y).toBe(far);
  });

  it('scrolls up to the lifted run on a click, and back to the node when it is cleared', () => {
    reduceMotion(true);
    stubSizes();
    const root = mount(MANY);
    const main = root.querySelector('.lt-main') as HTMLElement;
    Object.defineProperty(main, 'scrollTop', { value: 5000, writable: true, configurable: true });
    click(root, 'n199.ts');
    expect(main.scrollTop).toBe(0);
    click(root, 'n199.ts');
    expect(main.scrollTop).toBeGreaterThan(4000);
  });

  it('keep final positions through rapid selection changes', () => {
    reduceMotion(false);
    stubSizes();
    vi.useFakeTimers();
    const root = mount(MANY);
    const far = at(root, 'n100.ts').y;
    click(root, 'n199.ts');
    expect(at(root, 'n100.ts').y).toBe(far + 2 * 26 + 34);
    click(root, 'n198.ts');
    expect(at(root, 'n100.ts').y).toBe(far + 2 * 26 + 34);
    click(root, 'n198.ts');
    vi.advanceTimersByTime(MOVE_MS + 1000);
    expect(at(root, 'n100.ts').y).toBe(far);
  });

  it('scrolls sideways to a lifted node whose column is out of view', () => {
    reduceMotion(true);
    stubSizes();
    const root = mount(MANY);
    const main = root.querySelector('.lt-main') as HTMLElement;
    Object.defineProperty(main, 'scrollLeft', { value: 0, writable: true, configurable: true });
    click(root, 'n199.ts');
    expect(main.scrollLeft).toBe(0);
    click(root, 'r1.ts');
    expect(main.scrollLeft).toBeGreaterThan(0);
  });
});
