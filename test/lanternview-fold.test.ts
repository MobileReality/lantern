// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SMALL_MAP_FILES } from '../src/renderer/lib/lanterncollapse';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';

const DIRS = ['api', 'core', 'data', 'jobs', 'util'];
const FILES_PER_DIR = 30;
const FILE_COUNT = DIRS.length * FILES_PER_DIR;
const ZOOMED_OUT = '50%';

const MAP = mapOf({
  nodes: DIRS.flatMap((dir) => Array.from({ length: FILES_PER_DIR }, (_, index) => node(`src/${dir}/file-${index}.ts`, 'service'))),
  total: FILE_COUNT,
});

const views: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
  document.body.replaceChildren();
});

function mountZoomedOut(opts?: ViewOptions) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, MAP, opts);
  views.push(view);
  const input = root.querySelector('[data-zoom-value]') as HTMLInputElement;
  input.dispatchEvent(new FocusEvent('focus'));
  input.value = ZOOMED_OUT;
  input.dispatchEvent(new FocusEvent('blur'));
  return { root, view };
}

const accessButtons = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')];
const dirTiles = (root: HTMLElement) => accessButtons(root).filter((button) => button.getAttribute('aria-description')?.includes('directory group'));

describe('lantern view folding gate', () => {
  it('uses a map large enough to fold', () => {
    expect(FILE_COUNT).toBeGreaterThan(SMALL_MAP_FILES);
  });

  it('folds directories when zoomed out by default', () => {
    const { root } = mountZoomedOut();
    expect(dirTiles(root)).toHaveLength(DIRS.length);
    expect(accessButtons(root).length).toBeLessThan(FILE_COUNT);
  });

  it('shows every file when folding is off and switches at runtime', () => {
    const { root, view } = mountZoomedOut({ foldFiles: false });
    expect(dirTiles(root)).toHaveLength(0);
    expect(accessButtons(root)).toHaveLength(FILE_COUNT);

    view.setFoldFiles(true);
    expect(dirTiles(root)).toHaveLength(DIRS.length);
    expect(accessButtons(root).length).toBeLessThan(FILE_COUNT);

    view.setFoldFiles(false);
    expect(dirTiles(root)).toHaveLength(0);
    expect(accessButtons(root)).toHaveLength(FILE_COUNT);
  });
});
