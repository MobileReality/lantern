// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import type { ProjectFile } from '../src/main/filecontent';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';

const SOURCE = ['const a = 1;', 'export function run() {}', ''].join('\n');
const ok = (text: string): ProjectFile => ({ exists: true, text, truncated: 0 });
const flush = () => new Promise((r) => setTimeout(r, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];

function dataWith(freshness: 'fresh' | 'gone'): LanternMap {
  return mapOf({ nodes: [node('src/agent.ts', 'service', { freshness }), node('src/util.ts', 'service')] });
}

function setup(data: LanternMap, read?: (p: string) => Promise<ProjectFile>) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, data, read ? { readFile: read } : {}));
  const el = [...root.querySelectorAll('.lt-pixi-node-access')].find((button) => button.getAttribute('aria-label') === 'src/agent.ts') as HTMLButtonElement;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return root;
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

describe('open-this-file button in the detail card header', () => {
  it('shows next to the path and reads that file at its relative path', async () => {
    const read = vi.fn(async () => ok(SOURCE));
    const root = setup(dataWith('fresh'), read);
    const b = root.querySelector('.lt-detail .path .code-open') as HTMLButtonElement;
    expect(b.dataset.tip).toBe('Open this file');
    expect(b.getAttribute('data-code')).toBe('src/agent.ts');
    b.click();
    await flush();
    expect(read).toHaveBeenCalledWith('src/agent.ts');
    expect(root.querySelector('.lt-code-modal .lt-code-path')?.textContent).toBe('agent.ts src/');
    expect(root.querySelectorAll('.lt-code-modal .cl')).toHaveLength(3);
    expect(root.querySelector('.lt-code-modal .cl.target')).toBeNull();
  });

  it('is absent for a gone file', () => {
    const root = setup(dataWith('gone'), async () => ok(SOURCE));
    expect(root.querySelector('.lt-detail')).not.toBeNull();
    expect(root.querySelector('.lt-detail .path .code-open')).toBeNull();
  });

  it('is absent when no reader is wired', () => {
    const root = setup(dataWith('fresh'));
    expect(root.querySelector('.lt-detail')).not.toBeNull();
    expect(root.querySelector('.lt-detail .path .code-open')).toBeNull();
  });

  it('Esc closes only the modal and keeps the card selected', async () => {
    const root = setup(dataWith('fresh'), async () => ok(SOURCE));
    (root.querySelector('.lt-detail .path .code-open') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.lt-code-modal')).not.toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.lt-code-modal')).toBeNull();
    expect(root.querySelector('.lt-detail .path .file-label')?.getAttribute('data-tip')).toContain('src/agent.ts');
  });
});
