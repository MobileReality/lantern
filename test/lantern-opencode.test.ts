// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import type { ProjectFile } from '../src/main/filecontent';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';
import { RBAC } from './helpers/lantern-sections';

const SOURCE = ['import x from "x";', '// buildPrompt builds it', '', 'const pad = 1;', 'export function buildPrompt() {', '  return 1;', '}'].join('\n');

const DATA: LanternMap = mapOf({
  nodes: [
    node('src/agent.ts', 'service', { seeAlso: ['src/util.ts', 'src/gone.ts'] }),
    node('src/agent.test.ts', 'test'),
    node('src/util.ts', 'service'),
    node('src/auth.ts', 'middleware'),
    node('src/order.ts', 'service'),
  ],
  relations: [
    { from: 'src/agent.ts', arrow: '>', to: 'src/util.ts', ext: null, symbol: 'buildPrompt', label: '' },
    { from: 'src/agent.ts', arrow: '<', to: null, ext: 'claude-cli', symbol: null, label: '' },
    { from: 'src/agent.ts', arrow: '=', to: 'src/nowhere.ts', ext: null, symbol: null, label: '' },
    { from: 'src/agent.test.ts', arrow: '>', to: 'src/agent.ts', ext: null, symbol: 'run', label: '' },
  ] as LanternMap['relations'],
});

const mounted: ReturnType<typeof mountLanternView>[] = [];

function setup(read: (p: string) => Promise<ProjectFile>, data = DATA) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, data, { readFile: read }));
  const el = [...root.querySelectorAll('.lt-pixi-node-access')].find((button) => button.getAttribute('aria-label') === 'src/agent.ts') as HTMLButtonElement;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return root;
}

const ok = (text: string): ProjectFile => ({ exists: true, text, truncated: 0 });
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

describe('open-code button in the detail pane', () => {
  it('shows for mapped files and see-also rows, not for ext: or unmapped targets', () => {
    const root = setup(async () => ok(SOURCE));
    const codes = [...root.querySelectorAll('.lt-detail li button[data-code]')].map((b) => `${b.getAttribute('data-code')}#${b.getAttribute('data-symbol')}`);
    expect(codes).toEqual(['src/util.ts#', 'src/util.ts#buildPrompt', 'src/agent.test.ts#run']);
    const rows = [...root.querySelectorAll('.lt-detail li')];
    expect(rows.find((r) => r.textContent?.includes('ext:claude-cli'))?.querySelector('.code-open')).toBeNull();
    expect(rows.find((r) => r.textContent?.includes('src/nowhere.ts'))?.querySelector('.code-open')).toBeNull();
    expect(rows.find((r) => r.textContent?.includes('gone.ts src/'))?.querySelector('.code-open')).toBeNull();
  });

  it('is a labelled, focusable button', () => {
    const root = setup(async () => ok(SOURCE));
    const b = root.querySelector('.lt-detail li .code-open') as HTMLButtonElement;
    expect(b.tagName).toBe('BUTTON');
    expect(b.dataset.tip).toBe('Open code');
    expect(b.getAttribute('aria-label')).toBe('Open code of src/util.ts');
    expect(root.querySelector('.code-open[data-symbol="buildPrompt"]')?.getAttribute('aria-label')).toBe('Open code of src/util.ts#buildPrompt');
  });

  it('is absent when no reader is wired', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, DATA));
    (root.querySelector('.lt-pixi-node-access') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('.code-open')).toBeNull();
  });

  it('opens the modal, reads the relative path and highlights the declaration line', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const read = vi.fn(async () => ok(SOURCE));
    const root = setup(read);
    (root.querySelector('.code-open[data-code="src/util.ts"][data-symbol="buildPrompt"]') as HTMLElement).click();
    expect(root.querySelector('.lt-code-modal .lt-code-path')?.textContent).toBe('util.ts src/ #buildPrompt');
    await flush();
    expect(read).toHaveBeenCalledWith('src/util.ts');
    const rows = [...root.querySelectorAll('.lt-code-modal .cl')];
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.classList.contains('target')).map((r) => rows.indexOf(r) + 1)).toEqual([5]);
    expect(rows[4].querySelectorAll('.ln')[1].textContent).toBe('5');
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(root.querySelector('.lt-code-note')?.textContent).toBe('');
  });

  it('does not select the file in the graph when the button is clicked', async () => {
    const root = setup(async () => ok(SOURCE));
    (root.querySelector('.code-open[data-code="src/util.ts"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-detail .path .file-label')?.getAttribute('data-tip')).toContain('src/agent.ts');
  });

  it('keeps the row click working', () => {
    const root = setup(async () => ok(SOURCE));
    (root.querySelector('.lt-detail button[data-go="src/util.ts"]') as HTMLElement).click();
    expect(root.querySelector('.lt-detail .path .file-label')?.getAttribute('data-tip')).toContain('src/util.ts');
    expect(root.querySelector('.lt-code-modal')).toBeNull();
  });

  it('shows a note and starts at the top when the symbol is missing', async () => {
    const root = setup(async () => ok('const a = 1;\nconst b = 2;'));
    (root.querySelector('.code-open[data-symbol="buildPrompt"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-code-note')?.textContent).toContain('#buildPrompt not found');
    expect(root.querySelector('.lt-code-modal .cl.target')).toBeNull();
  });

  it('shows a refusal or missing-file message', async () => {
    const root = setup(async () => ({ exists: false, text: '', truncated: 0, refused: true }));
    (root.querySelector('.code-open') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-code-modal .rv-trunc')?.textContent).toContain('outside the project');
  });

  it('shows a truncation notice', async () => {
    const root = setup(async () => ({ ...ok(SOURCE), truncated: 12 }));
    (root.querySelector('.code-open') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-code-modal .rv-trunc')?.textContent).toContain('12 more lines');
  });

  it('Esc closes only the modal, then only the section overlay', async () => {
    const data = mapOf({ ...DATA, sections: [RBAC] });
    const root = setup(async () => ok(SOURCE), data);
    (root.querySelector('.lt-sec[data-section="rbac"]') as HTMLElement).click();
    const overlay = root.querySelector('.lt-overlay') as HTMLElement;
    expect(overlay.hidden).toBe(false);
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const press = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const cite = root.querySelector('.lt-overlay .code-open') as HTMLElement;
    expect(cite).not.toBeNull();
    cite.click();
    await flush();
    expect(root.querySelector('.lt-code-modal')).not.toBeNull();
    expect(overlay.hidden).toBe(false);
    press();
    expect(root.querySelector('.lt-code-modal')).toBeNull();
    expect(overlay.hidden).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    press();
    expect(overlay.hidden).toBe(true);
    document.removeEventListener('keydown', outer);
  });

  it('closes with the close button and returns focus to the opener', async () => {
    const root = setup(async () => ok(SOURCE));
    const opener = root.querySelector('.code-open') as HTMLElement;
    opener.focus();
    opener.click();
    await flush();
    (root.querySelector('.lt-code-modal .modal-close') as HTMLElement).click();
    expect(root.querySelector('.lt-code-modal')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
