// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';
import { mountLanternView } from '../src/renderer/lib/lanternview';

const rel = (from: string, arrow: '>' | '<' | '=', to: string) => ({ from, arrow, to, ext: null, symbol: null, label: '' });
const MAP: LanternMap = mapOf({
  nodes: [node('src/page.tsx', 'page'), node('src/svc.ts', 'service'), node('src/repo.ts', 'repository'), node('src/util.ts', 'util'), node('src/lone.ts', 'util')],
  relations: [rel('src/page.tsx', '>', 'src/svc.ts'), rel('src/svc.ts', '<', 'src/repo.ts'), rel('src/repo.ts', '=', 'src/util.ts')],
  prs: [pr('3', { files: [{ path: 'src/svc.ts', kind: 'modified', mapped: true }] })],
});
const views: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => { views.splice(0).forEach((view) => { view.dispose(); }); document.body.replaceChildren(); });
function mount(pr?: string) { const root = document.createElement('div'); document.body.appendChild(root); views.push(mountLanternView(root, MAP, { pr })); return root; }
const nodeButton = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')].find((button) => button.textContent === name) as HTMLButtonElement;
const click = (root: HTMLElement, name: string) => nodeButton(root, name).click();
const selected = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access[aria-pressed="true"]')].map((button) => button.textContent);
const related = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')].filter((button) => button.getAttribute('aria-description')?.match(/selected|related/)).map((button) => button.textContent).sort();
const targets = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-detail [data-go]')].map((button) => button.dataset.go).filter(Boolean).sort();

describe('relations belong to the selected file', () => {
  it('starts with every node present and no selection', () => { const root = mount(); expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(5); expect(selected(root)).toEqual([]); expect(related(root)).toEqual([]); });
  it('keeps the relation count while nothing is selected', () => { expect(mount().querySelector('.stats')?.textContent).toContain('3of 3 relations'); });
  it('does not select on hover or keyboard focus', () => { const root = mount(); nodeButton(root, 'svc.ts').dispatchEvent(new Event('mouseenter')); nodeButton(root, 'svc.ts').focus(); expect(selected(root)).toEqual([]); expect(related(root)).toEqual([]); });
  it('marks the selected node and its neighbours', () => { const root = mount(); click(root, 'svc.ts'); expect(selected(root)).toEqual(['svc.ts']); expect(related(root)).toEqual(['page.tsx', 'repo.ts', 'svc.ts']); expect(targets(root)).toEqual(['src/page.tsx', 'src/repo.ts']); });
  it('replaces the relation set when another node is selected', () => { const root = mount(); click(root, 'svc.ts'); click(root, 'util.ts'); expect(selected(root)).toEqual(['util.ts']); expect(related(root)).toEqual(['repo.ts', 'util.ts']); });
  it('selects a node without relations without inventing neighbours', () => { const root = mount(); click(root, 'lone.ts'); expect(related(root)).toEqual(['lone.ts']); expect(root.querySelector('.lt-detail .none')?.textContent).toContain('No relations'); });
  it('clears on a second activation', () => { const root = mount(); click(root, 'svc.ts'); click(root, 'svc.ts'); expect(selected(root)).toEqual([]); expect(related(root)).toEqual([]); expect(root.querySelector('.lt-detail')).toBeNull(); });
  it('selects a different node directly', () => { const root = mount(); click(root, 'svc.ts'); click(root, 'page.tsx'); expect(selected(root)).toEqual(['page.tsx']); expect(related(root)).toEqual(['page.tsx', 'svc.ts']); });
  it('selects a related node from the detail panel', () => { const root = mount(); click(root, 'svc.ts'); (root.querySelector('[data-go="src/repo.ts"]') as HTMLButtonElement).click(); expect(selected(root)).toEqual(['repo.ts']); expect(related(root)).toEqual(['repo.ts', 'svc.ts', 'util.ts']); });
  it('describes the selected role and layer', () => { const root = mount(); click(root, 'svc.ts'); expect(nodeButton(root, 'svc.ts').getAttribute('aria-description')).toContain('service in Domain'); });
  it('respects the relation-kind filter in the graph relation set', () => { const root = mount(); (root.querySelector('[data-kind="<"]') as HTMLButtonElement).click(); click(root, 'svc.ts'); expect(related(root)).toEqual(['repo.ts', 'svc.ts']); });
  it('restores the selected relation set when a filter brings the file back', () => { const root = mount(); click(root, 'svc.ts'); (root.querySelector('[data-role="util"]') as HTMLButtonElement).click(); expect(selected(root)).toEqual([]); (root.querySelector('[data-role="util"]') as HTMLButtonElement).click(); expect(selected(root)).toEqual(['svc.ts']); expect(related(root)).toEqual(['page.tsx', 'repo.ts', 'svc.ts']); });
});

describe('pull request context with relations', () => {
  it('keeps PR membership while projecting relation membership', () => { const root = mount('3'); click(root, 'svc.ts'); expect(nodeButton(root, 'svc.ts').classList.contains('pr-hit')).toBe(true); expect(nodeButton(root, 'page.tsx').classList.contains('pr-off')).toBe(true); expect(related(root)).toEqual(['page.tsx', 'repo.ts', 'svc.ts']); });
  it('keeps unrelated PR-off files outside the relation set', () => { const root = mount('3'); click(root, 'svc.ts'); expect(nodeButton(root, 'lone.ts').classList.contains('pr-off')).toBe(true); expect(nodeButton(root, 'lone.ts').getAttribute('aria-description')).not.toContain('related'); });
});
