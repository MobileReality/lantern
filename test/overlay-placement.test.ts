import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  let workArea = { x: 0, y: 25, width: 2560, height: 1415 };
  const display = () => ({ id: workArea.x, workArea });
  const windows: { bounds: unknown[] }[] = [];
  class FakeWindow {
    bounds: unknown[] = [];
    webContents = { once() {}, on() {}, send() {} };
    constructor() {
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    setOpacity() {}
    getOpacity() {
      return 1;
    }
    on() {}
    loadFile() {}
    isDestroyed() {
      return false;
    }
    isVisible() {
      return true;
    }
    showInactive() {}
    setBounds(bounds: unknown) {
      this.bounds.push(bounds);
    }
  }
  return {
    handlers,
    windows,
    moveScreen: (x: number) => {
      workArea = { ...workArea, x };
    },
    electron: {
      BrowserWindow: FakeWindow,
      ipcMain: { on() {} },
      systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
      screen: {
        on: (event: string, cb: () => void) => handlers.set(event, cb),
        getPrimaryDisplay: display,
        getDisplayNearestPoint: display,
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
        getAllDisplays: () => [display()],
      },
    },
  };
});

vi.mock('electron', () => fake.electron);

const { anchorIn, init, show } = await import('../src/main/overlay');

const workArea = { x: 2560, y: 25, width: 2560, height: 1415 };

describe('anchorIn', () => {
  it('places the card left, centred or right along the top of the work area', () => {
    expect(anchorIn(workArea, 135, 0, 'left')).toEqual({ x: 2576, y: 41, width: 440, height: 135 });
    expect(anchorIn(workArea, 135, 0, 'center')).toEqual({ x: 3620, y: 41, width: 440, height: 135 });
    expect(anchorIn(workArea, 135, 0, 'right')).toEqual({ x: 4664, y: 41, width: 440, height: 135 });
  });

  it('offsets the top while the card slides in', () => {
    expect(anchorIn(workArea, 135, -22, 'center').y).toBe(19);
  });
});

describe('display changes', () => {
  it('re-places a visible card on the current screen when monitors change', () => {
    init({
      onOpen() {},
      prefs: () => ({ animations: false, dismissMs: 1000, volume: 0, timbre: 'none' }),
      followCursor: () => false,
      animations: () => false,
      position: () => 'left',
    });
    show({ id: 'a', kind: 'done', title: 't', context: 'c', cwd: '', repoName: 'r', branch: 'b' });
    fake.moveScreen(1000);
    fake.handlers.get('display-removed')!();
    const last = fake.windows[0].bounds.at(-1) as { x: number };
    expect(last.x).toBe(1016);
    expect([...fake.handlers.keys()].sort()).toEqual(['display-added', 'display-metrics-changed', 'display-removed']);
  });
});
