// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternFlowStory, LanternMap, LanternNode, LanternPrFile, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureRecords, macroFixtureView, repoFeatureTexts, repoPrRecord } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const PR_ID = '108';
const view = macroFixtureView();
const blockByPath = macroFixtureBlocks();
const loaded: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath, minStrongEdge: 8 };
const names = new Map(macroGraph(view).blocks.map((block) => [block.id, block.name]));
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const record = repoPrRecord(PR_ID);
const KIND_MARK = { added: '+', modified: '~', removed: '-' } as const;

const inMap = (path: string) => nodes.some((n) => n.path === path);
const blockOf = (path: string) => blockByPath[path];
const feature = (path: string) => blockOf(path)?.startsWith('core:') === false;
const prPaths = record.files.map((f) => f.path).filter((path) => !/[\s#%]/.test(path));
const first = prPaths.find(feature) as string;
const second = prPaths.find((path) => feature(path) && blockOf(path) !== blockOf(first)) as string;
const foundation = prPaths.find((path) => blockOf(path)?.startsWith('core:')) as string;
const unmapped = prPaths.find((path) => !inMap(path)) as string;
const files: LanternPrFile[] = record.files.map((f) => ({ ...f, mapped: inMap(f.path) }));
const kindOf = (path: string) => files.find((f) => f.path === path)?.kind as LanternPrFile['kind'];

const story: LanternFlowStory = {
  title: 'A reviewer follows the change',
  steps: [
    { kind: 'actor', text: 'Reviewer', files: [first, second] },
    { kind: 'action', text: 'opens' },
    { kind: 'subject', text: 'the change', files: [foundation] },
  ],
  below: [{ kind: 'consequence', old: 'sees nothing', new: 'sees the files', files: [unmapped] }],
};

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

const readers: ViewOptions = {
  readFile: async (path) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }),
  readPrFile: async (_pr, path) => ({ ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, path) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }),
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mapWith = (flow: LanternFlowStory[]): LanternMap => mapOf({ project: 'demo', nodes, relations, prs: [pr(PR_ID, { title: record.title, ordered: record.ordered, files, flow })] });

async function mount(flow: LanternFlowStory[] = [story], opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, mapWith(flow), { pr: PR_ID, readMacro: () => Promise.resolve(loaded), ...readers, ...opts }));
  await flush();
  return root;
}

const control = (root: HTMLElement, which: 'files' | 'macro' | 'flow') => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const chips = (scope: ParentNode) => [...scope.querySelectorAll<HTMLButtonElement>('.lt-flow-file')];
const chipPaths = (scope: ParentNode) => chips(scope).map((chip) => chip.dataset.flowOpen);
const blocks = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-flow-block')];
const pickable = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-flow-block[data-flow-step]')];
const hitRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-side .pr-file.flow-hit')].map((row) => row.querySelector('[data-pr-go]')?.getAttribute('data-pr-go') ?? row.getAttribute('data-tip')).sort();
const pane = (root: HTMLElement) => root.querySelector('.lt-review') as HTMLElement;
const shown = (root: HTMLElement) => pane(root).querySelector('.lt-code-path')?.getAttribute('data-tip');
const accessButtons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const litNodes = (root: HTMLElement) => accessButtons(root).filter((button) => button.classList.contains('pr-hit')).map((button) => button.dataset.tip.split(' — ')[0]).sort();
const reading = (root: HTMLElement) => accessButtons(root).filter((button) => button.classList.contains('open-file')).map((button) => button.textContent).sort();
const note = (root: HTMLElement) => root.querySelector('.lt-side .pr-flowmark');
const press = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const blockNames = (paths: string[]) => [...new Set(paths.map((path) => names.get(blockOf(path))))].filter(Boolean).sort();

describe('uses a fixture with changed files in two feature blocks, the foundation and outside the map', () => {
  it('has them all', () => {
    expect([first, second, foundation, unmapped].every(Boolean)).toBe(true);
    expect(blockOf(first)).not.toBe(blockOf(second));
    expect(blockNames([first, second])).toHaveLength(2);
    expect(blockNames([foundation])).toHaveLength(1);
    expect(blockNames([unmapped])).toHaveLength(0);
  });
});

describe('the file chips of a step in the Flow view', () => {
  it('shows one chip per file under the step that holds them, in the order of the record, and none elsewhere', async () => {
    const root = await mount();
    control(root, 'flow').click();

    const cells = [...root.querySelectorAll('.lt-flow-step')].map((step) => chipPaths(step));
    expect(cells).toEqual([[first, second], [], [foundation], [unmapped]]);
    expect(root.querySelectorAll('.lt-flow-files')).toHaveLength(3);
  });

  it('labels a chip with the file name, and puts the kind and the pull request reason in its tooltip', async () => {
    const root = await mount();
    control(root, 'flow').click();

    const chip = chips(root)[0];
    const reason = files.find((f) => f.path === first)?.reason;
    expect(chip.textContent).toBe(first.slice(first.lastIndexOf('/') + 1));
    expect(chip.dataset.tip).toBe(`${kindOf(first) === 'added' ? 'Added' : kindOf(first) === 'removed' ? 'Removed' : 'Modified'}: ${reason ?? first}`);
    expect(chip.classList.contains(`lt-flow-file-${kindOf(first)}`)).toBe(true);
    expect(chip.getAttribute('aria-label')).toContain(first);
  });

  it('writes a path as text, never as markup', async () => {
    const hostile: LanternFlowStory[] = [{ title: 't', steps: [{ kind: 'actor', text: 'A', files: ['<img src=x onerror=alert(1)>.ts'] }], below: [] }];
    const root = await mount(hostile);
    control(root, 'flow').click();

    expect(root.querySelector('.lt-flow img')).toBeNull();
    expect(chips(root)[0].textContent).toBe('<img src=x onerror=alert(1)>.ts');
  });

  it('makes a block with files a pressable button and leaves one without files plain', async () => {
    const root = await mount();
    control(root, 'flow').click();

    expect(pickable(root)).toHaveLength(3);
    expect(pickable(root).every((block) => block.getAttribute('role') === 'button' && block.tabIndex === 0 && block.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(blocks(root).filter((block) => !block.hasAttribute('data-flow-step'))).toHaveLength(1);
  });

  it('draws a flow with no references exactly as before: no chips, no pressable block', async () => {
    const plain: LanternFlowStory[] = [{ title: 't', steps: [{ kind: 'actor', text: 'A' }], below: [] }];
    const root = await mount(plain);
    control(root, 'flow').click();

    expect(chips(root)).toHaveLength(0);
    expect(root.querySelector('.lt-flow-files')).toBeNull();
    expect(pickable(root)).toHaveLength(0);
  });
});

describe('opening a chip', () => {
  it('shows the file in the middle review pane and keeps the reviewer on Flow', async () => {
    const root = await mount();
    control(root, 'flow').click();

    chips(root)[1].click();
    await flush();

    expect(shown(root)).toBe(second);
    expect(control(root, 'flow').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(false);
    expect(root.querySelector(`.lt-side .pr-file.sel [data-pr-go="${second}"]`)).not.toBeNull();
  });

  it('opens a changed file that is not in the map, too', async () => {
    const root = await mount();
    control(root, 'flow').click();

    chips(root)[3].click();
    await flush();

    expect(shown(root)).toBe(unmapped);
  });

  it('does not select the step it sits under', async () => {
    const root = await mount();
    control(root, 'flow').click();

    chips(root)[0].click();
    await flush();

    expect(pickable(root).every((block) => block.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(note(root)).toBeNull();
  });
});

describe('selecting a step', () => {
  it('marks its files in the list, and only those', async () => {
    const root = await mount();
    control(root, 'flow').click();
    expect(hitRows(root)).toEqual([]);

    pickable(root)[0].click();

    expect(hitRows(root)).toEqual([first, second].sort());
    expect(pickable(root)[0].getAttribute('aria-pressed')).toBe('true');
    expect(pickable(root)[0].closest('.lt-flow-step')?.classList.contains('lt-flow-picked')).toBe(true);
    expect(note(root)?.textContent).toContain('Marking 2 files of the step');
    expect(note(root)?.textContent).toContain('Reviewer');
  });

  it('works from the keyboard on the step block: Enter and Space select, the same press clears', async () => {
    const root = await mount();
    control(root, 'flow').click();

    press(pickable(root)[1]);
    expect(hitRows(root)).toEqual([foundation]);
    pickable(root)[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(hitRows(root)).toEqual([]);
    expect(pickable(root)[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('moves the marks to the next step picked, and a click on the same step clears them', async () => {
    const root = await mount();
    control(root, 'flow').click();
    pickable(root)[0].click();

    pickable(root)[2].click();
    expect(hitRows(root)).toEqual([unmapped]);
    expect(pickable(root).map((block) => block.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);

    pickable(root)[2].click();
    expect(hitRows(root)).toEqual([]);
    expect(note(root)).toBeNull();
  });

  it('clears with Esc and with the Clear button in the list', async () => {
    const root = await mount();
    control(root, 'flow').click();

    pickable(root)[0].click();
    escape();
    expect(hitRows(root)).toEqual([]);
    expect(pickable(root)[0].getAttribute('aria-pressed')).toBe('false');

    pickable(root)[0].click();
    (root.querySelector('.pr-flowmark [data-flow-clear]') as HTMLElement).click();
    expect(hitRows(root)).toEqual([]);
    expect(note(root)).toBeNull();
  });

  it('keeps the review pane on the file it shows while the marks change', async () => {
    const root = await mount();
    control(root, 'flow').click();
    chips(root)[1].click();
    await flush();

    pickable(root)[2].click();
    await flush();

    expect(shown(root)).toBe(second);
    expect(hitRows(root)).toEqual([unmapped]);
  });

  it('is forgotten when a reload of the pull request leaves that step without files', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = mountLanternView(root, mapWith([story]), { pr: PR_ID, ...readers });
    mounted.push(handle);
    control(root, 'flow').click();
    pickable(root)[0].click();
    expect(hitRows(root)).toEqual([first, second].sort());

    handle.update(mapWith([{ ...story, steps: [{ kind: 'actor', text: 'Reviewer' }, ...story.steps.slice(1)] }]));

    expect(hitRows(root)).toEqual([]);
    expect(root.querySelector('.pr-flowmark')).toBeNull();
    pickable(root)[0].click();
    expect(hitRows(root)).toEqual([foundation]);
  });

  it('is forgotten when another pull request is picked or the pull request is left', async () => {
    const root = await mount();
    control(root, 'flow').click();
    pickable(root)[0].click();

    (root.querySelector('.pr-chip[data-pr]') as HTMLElement).click();

    expect(hitRows(root)).toEqual([]);
    expect(root.querySelector('.pr-flowmark')).toBeNull();
  });
});

describe('the marked step on the Files graph', () => {
  it('lights the nodes of its files and leaves the other changed files dim', async () => {
    const root = await mount();
    control(root, 'files').click();
    const allChanged = litNodes(root);
    expect(allChanged.length).toBeGreaterThan(2);
    control(root, 'flow').click();
    pickable(root)[0].click();

    control(root, 'files').click();

    expect(litNodes(root)).toEqual([first, second].sort());
    const dim = accessButtons(root).filter((button) => button.classList.contains('pr-off')).length;
    expect(dim).toBeGreaterThan(0);
  });

  it('keeps the kind of change on a lit node and goes back to every changed file once cleared', async () => {
    const root = await mount();
    control(root, 'files').click();
    const allChanged = litNodes(root);
    control(root, 'flow').click();
    pickable(root)[0].click();
    control(root, 'files').click();
    expect(accessButtons(root).find((button) => button.dataset.tip.startsWith(first))?.dataset.tip).toContain(`pull request ${KIND_MARK[kindOf(first)]}`);

    (root.querySelector('.pr-flowmark [data-flow-clear]') as HTMLElement).click();

    expect(litNodes(root)).toEqual(allChanged);
  });
});

describe('the marked step on the Macro view', () => {
  it('puts the reading marker on the blocks that hold its files, and on no other', async () => {
    const root = await mount();
    control(root, 'macro').click();
    await flush();
    expect(reading(root)).toEqual([]);
    control(root, 'flow').click();
    pickable(root)[0].click();

    control(root, 'macro').click();
    await flush();

    expect(reading(root)).toEqual(blockNames([first, second]));
    expect(reading(root)).toHaveLength(2);
  });

  it('follows a second step, and clearing returns Macro to normal', async () => {
    const root = await mount();
    control(root, 'flow').click();
    pickable(root)[1].click();
    control(root, 'macro').click();
    await flush();
    expect(reading(root)).toEqual(blockNames([foundation]));

    control(root, 'flow').click();
    pickable(root)[0].click();
    control(root, 'macro').click();
    await flush();
    expect(reading(root)).toEqual(blockNames([first, second]));

    (root.querySelector('.pr-flowmark [data-flow-clear]') as HTMLElement).click();
    await flush();
    expect(reading(root)).toEqual([]);
  });

  it('adds the block of a file opened from a chip to the blocks of the step', async () => {
    const root = await mount();
    control(root, 'flow').click();
    pickable(root)[1].click();
    chips(root)[0].click();
    await flush();

    control(root, 'macro').click();
    await flush();

    expect(reading(root)).toEqual(blockNames([foundation, first]));
  });

  it('marks nothing for a step whose files sit in no block, and still dims nothing it should not', async () => {
    const root = await mount();
    control(root, 'flow').click();
    pickable(root)[2].click();
    control(root, 'macro').click();
    await flush();

    expect(hitRows(root)).toEqual([unmapped]);
    expect(reading(root)).toEqual([]);
  });
});

describe('from the record to the view', () => {
  const header = ['lantern-pr 1', `# ${PR_ID}`, '#title Refunds', '#url https://x.test/108', '#branch feat/refunds', '#base main', '#opened 2026-10-21', `#head ${'a'.repeat(40)}`];
  const fileLines = files.map((f) => `${KIND_MARK[f.kind]} ${f.path}`);
  const text = (flowLines: string[]) => `${[...header, ...fileLines, ...flowLines].join('\n')}\n`;
  const flowLines = [
    '#story A reviewer follows the change',
    '#step actor Reviewer',
    `#file ${first}`,
    `#file ${second}`,
    '#step action opens',
    '#step subject the change',
    `#file ${foundation}`,
    '#below consequence sees nothing => sees the files',
    `#file ${unmapped}`,
  ];

  async function mountRecord(lines: string[]) {
    const parsed = parsePrRecord(text(lines), `${PR_ID}.pr`);
    expect(parsed.error).toBeNull();
    expect(parsed.pr?.flowError).toBeUndefined();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const map = mapOf({ project: 'demo', nodes, relations, prs: [pr(PR_ID, { files, ordered: false, flow: parsed.pr?.flow })] });
    mounted.push(mountLanternView(root, map, { pr: PR_ID, readMacro: () => Promise.resolve(loaded), ...readers }));
    await flush();
    control(root, 'flow').click();
    return root;
  }

  it('keeps every reference of the record: the same chips, in the same steps, in the same order', async () => {
    const root = await mountRecord(flowLines);

    expect([...root.querySelectorAll('.lt-flow-step')].map((step) => chipPaths(step))).toEqual([[first, second], [], [foundation], [unmapped]]);
  });

  it('carries the references of the record all the way to the marks in the list, on Files and on Macro', async () => {
    const root = await mountRecord(flowLines);

    pickable(root)[0].click();
    expect(hitRows(root)).toEqual([first, second].sort());
    control(root, 'files').click();
    expect(litNodes(root)).toEqual([first, second].sort());
    control(root, 'macro').click();
    await flush();
    expect(reading(root)).toEqual(blockNames([first, second]));
  });

  it('moves a reference with its step when the record is written in another order', async () => {
    const swapped = [...flowLines];
    swapped.splice(4, 3, '#step subject the change', `#file ${foundation}`, '#step action opens');
    const root = await mountRecord(swapped);

    expect([...root.querySelectorAll('.lt-flow-step')].slice(0, 3).map((step) => chipPaths(step))).toEqual([[first, second], [foundation], []]);
  });

  it('shows no chip when the record has no #file line', async () => {
    const root = await mountRecord(flowLines.filter((line) => !line.startsWith('#file')));

    expect(chips(root)).toHaveLength(0);
    expect(pickable(root)).toHaveLength(0);
  });
});
