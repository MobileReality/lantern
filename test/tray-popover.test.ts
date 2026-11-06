import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayModel } from '../src/shared/tray-model';
import { model, manyGroups } from './fixtures/tray-groups';

const fake = vi.hoisted(() => {
  const ipc = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => void>();
  const windows: FakeWindow[] = [];
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  class FakeContents {
    sent: { channel: string; payload: unknown }[] = [];
    once = (_event: string, cb: () => void) => {
      this.loaded = cb;
    };
    loaded: () => void = () => {};
    on() {}
    send = (channel: string, payload: unknown) => this.sent.push({ channel, payload });
  }
  class FakeWindow {
    options: Record<string, unknown>;
    webContents = new FakeContents();
    handlers = new Map<string, () => void>();
    visible = false;
    bounds: unknown[] = [];
    opacity: number[] = [];
    loaded = '';
    constructor(options: Record<string, unknown>) {
      this.options = options;
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setOpacity(value: number) {
      this.opacity.push(value);
    }
    setBounds(bounds: unknown) {
      this.bounds.push(bounds);
    }
    on(event: string, cb: () => void) {
      this.handlers.set(event, cb);
    }
    loadFile(file: string) {
      this.loaded = file;
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    focus() {}
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return false;
    }
  }
  return {
    ipc,
    windows,
    workArea,
    electron: {
      BrowserWindow: FakeWindow,
      ipcMain: { on: (channel: string, handler: (event: { sender: unknown }, ...args: unknown[]) => void) => ipc.set(channel, handler) },
      screen: { on() {}, getPrimaryDisplay: () => ({ workArea }), getDisplayMatching: () => ({ workArea }) },
      systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: true }) },
    },
  };
});

vi.mock('electron', () => fake.electron);

let popover: typeof import('../src/main/tray-popover');

const icon = { x: 700, y: 0, width: 24, height: 25 };
const opened = { onOpenProject: vi.fn(), onAction: vi.fn() };
let current: TrayModel;

const win = () => fake.windows[0];
const sentChannels = () => win().webContents.sent.map((entry) => entry.channel);
const fromRenderer = (channel: string, ...args: unknown[]) => fake.ipc.get(channel)!({ sender: win().webContents }, ...args);

function openAndReveal(height = 300) {
  popover.toggle(icon);
  win().webContents.loaded();
  fromRenderer('tray:resize', height);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.resetModules();
  fake.windows.length = 0;
  popover = await import('../src/main/tray-popover');
  current = model(manyGroups());
  opened.onOpenProject.mockClear();
  opened.onAction.mockClear();
  popover.init({ model: () => current, ...opened });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening the popover', () => {
  it('is a frameless translucent panel that loads the popover page', () => {
    popover.toggle(icon);
    expect(win().options).toMatchObject({ type: 'panel', frame: false, transparent: true, vibrancy: 'hud', show: false, width: 340 });
    expect(win().loaded).toMatch(/renderer[/\\]tray-popover\.html$/);
  });

  it('sends the model and the room below the icon once the page has loaded, and shows the window when the page reports its height', () => {
    popover.toggle(icon);
    expect(win().visible).toBe(false);
    win().webContents.loaded();
    expect(win().webContents.sent).toEqual([{ channel: 'tray:open', payload: { model: current, maxHeight: 861 } }]);
    fromRenderer('tray:resize', 320);
    expect(win().visible).toBe(true);
    expect(win().bounds.at(-1)).toEqual({ x: 542, y: 31, width: 340, height: 320 });
  });

  it('shows the window anyway if the page never reports a height', () => {
    popover.toggle(icon);
    win().webContents.loaded();
    vi.advanceTimersByTime(200);
    expect(win().visible).toBe(true);
  });

  it('reuses the window on the next open and sends a fresh model', () => {
    openAndReveal();
    fromRenderer('tray:close');
    vi.advanceTimersByTime(400);
    current = model([]);
    popover.toggle({ ...icon, x: 1000 });
    expect(fake.windows).toHaveLength(1);
    expect(win().webContents.sent.at(-1)).toMatchObject({ channel: 'tray:open', payload: { model: { empty: true } } });
  });

  it('closes when the icon is clicked while it is open', () => {
    openAndReveal();
    popover.toggle(icon);
    expect(win().visible).toBe(false);
  });
});

describe('closing the popover', () => {
  it('hides on blur once it has had a moment to take focus', () => {
    openAndReveal();
    vi.advanceTimersByTime(300);
    win().handlers.get('blur')!();
    expect(win().visible).toBe(false);
  });

  it('ignores a blur in the instant it appears', () => {
    openAndReveal();
    win().handlers.get('blur')!();
    expect(win().visible).toBe(true);
  });

  it('does not reopen from the click that blurred it', () => {
    openAndReveal();
    vi.advanceTimersByTime(300);
    win().handlers.get('blur')!();
    const sent = win().webContents.sent.length;
    vi.advanceTimersByTime(50);
    popover.toggle(icon);
    expect(win().visible).toBe(false);
    expect(win().webContents.sent.length).toBe(sent);
    vi.advanceTimersByTime(400);
    popover.toggle(icon);
    expect(win().webContents.sent.length).toBe(sent + 1);
  });

  it('hides on Escape from the page', () => {
    openAndReveal();
    fromRenderer('tray:close');
    expect(win().visible).toBe(false);
  });
});

describe('staying live', () => {
  it('pushes a changed model while open and not while hidden', () => {
    openAndReveal();
    current = model(manyGroups().slice(2));
    popover.update();
    expect(win().webContents.sent.at(-1)).toEqual({ channel: 'tray:model', payload: current });
    fromRenderer('tray:close');
    const sent = win().webContents.sent.length;
    popover.update();
    expect(win().webContents.sent.length).toBe(sent);
  });

  it('sends nothing when the periodic refresh finds the model unchanged, so the open popover does not rebuild or scroll back', () => {
    openAndReveal();
    const sent = win().webContents.sent.length;
    popover.update();
    popover.update();
    expect(win().webContents.sent.length).toBe(sent);
    current = model(manyGroups().slice(1));
    popover.update();
    popover.update();
    expect(win().webContents.sent.length).toBe(sent + 1);
  });

  it('resizes to the new height while open', () => {
    openAndReveal(300);
    fromRenderer('tray:resize', 420);
    expect(win().bounds.at(-1)).toMatchObject({ height: 420 });
  });

  it('ignores a height that is not a number', () => {
    openAndReveal(300);
    const placed = win().bounds.length;
    fromRenderer('tray:resize', Number.NaN);
    fromRenderer('tray:resize', '9000');
    expect(win().bounds.length).toBe(placed);
  });
});

describe('what the page may ask for', () => {
  it('opens a project the popover listed, and closes', () => {
    openAndReveal();
    fromRenderer('tray:open-project', '/Users/ada/GIT/clients/acme/shop-frontend');
    expect(opened.onOpenProject).toHaveBeenCalledWith('/Users/ada/GIT/clients/acme/shop-frontend');
    expect(win().visible).toBe(false);
  });

  it('refuses a path the popover never listed', () => {
    openAndReveal();
    fromRenderer('tray:open-project', '/etc');
    fromRenderer('tray:open-project', 42);
    expect(opened.onOpenProject).not.toHaveBeenCalled();
    expect(win().visible).toBe(true);
  });

  it('runs a known action and closes', () => {
    openAndReveal();
    fromRenderer('tray:action', 'clear');
    fromRenderer('tray:action', 'test:permission');
    expect(opened.onAction.mock.calls).toEqual([[{ type: 'clear' }], [{ type: 'test', kind: 'permission' }]]);
  });

  it('refuses an unknown action, and a test card the menu did not offer', () => {
    current = model(manyGroups(), false);
    openAndReveal();
    fromRenderer('tray:action', 'reboot');
    fromRenderer('tray:action', 'test:done');
    expect(opened.onAction).not.toHaveBeenCalled();
    expect(win().visible).toBe(true);
  });

  it('ignores messages from any other window', () => {
    openAndReveal();
    fake.ipc.get('tray:open-project')!({ sender: {} }, '/Users/ada/GIT/clients/acme/shop-frontend');
    fake.ipc.get('tray:action')!({ sender: {} }, 'quit');
    fake.ipc.get('tray:close')!({ sender: {} });
    expect(opened.onOpenProject).not.toHaveBeenCalled();
    expect(opened.onAction).not.toHaveBeenCalled();
    expect(win().visible).toBe(true);
  });
});
