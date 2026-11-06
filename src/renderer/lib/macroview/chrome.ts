import { createDock } from './dock';
import type { Dock } from './dock';

const ROOT_LABEL = 'Product map. Scroll or pinch to zoom, drag to pan. Arrow keys move between neighbours, Enter dives in, Escape steps out, 0 fits everything.';
const HINT_TEXT = 'Scroll or pinch to zoom · drag to pan · Enter dives in · Esc steps out';

interface Chrome {
  shell: HTMLDivElement;
  root: HTMLDivElement;
  bar: HTMLElement;
  dock: Dock;
  readout: HTMLElement;
  hint: HTMLElement;
}

function createChrome(): Chrome {
  const shell = document.createElement('div');
  shell.className = 'mv-shell';
  const root = document.createElement('div');
  root.className = 'lt-macroview';
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-roledescription', 'zoomable map');
  root.setAttribute('aria-label', ROOT_LABEL);
  const bar = document.createElement('div');
  bar.className = 'mv-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Map zoom controls');
  bar.innerHTML = '<button type="button" data-zoom="out" aria-label="Zoom out" data-tip="Zoom out (-)">−</button><span class="mv-readout" role="status" aria-live="off"></span><button type="button" data-zoom="in" aria-label="Zoom in" data-tip="Zoom in (+)">+</button><button type="button" data-zoom="fit" data-tip="Fit everything (0)">Fit</button>';
  const hint = document.createElement('p');
  hint.className = 'mv-hint';
  hint.textContent = HINT_TEXT;
  hint.dataset.tip = HINT_TEXT;
  const dock = createDock();
  root.append(bar, hint);
  shell.append(root, dock.root);
  return { shell, root, bar, dock, readout: bar.querySelector('.mv-readout') as HTMLElement, hint };
}

function stopBubbling(...parts: HTMLElement[]) {
  for (const part of parts) for (const type of ['pointerdown', 'pointerup', 'dblclick'] as const) part.addEventListener(type, (event) => event.stopPropagation());
}

export { createChrome, stopBubbling };
export type { Chrome };
