// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';
import { emptyFilters, layoutGraph, PAD } from '../src/renderer/lib/lanternlayout';
import { AREA_THRESHOLD, DENSE_COLUMN_RELATIONS, denseColumn, relationLayout } from '../src/renderer/lib/lanternrelview';
import { mountLanternView } from '../src/renderer/lib/lanternview';

type Arrow = '>' | '<' | '=';

const rel = (from: string, arrow: Arrow, to: string) => ({ from, arrow, to, ext: null, symbol: null, label: '' });
const C = 'src/svc/centre.ts';

function star(inputs: string[], outputs: string[], mutual: string[], extra: LanternMap['relations'] = []): LanternMap {
  const paths = [...inputs, ...outputs, ...mutual];
  return mapOf({
    nodes: [node(C, 'service'), ...paths.map((p) => node(p, 'repository')), node('src/other/lonely.ts', 'util')],
    relations: [...inputs.map((p) => rel(C, '<', p)), ...outputs.map((p) => rel(C, '>', p)), ...mutual.map((p) => rel(C, '=', p)), ...extra],
  });
}

const repo = (prefix: string, n: number, dir = 'src/repo') => Array.from({ length: n }, (_, i) => `${dir}/${prefix}${String(i).padStart(3, '0')}.ts`);

function layoutOf(data: LanternMap, live = C) {
  return relationLayout(layoutGraph(data, emptyFilters()), live);
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('relation layout', () => {
  const MAP = star(['src/repo/in1.ts', 'src/repo/in2.ts'], ['src/repo/out1.ts'], ['src/repo/mutual1.ts', 'src/repo/mutual2.ts']);

  it('puts files it takes from on the left, files it sends to on the right, mutual files above', () => {
    const R = layoutOf(MAP);
    const at = (p: string) => R.pos.get(p) as { x: number; y: number; w: number; h: number };
    const c = at(C);
    expect(at('src/repo/in1.ts').x + at('src/repo/in1.ts').w).toBeLessThan(c.x);
    expect(at('src/repo/in2.ts').x).toBeLessThan(c.x);
    expect(at('src/repo/out1.ts').x).toBeGreaterThan(c.x + c.w);
    for (const m of ['src/repo/mutual1.ts', 'src/repo/mutual2.ts']) {
      expect(at(m).y + at(m).h).toBeLessThan(c.y);
      expect(at(m).x).toBeGreaterThanOrEqual(c.x - c.w);
      expect(at(m).x + at(m).w).toBeLessThanOrEqual(c.x + 2 * c.w);
    }
    expect(R.zones.map((z) => z.side).sort()).toEqual(['both', 'centre', 'in', 'out']);
  });

  it('reads the direction from the selected file, whichever end holds the relation', () => {
    const data = mapOf({
      nodes: [node(C, 'service'), node('src/repo/a.ts', 'repository'), node('src/repo/b.ts', 'repository'), node('src/repo/c.ts', 'repository')],
      relations: [rel('src/repo/a.ts', '>', C), rel('src/repo/b.ts', '<', C), rel('src/repo/c.ts', '=', C)],
    });
    const R = layoutOf(data);
    const x = (p: string) => (R.pos.get(p) as { x: number }).x;
    const cx = x(C);
    expect(x('src/repo/a.ts')).toBeLessThan(cx);
    expect(x('src/repo/b.ts')).toBeGreaterThan(cx);
    expect((R.pos.get('src/repo/c.ts') as { y: number }).y).toBeLessThan((R.pos.get(C) as { y: number }).y);
  });

  it('puts a file that is both taken from and given to in the mutual group', () => {
    const data = star([], [], [], [rel(C, '<', 'src/repo/x.ts'), rel(C, '>', 'src/repo/x.ts')]);
    data.nodes.push(node('src/repo/x.ts', 'repository'));
    const R = layoutOf(data);
    expect((R.pos.get('src/repo/x.ts') as { y: number }).y).toBeLessThan((R.pos.get(C) as { y: number }).y);
    expect(R.zones.map((z) => z.side)).not.toContain('in');
    expect(R.zones.map((z) => z.side)).not.toContain('out');
  });

  it('drops the left side and puts the file at the far left when it takes from nothing', () => {
    const R = layoutOf(star([], ['src/repo/out1.ts', 'src/repo/out2.ts'], []));
    expect(R.zones.map((z) => z.side)).not.toContain('in');
    const c = R.pos.get(C) as { x: number; w: number };
    const column = R.zones.find((z) => z.side === 'centre') as { x: number };
    expect(column.x).toBe(PAD);
    expect(c.x).toBeGreaterThanOrEqual(PAD);
    expect(c.x).toBeLessThan(PAD + 60);
    expect((R.pos.get('src/repo/out1.ts') as { x: number }).x).toBeGreaterThan(c.x + c.w);
  });

  it('drops the right side and puts the file at the far right when it only receives', () => {
    const R = layoutOf(star(['src/repo/in1.ts', 'src/repo/in2.ts'], [], []));
    expect(R.zones.map((z) => z.side)).not.toContain('out');
    const c = R.pos.get(C) as { x: number; w: number };
    const column = R.zones.find((z) => z.side === 'centre') as { x: number; w: number };
    const rightMost = Math.max(...[...R.pos.values()].map((p) => p.x + p.w));
    expect(rightMost).toBeLessThanOrEqual(column.x + column.w);
    expect(rightMost - (c.x + c.w)).toBeLessThan(60);
    expect(R.width).toBeLessThan(rightMost + 2 * PAD);
  });

  describe('with a long group of mutual files above', () => {
    const wide = (inputs: string[], outputs: string[]) => layoutOf(star(inputs, outputs, repo('m', 80, 'src/mutual')));
    const parts = (R: ReturnType<typeof layoutOf>) => {
      const above = R.zones.find((z) => z.side === 'both') as { x: number; w: number };
      const column = R.zones.find((z) => z.side === 'centre') as { x: number; w: number };
      return { above, column, centre: R.pos.get(C) as { x: number; w: number } };
    };
    const inside = (R: ReturnType<typeof layoutOf>) => {
      for (const p of R.pos.values()) {
        expect(p.x).toBeGreaterThanOrEqual(PAD);
        expect(p.x + p.w).toBeLessThanOrEqual(R.width - PAD);
      }
    };

    it('centres the group over the file when both sides exist', () => {
      const R = wide(['src/repo/a.ts'], ['src/repo/b.ts']);
      const { above, column } = parts(R);
      expect(above.x + above.w / 2).toBeCloseTo(column.x + column.w / 2, 0);
      inside(R);
    });

    it('keeps the file at the far right under the group when it takes from files and gives to none', () => {
      const R = wide(['src/repo/a.ts'], []);
      const { above, column } = parts(R);
      expect(above.x + above.w).toBeLessThanOrEqual(column.x + column.w);
      expect(above.x).toBeGreaterThanOrEqual(PAD);
      inside(R);
    });

    it('keeps the file at the far left under the group when it gives to files and takes from none', () => {
      const R = wide([], ['src/repo/b.ts']);
      const { above, column } = parts(R);
      expect(above.x).toBe(PAD);
      expect(column.x).toBe(PAD);
      expect(above.x + above.w).toBeGreaterThan(column.x + column.w);
      inside(R);
    });

    it('centres the file under the group when it has nothing else', () => {
      const R = wide([], []);
      const { above, column } = parts(R);
      expect(above.x + above.w / 2).toBeCloseTo(column.x + column.w / 2, 0);
      inside(R);
    });

    it('spreads the group over several sub-columns instead of one tall list', () => {
      const R = wide([], []);
      const xs = new Set([...R.pos.values()].filter((p) => p.item.dir === 'src/mutual').map((p) => p.x));
      expect(xs.size).toBeGreaterThan(3);
      expect(xs.size).toBeLessThanOrEqual(6);
    });
  });

  it('keeps the file alone when nothing relates to it', () => {
    const R = layoutOf(star([], [], []), 'src/other/lonely.ts');
    expect([...R.pos.keys()]).toEqual(['src/other/lonely.ts']);
    expect(R.edges).toHaveLength(0);
    expect(R.count).toBe(1);
  });

  it('never overlaps the centre or any other card, at any size', () => {
    const R = layoutOf(star(repo('i', 70), repo('o', 45, 'src/out'), repo('m', 20, 'src/mutual')));
    const cards = [...R.pos.values()];
    for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) expect(overlaps(cards[i], cards[j])).toBe(false);
    for (const z of R.zones) for (const p of cards) if (z.side === 'centre' && p !== R.pos.get(C)) expect(overlaps(z, p)).toBe(false);
  });

  it('wraps a long list into sub-columns and groups files by directory', () => {
    const dirs = ['src/a', 'src/b', 'src/c', 'src/d', 'src/e', 'src/f', 'src/g', 'src/h', 'src/i', 'src/j'];
    const R = layoutOf(star(dirs.flatMap((d) => repo('f', 3, d)), [], []));
    const left = R.zones.find((z) => z.side === 'in') as { groups: { dir: string; x: number }[]; areas: unknown[] };
    const columns = new Set([...R.pos.values()].map((p) => p.x));
    expect(columns.size).toBeGreaterThan(2);
    expect(columns.size).toBeLessThanOrEqual(4);
    expect(left.groups.map((g) => g.dir).sort()).toEqual(dirs);
    expect(left.areas).toHaveLength(0);
    expect([...R.pos.values()].filter((p) => p.item.dir === 'src/c')).toHaveLength(3);
  });

  it('keeps the zones balanced around the centre with equal gaps', () => {
    const R = layoutOf(star(repo('i', 5), repo('o', 5, 'src/out'), []));
    const left = R.zones.find((z) => z.side === 'in') as { x: number; w: number };
    const right = R.zones.find((z) => z.side === 'out') as { x: number; w: number };
    const centre = R.zones.find((z) => z.side === 'centre') as { x: number; w: number };
    expect(centre.x - (left.x + left.w)).toBe(right.x - (centre.x + centre.w));
  });

  it('draws one edge per neighbour, each ending at the centre card', () => {
    const R = layoutOf(MAP);
    expect(R.edges).toHaveLength(5);
    expect(R.edges.map((e) => e.side).sort()).toEqual(['both', 'both', 'in', 'in', 'out']);
  });
});

describe('areas for crowded sections', () => {
  type Rect = { x: number; y: number; w: number; h: number };
  const zone = (R: ReturnType<typeof layoutOf>, side: string) => R.zones.find((z) => z.side === side) as ReturnType<typeof layoutOf>['zones'][number];
  const inside = (p: Rect, a: Rect) => p.x >= a.x && p.y >= a.y && p.x + p.w <= a.x + a.w && p.y + p.h <= a.y + a.h;

  it('turns more than three same-kind files of one section into one arrow to one area', () => {
    expect(AREA_THRESHOLD).toBe(3);
    const R = layoutOf(star(repo('a', AREA_THRESHOLD + 1), [], []));
    expect(R.edges).toHaveLength(1);
    expect(R.edges[0].side).toBe('in');
    expect(R.edges[0].area).toEqual({ dir: 'src/repo', count: 4 });
    expect(R.edges[0].relations).toHaveLength(4);
    const areas = zone(R, 'in').areas;
    expect(areas).toHaveLength(1);
    expect(areas[0].keys).toHaveLength(4);
    expect(R.edges[0].key).toBe(areas[0].key);
    expect(zone(R, 'in').groups).toHaveLength(0);
  });

  it('keeps one arrow per file at exactly three', () => {
    const R = layoutOf(star(repo('a', 3), [], []));
    expect(R.edges).toHaveLength(3);
    expect(R.edges.every((e) => !e.area)).toBe(true);
    expect(zone(R, 'in').areas).toHaveLength(0);
    expect(zone(R, 'in').groups.map((g) => g.dir)).toEqual(['src/repo']);
  });

  it('holds the files of an area inside it, in a grid that wraps into sub-columns', () => {
    const R = layoutOf(star(repo('a', 60), [], []));
    const [area] = zone(R, 'in').areas;
    const cards = area.keys.map((k) => R.pos.get(k) as Rect);
    expect(cards).toHaveLength(60);
    for (const c of cards) expect(inside(c, area)).toBe(true);
    expect(new Set(cards.map((c) => c.x)).size).toBeGreaterThan(1);
    expect(new Set(cards.map((c) => c.x)).size).toBeLessThanOrEqual(3);
    for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) expect(overlaps(cards[i], cards[j])).toBe(false);
  });

  it('keeps areas apart from each other and from the loose cards of the same zone', () => {
    const R = layoutOf(star([...repo('a', 40, 'src/a'), ...repo('b', 12, 'src/b'), ...repo('c', 3, 'src/c'), ...repo('d', 2, 'src/d')], [], []));
    const { areas, groups } = zone(R, 'in');
    expect(areas.map((a) => a.dir).sort()).toEqual(['src/a', 'src/b']);
    expect(groups.map((g) => g.dir).sort()).toEqual(['src/c', 'src/d']);
    expect(R.edges).toHaveLength(2 + 3 + 2);
    for (let i = 0; i < areas.length; i += 1) for (let j = i + 1; j < areas.length; j += 1) expect(overlaps(areas[i], areas[j])).toBe(false);
    const loose = [...R.pos.values()].filter((p) => p.item.dir === 'src/c' || p.item.dir === 'src/d');
    for (const p of loose) for (const a of areas) expect(overlaps(p, a)).toBe(false);
    for (const a of areas) for (const k of a.keys) expect(inside(R.pos.get(k) as Rect, a)).toBe(true);
  });

  it('does not merge different kinds, even in one section', () => {
    const dir = 'src/repo';
    const R = layoutOf(star(repo('i', 4, dir), repo('o', 2, dir), repo('m', 4, dir)));
    expect(R.edges.filter((e) => e.area).map((e) => e.side).sort()).toEqual(['both', 'in']);
    expect(R.edges.filter((e) => !e.area).map((e) => e.side)).toEqual(['out', 'out']);
    expect(R.edges).toHaveLength(4);
  });

  it('counts each kind on its own: three of each in one section stay three arrows each', () => {
    const dir = 'src/repo';
    const R = layoutOf(star(repo('i', 3, dir), repo('o', 3, dir), repo('m', 3, dir)));
    expect(R.edges).toHaveLength(9);
    expect(R.zones.every((z) => z.areas.length === 0)).toBe(true);
  });

  it('counts a file taken from and given to as mutual, not as one of each side', () => {
    const data = star(repo('i', 3), [], []);
    data.relations.push(rel(C, '>', 'src/repo/i000.ts'));
    const R = layoutOf(data);
    expect(R.edges).toHaveLength(3);
    expect(R.edges.map((e) => e.side).sort()).toEqual(['both', 'in', 'in']);
  });

  it('ends the arrow on the side of the area that faces the centre', () => {
    const R = layoutOf(star(repo('i', 5, 'src/in'), repo('o', 5, 'src/out'), repo('m', 5, 'src/mutual')));
    const centre = R.pos.get(C) as Rect;
    const edgeOf = (side: string) => R.edges.find((e) => e.side === side) as { d: string };
    const [inArea] = zone(R, 'in').areas;
    const [outArea] = zone(R, 'out').areas;
    const [bothArea] = zone(R, 'both').areas;
    expect(edgeOf('in').curve.from.x).toBe(inArea.x + inArea.w);
    expect(edgeOf('out').curve.to).toEqual({ x: outArea.x, y: outArea.y + outArea.h / 2 });
    expect(edgeOf('out').curve.from.x).toBe(centre.x + centre.w);
    expect(edgeOf('both').curve.from).toEqual({ x: bothArea.x + bothArea.w / 2, y: bothArea.y + bothArea.h });
  });

  it('keeps the file at the far left or far right when its only side is an area', () => {
    const out = layoutOf(star([], repo('o', 8, 'src/out'), []));
    const outColumn = zone(out, 'centre');
    expect(outColumn.x).toBe(PAD);
    expect(zone(out, 'out').areas).toHaveLength(1);
    expect(zone(out, 'out').areas[0].x).toBeGreaterThan(outColumn.x);

    const inn = layoutOf(star(repo('i', 8, 'src/in'), [], []));
    const column = zone(inn, 'centre');
    const rightMost = Math.max(...[...inn.pos.values()].map((p) => p.x + p.w));
    expect(rightMost).toBeLessThanOrEqual(column.x + column.w);
    expect(inn.width).toBeLessThan(rightMost + 2 * PAD);
  });

  it('keeps the area above centred over the file when both sides exist', () => {
    const R = layoutOf(star(['src/repo/a.ts'], ['src/repo/b.ts'], repo('m', 80, 'src/mutual')));
    const [area] = zone(R, 'both').areas;
    const column = zone(R, 'centre');
    expect(area.x + area.w / 2).toBeCloseTo(column.x + column.w / 2, 0);
    for (const p of R.pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(PAD);
      expect(p.x + p.w).toBeLessThanOrEqual(R.width - PAD);
    }
  });
});

describe('dense column', () => {
  const near = (n: number, dir = 'src/repo') => star(repo('r', n, dir), [], []);
  const dense = (data: LanternMap) => denseColumn(layoutGraph(data, emptyFilters()), C);

  it('is raised at the threshold and not below it', () => {
    expect(DENSE_COLUMN_RELATIONS).toBe(25);
    expect(dense(near(DENSE_COLUMN_RELATIONS - 1))).toBeNull();
    expect(dense(near(DENSE_COLUMN_RELATIONS))).toEqual({ name: 'Data', count: 25 });
  });

  it('counts a single column, not the total across columns', () => {
    const data = star(repo('r', 15), [], []);
    for (let i = 0; i < 15; i += 1) {
      data.nodes.push(node(`src/util/u${i}.ts`, 'util'));
      data.relations.push(rel(C, '>', `src/util/u${i}.ts`));
    }
    expect(dense(data)).toBeNull();
  });

  it('counts files, not repeated relations to one file', () => {
    const data = star(repo('r', 3), [], []);
    for (let i = 0; i < 40; i += 1) data.relations.push({ ...rel(C, '>', 'src/repo/r000.ts'), symbol: `s${i}` });
    expect(dense(data)).toBeNull();
  });
});

const mounted: { root: HTMLElement; dispose: () => void }[] = [];

function mount(data: LanternMap) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, data);
  mounted.push({ root, dispose: view.dispose });
  return root;
}

const nodeG = (root: HTMLElement, name: string) => [...root.querySelectorAll('.lt-pixi-node-access')].find((node) => node.textContent?.endsWith(name)) as HTMLElement;
const click = (root: HTMLElement, name: string) => nodeG(root, name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const toggle = (root: HTMLElement) => root.querySelector('.lt-rvtoggle') as HTMLButtonElement;
const label = (node: Element) => node.textContent?.split('/').pop();
const nodes = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')].map(label);
const selected = (root: HTMLElement) => label(root.querySelector('.lt-pixi-node-access[aria-pressed="true"]') as Element);
const at = (root: HTMLElement, name: string) => {
  const node = nodeG(root, name) as unknown as HTMLElement;
  return { x: Number(node.dataset.graphX), y: Number(node.dataset.graphY) };
};

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.dispose();
    entry.root.remove();
  }
  vi.unstubAllGlobals();
});

describe('relation view toggle', () => {
  const MAP = star(['src/repo/in1.ts'], ['src/repo/out1.ts'], ['src/repo/mutual1.ts']);

  it('is offered only with a selection', () => {
    const root = mount(MAP);
    expect(toggle(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
    click(root, 'centre.ts');
    expect(toggle(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(false);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    click(root, 'centre.ts');
    expect(toggle(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps its floating controls after the graph so they anchor to the bottom edge', () => {
    const root = mount(MAP);
    const graph = root.querySelector('.lt-pixi-host') as Element;
    expect(graph.nextElementSibling?.classList.contains('lt-rvbar')).toBe(true);
  });

  it('shows only the file and its relations, with an arrowed edge to each neighbour', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    expect(nodes(root)).toHaveLength(5);
    toggle(root).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(nodes(root).sort()).toEqual(['centre.ts', 'in1.ts', 'mutual1.ts', 'out1.ts']);
    expect(selected(root)).toBe('centre.ts');
  });

  it('places the neighbours left, right and above in the drawing', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    const c = at(root, 'centre.ts');
    expect(at(root, 'in1.ts').x).toBeLessThan(c.x);
    expect(at(root, 'out1.ts').x).toBeGreaterThan(c.x);
    expect(at(root, 'mutual1.ts').y).toBeLessThan(c.y);
  });

  it('returns to the normal graph and the same selection when switched off', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    const normal = nodes(root).length;
    toggle(root).click();
    toggle(root).click();
    expect(nodes(root)).toHaveLength(normal);
    expect(selected(root)).toBe('centre.ts');
    expect(root.querySelector('.lt-detail')).not.toBeNull();
  });

  it('leaves with Escape and from the side panel', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    (root.querySelector('.lt-detail .rv-open') as HTMLElement).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.lt-detail .rv-open')?.textContent).toBe('Back to full graph');
    (root.querySelector('.lt-detail .rv-open') as HTMLElement).click();
    expect(nodes(root).length).toBeGreaterThan(4);
  });

  it('stays in the view when empty space is clicked, and leaves it when the file is deselected', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    (root.querySelector('.lt-detail .close') as HTMLElement).click();
    expect(nodes(root).length).toBeGreaterThan(4);
    expect(root.querySelector('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
    click(root, 'centre.ts');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  function searchFor(root: HTMLElement, q: string) {
    vi.useFakeTimers();
    const input = root.querySelector('.search') as HTMLInputElement;
    input.value = q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
  }

  it('drops the side panel button when a search hides the selected file, and offers it again when it is back', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    searchFor(root, 'repo');
    expect(toggle(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.lt-detail .rv-open')).toBeNull();
    searchFor(root, '');
    expect(root.querySelector('.lt-detail .rv-open')?.textContent).toBe('Open relation view');
  });

  it('does not open the view for another file after a search hid the one it was open for', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    searchFor(root, 'repo');
    expect(nodes(root)).toHaveLength(3);
    click(root, 'in1.ts');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(selected(root)).toBe('in1.ts');
    searchFor(root, '');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(nodes(root)).toHaveLength(5);
  });

  it('keeps the centre out of tab order while neighbours stay keyboard operable', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    expect((nodeG(root, 'centre.ts') as unknown as HTMLButtonElement).tabIndex).toBe(-1);
    expect((nodeG(root, 'in1.ts') as unknown as HTMLButtonElement).tabIndex).toBe(0);
  });

  it('leaves with Escape also when the focus is on the page body, and after a re-centre', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    click(root, 'in1.ts');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves Escape to an open modal, even when its own handler closes it first', () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    document.body.appendChild(modal);
    const closeModal = () => modal.classList.add('hidden');
    document.addEventListener('keydown', closeModal);
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', closeModal);
    modal.remove();
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves Escape to an open project section', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    (root.querySelector('.lt-overlay') as HTMLElement).hidden = false;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('returns the focus to the side button after it is used from the keyboard', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    (root.querySelector('.lt-detail .rv-open') as HTMLElement).click();
    expect(document.activeElement).toBe(root.querySelector('.lt-detail .rv-open'));
  });

  it('works for a file with no relations', () => {
    const root = mount(MAP);
    click(root, 'lonely.ts');
    toggle(root).click();
    expect(nodes(root)).toEqual(['lonely.ts']);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('applies the relation filter to the neighbours', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    (root.querySelector('button[data-kind=">"]') as HTMLElement).click();
    expect(nodes(root).sort()).toEqual(['centre.ts', 'out1.ts']);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the view through a search that leaves the file visible', () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    searchFor(root, 'svc');
    expect(nodes(root)).toEqual(['centre.ts']);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('relation view hint', () => {
  const hint = (root: HTMLElement) => root.querySelector('.rv-hint');

  it('suggests the view when a column holds many relations, without a dialog', () => {
    const root = mount(star(repo('r', DENSE_COLUMN_RELATIONS), [], []));
    click(root, 'centre.ts');
    expect(hint(root)?.textContent).toContain('Many relations in Data');
    expect(root.querySelector('[role="dialog"], .modal')).toBeNull();
    (root.querySelector('.rv-hint-go') as HTMLElement).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(hint(root)).toBeNull();
    expect(nodes(root)).toHaveLength(DENSE_COLUMN_RELATIONS + 1);
  });

  it('stays quiet below the threshold', () => {
    const root = mount(star(repo('r', DENSE_COLUMN_RELATIONS - 1), [], []));
    click(root, 'centre.ts');
    expect(hint(root)).toBeNull();
    expect(root.querySelector('.rv-open')).not.toBeNull();
  });

  it('can be dismissed and stays dismissed for the next selection', () => {
    const data = star(repo('r', 30), [], []);
    const root = mount(data);
    click(root, 'centre.ts');
    (root.querySelector('.rv-hint-x') as HTMLElement).click();
    expect(hint(root)).toBeNull();
    expect(nodes(root).length).toBeGreaterThan(30);
    click(root, 'r000.ts');
    click(root, 'centre.ts');
    expect(hint(root)).toBeNull();
  });
});

describe('re-centring on a neighbour', () => {
  const MAP = mapOf({
    nodes: [node(C, 'service'), node('src/repo/in1.ts', 'repository'), node('src/repo/out1.ts', 'repository'), node('src/svc/far.ts', 'service')],
    relations: [rel(C, '<', 'src/repo/in1.ts'), rel(C, '>', 'src/repo/out1.ts'), rel('src/repo/out1.ts', '>', 'src/svc/far.ts')],
  });

  function open() {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    return root;
  }

  it('makes the clicked neighbour the centre and shows its own relations', () => {
    const root = open();
    click(root, 'out1.ts');
    expect(selected(root)).toBe('out1.ts');
    expect(nodes(root).sort()).toEqual(['centre.ts', 'far.ts', 'out1.ts']);
    expect(at(root, 'centre.ts').x).toBeLessThan(at(root, 'out1.ts').x);
    expect(at(root, 'far.ts').x).toBeGreaterThan(at(root, 'out1.ts').x);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.lt-detail .path')?.textContent).toContain('out1.ts');
  });

  it('does nothing when the centre is clicked', () => {
    const root = open();
    click(root, 'centre.ts');
    expect(selected(root)).toBe('centre.ts');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('re-centres on a shared card', () => {
    const root = open();
    click(root, 'out1.ts');
    expect(selected(root)).toBe('out1.ts');
  });

  it('re-centres on a shared card under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    const root = open();
    click(root, 'out1.ts');
    expect(selected(root)).toBe('out1.ts');
  });

  it('goes back to the graph on the file that is centred when it is left', () => {
    const root = open();
    click(root, 'out1.ts');
    toggle(root).click();
    expect(selected(root)).toBe('out1.ts');
    expect(nodes(root)).toHaveLength(4);
  });
});

describe('cost of the view', () => {
  const spread = (n: number) => Array.from({ length: n }, (_, i) => `src/d${String(i % Math.ceil(n / 3)).padStart(2, '0')}/r${String(i).padStart(3, '0')}.ts`);

  it('draws one arrow instead of 170 when the files share one section', () => {
    const root = mount(star(repo('r', 170), [], []));
    click(root, 'centre.ts');
    toggle(root).click();
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(171);
    expect(root.querySelectorAll('.lt-pixi-area-access')).toHaveLength(1);
  });

  it('draws only the neighbours, not the whole graph, for a file with 170 relations', () => {
    const data = star(spread(170), [], []);
    for (let i = 0; i < 300; i += 1) data.nodes.push(node(`src/noise/n${i}.ts`, 'util'));
    const root = mount(data);
    click(root, 'centre.ts');
    toggle(root).click();
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(171);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelectorAll('.lt-pixi-node-access').length).toBeGreaterThan(400);
    nodeG(root, 'r000.ts').dispatchEvent(new FocusEvent('focus'));
  });
});

describe('areas in the drawing', () => {
  const dir = 'src/repo';
  const MAP = mapOf({
    nodes: [node(C, 'service'), ...repo('r', 5, dir).map((p) => node(p, 'repository')), node('src/out/o1.ts', 'repository'), node('src/svc/far.ts', 'service')],
    relations: [...repo('r', 5, dir).map((p) => rel(C, '<', p)), rel(C, '>', 'src/out/o1.ts'), rel('src/out/o1.ts', '>', 'src/svc/far.ts')],
  });
  const open = () => {
    const root = mount(MAP);
    click(root, 'centre.ts');
    toggle(root).click();
    return root;
  };
  it('draws a labelled area with its count, one arrow to it, and the files inside it', () => {
    const root = open();
    const area = root.querySelector('.lt-pixi-area-access') as HTMLButtonElement;
    expect(area.textContent).toBe(`${dir}, 5 files`);
    expect(area.dataset.tip).toContain('src/repo/r000.ts');
    expect(repo('r', 5, dir).every((path) => !!nodeG(root, path.split('/').pop() as string))).toBe(true);
  });

  it('pins and releases an area through its semantic button', () => {
    const root = open();
    const area = root.querySelector('.lt-pixi-area-access') as HTMLButtonElement;
    area.click();
    expect(area.getAttribute('aria-pressed')).toBe('true');
    area.click();
    expect(area.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the view and the centre when the header is clicked', () => {
    const root = open();
    (root.querySelector('.lt-pixi-area-access') as HTMLButtonElement).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(selected(root)).toBe('centre.ts');
  });

  it('still re-centres on a file inside an area', () => {
    const root = open();
    click(root, 'r002.ts');
    expect(selected(root)).toBe('r002.ts');
    expect(root.querySelectorAll('.lt-pixi-area-access')).toHaveLength(0);
    expect(nodes(root).sort()).toEqual(['centre.ts', 'r002.ts']);
  });

  it('re-centres on a file inside an area under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    const root = open();
    click(root, 'r001.ts');
    expect(selected(root)).toBe('r001.ts');
  });

  it('draws the area again when the old centre is clicked after a re-centre', () => {
    const root = open();
    click(root, 'r002.ts');
    expect(root.querySelectorAll('.lt-pixi-area-access')).toHaveLength(0);
    click(root, 'centre.ts');
    expect(root.querySelectorAll('.lt-pixi-area-access')).toHaveLength(1);
  });
});

describe('relation view with a pull request and platforms', () => {
  const MAP = mapOf({
    platforms: [
      { id: 'web', kind: 'web', label: 'Web', count: 2 },
      { id: 'api', kind: 'backend', label: 'API', count: 1 },
    ],
    nodes: [node('src/page.tsx', 'page', { platform: 'web' }), node('src/svc.ts', 'service', { platform: 'web' }), node('api/repo.ts', 'repository', { platform: 'api' })],
    relations: [rel('src/page.tsx', '>', 'src/svc.ts'), rel('src/svc.ts', '>', 'api/repo.ts')],
    prs: [pr('7', { files: [{ path: 'src/page.tsx', kind: 'modified', mapped: true }] })],
  });

  it('keeps the pull request tint on the cards, and the toggle in pull request mode', () => {
    const root = mount(MAP);
    click(root, 'svc.ts');
    toggle(root).click();
    (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(label(root.querySelector('.lt-pixi-node-access.pr-hit') as Element)).toBe('page.tsx');
    expect([...root.querySelectorAll('.lt-pixi-node-access.pr-off')].map(label).sort()).toEqual(['repo.ts', 'svc.ts']);
  });

  it('leaves the view when the platform tab clears the selection, and does not reopen it on the next click', () => {
    const root = mount(MAP);
    (root.querySelector('.lt-tabs button[data-plat="web"]') as HTMLElement).click();
    click(root, 'svc.ts');
    toggle(root).click();
    (root.querySelector('.lt-tabs button[data-plat="api"]') as HTMLElement).click();
    expect(toggle(root).closest('.lt-rvbar')?.hasAttribute('hidden')).toBe(true);
    click(root, 'repo.ts');
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(selected(root)).toBe('repo.ts');
  });

  it('shows a neighbour on another platform as a boundary card and switches platform on click', () => {
    const root = mount(MAP);
    (root.querySelector('.lt-tabs button[data-plat="web"]') as HTMLElement).click();
    click(root, 'svc.ts');
    toggle(root).click();
    expect(nodes(root).sort()).toEqual(['page.tsx', 'repo.ts', 'svc.ts']);
    click(root, 'repo.ts');
    expect(root.querySelector('.lt-tabs [aria-selected="true"]')?.getAttribute('data-plat')).toBe('api');
    expect(selected(root)).toBe('repo.ts');
  });
});

describe('bringing the centre into view', () => {
  function stubSizes() {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('lt-main') ? 700 : Number(this.getAttribute('width')) || 0;
    });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
  }

  afterEach(() => vi.restoreAllMocks());

  it('scrolls down to a centre that sits below a long group of mutual files, and back to the top on leaving', () => {
    stubSizes();
    const root = mount(star([], [], repo('m', 40)));
    const main = root.querySelector('.lt-main') as HTMLElement;
    Object.defineProperty(main, 'scrollTop', { value: 0, writable: true, configurable: true });
    click(root, 'centre.ts');
    toggle(root).click();
    const c = at(root, 'centre.ts');
    expect(c.y).toBeGreaterThan(300);
    expect(main.scrollTop).toBe(c.y - 120);
    toggle(root).click();
    expect(main.scrollTop).toBe(0);
  });

  it('stays at the top when the centre is already in view', () => {
    stubSizes();
    const root = mount(star(['src/repo/a.ts'], ['src/repo/b.ts'], []));
    const main = root.querySelector('.lt-main') as HTMLElement;
    Object.defineProperty(main, 'scrollTop', { value: 0, writable: true, configurable: true });
    click(root, 'centre.ts');
    toggle(root).click();
    expect(main.scrollTop).toBe(0);
  });
});
