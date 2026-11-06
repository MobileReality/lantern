import { describe, expect, it, vi } from 'vitest';
import { compactTrayMenu, fullTrayMenu, type TrayMenuDeps } from '../src/main/tray-menu';

function deps(over: Partial<TrayMenuDeps> = {}): TrayMenuDeps {
  return {
    projects: [
      { name: 'shop', path: '/w/shop', emoji: '🟠' },
      { name: 'ledger', path: '/w/ledger', emoji: '' },
    ],
    tests: [
      { kind: 'done', label: 'Done' },
      { kind: 'error', label: 'Failed' },
    ],
    openProject: vi.fn(),
    openWorkspace: vi.fn(),
    clearFinished: vi.fn(),
    testNotification: vi.fn(),
    quit: vi.fn(),
    ...over,
  };
}

const labels = (items: Electron.MenuItemConstructorOptions[]) => items.filter((item) => item.type !== 'separator').map((item) => item.label);

describe('the compact tray menu', () => {
  it('has Open workspace, Clear finished and Quit only', () => {
    expect(labels(compactTrayMenu(deps()))).toEqual(['Open workspace…', 'Clear finished', 'Quit']);
  });

  it('runs what the full menu runs', () => {
    const d = deps();
    const [open, clear, , quit] = compactTrayMenu(d);
    (open.click as () => void)();
    (clear.click as () => void)();
    (quit.click as () => void)();
    expect([d.openWorkspace, d.clearFinished, d.quit].map((fn) => vi.mocked(fn).mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe('the full tray menu kept for other platforms', () => {
  it('lists the title, projects, actions, test notifications and Quit as it always did', () => {
    expect(labels(fullTrayMenu(deps()))).toEqual(['Lantern', '🟠  shop', '📁  ledger', 'Open workspace…', 'Clear finished', 'Test notification', 'Quit']);
  });

  it('says there are no projects and leaves out test notifications when they are off', () => {
    expect(labels(fullTrayMenu(deps({ projects: [], tests: [] })))).toEqual(['Lantern', 'No projects', 'Open workspace…', 'Clear finished', 'Quit']);
  });

  it('opens a project and fires a test card from its items', () => {
    const d = deps();
    const items = fullTrayMenu(d);
    (items.find((item) => item.label === '🟠  shop')!.click as () => void)();
    const test = items.find((item) => item.label === 'Test notification')!.submenu as Electron.MenuItemConstructorOptions[];
    (test[1].click as () => void)();
    expect(d.openProject).toHaveBeenCalledWith('/w/shop');
    expect(d.testNotification).toHaveBeenCalledWith('error');
  });
});
