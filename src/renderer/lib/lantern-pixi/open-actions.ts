import { Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { PixiPalette } from './palette';
import { isPrimaryTap } from './pointer';

export interface FileActions {
  path: string;
  code: () => void;
  diff?: () => void;
}

type OpenKind = 'code' | 'diff';

const BUTTON = 16;
const BUTTON_GAP = 2;
const EDGE_GAP = 4;

export function actionsWidth(actions: FileActions | null) {
  if (!actions) return 0;
  const count = actions.diff ? 2 : 1;
  return count * BUTTON + (count - 1) * BUTTON_GAP + EDGE_GAP + 4;
}

function glyph(kind: OpenKind, color: number) {
  const g = new Graphics();
  if (kind === 'code') {
    g.moveTo(6, 4.5).lineTo(2.5, 8).lineTo(6, 11.5).moveTo(10, 4.5).lineTo(13.5, 8).lineTo(10, 11.5);
  } else {
    g.moveTo(5, 3.5).lineTo(5, 7.5).moveTo(3, 5.5).lineTo(7, 5.5).moveTo(9, 10.5).lineTo(13, 10.5).moveTo(5, 12.5).lineTo(11, 3.5);
  }
  return g.stroke({ color, width: 1.4, cap: 'round', join: 'round' });
}

function openButton(kind: OpenKind, x: number, y: number, palette: PixiPalette, open: () => void) {
  const button = new Container();
  button.position.set(x, y);
  button.eventMode = 'static';
  button.cursor = 'pointer';
  button.hitArea = new Rectangle(0, 0, BUTTON, BUTTON);
  const rest = glyph(kind, palette.ink3);
  const hover = glyph(kind, palette.ink);
  hover.visible = false;
  const plate = new Graphics().roundRect(0, 0, BUTTON, BUTTON, 3).fill({ color: palette.ink, alpha: 0.12 });
  plate.visible = false;
  button.addChild(plate, rest, hover);
  const show = (on: boolean) => {
    plate.visible = on;
    hover.visible = on;
    rest.visible = !on;
  };
  button.on('pointerover', () => show(true));
  button.on('pointerout', () => show(false));
  button.on('pointertap', (event: FederatedPointerEvent) => {
    event.stopPropagation();
    if (isPrimaryTap(event)) open();
  });
  return button;
}

export function drawFileActions(display: Container, width: number, height: number, palette: PixiPalette, actions: FileActions) {
  const y = (height - BUTTON) / 2;
  let x = width - EDGE_GAP - BUTTON;
  const group = new Container();
  group.label = 'file-actions';
  if (actions.diff) {
    group.addChild(openButton('diff', x, y, palette, actions.diff));
    x -= BUTTON + BUTTON_GAP;
  }
  group.addChild(openButton('code', x, y, palette, actions.code));
  display.addChild(group);
}

const OPEN_LABEL: Record<OpenKind, string> = { code: 'Open code of', diff: 'Open diff of' };

const handlers = new WeakMap<HTMLButtonElement, () => void>();

function accessButton(kind: OpenKind, path: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lt-pixi-open-access';
  button.dataset.openKind = kind;
  button.dataset.openPath = path;
  button.textContent = `${OPEN_LABEL[kind]} ${path}`;
  button.setAttribute('aria-label', `${OPEN_LABEL[kind]} ${path}`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.get(button)?.();
  });
  return button;
}

export function syncOpenButtons(host: HTMLElement, wanted: ReadonlyMap<string, FileActions>) {
  const keep = new Map<string, () => void>();
  for (const actions of wanted.values()) {
    keep.set(`code\0${actions.path}`, actions.code);
    if (actions.diff) keep.set(`diff\0${actions.path}`, actions.diff);
  }
  const present = new Set<string>();
  for (const button of host.querySelectorAll<HTMLButtonElement>('.lt-pixi-open-access')) {
    const id = `${button.dataset.openKind}\0${button.dataset.openPath}`;
    const open = keep.get(id);
    if (!open) button.remove();
    else {
      handlers.set(button, open);
      present.add(id);
    }
  }
  for (const [id, open] of keep) {
    if (present.has(id)) continue;
    const [kind, path] = id.split('\0') as [OpenKind, string];
    const button = accessButton(kind, path);
    handlers.set(button, open);
    host.appendChild(button);
  }
}
