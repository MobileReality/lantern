import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate } from '../src/main/app-menu';
import { defaultBindings, resolveKeymap } from '../src/shared/commands/keymap';
import type { KeyBinding } from '../src/shared/commands/keymap';

const keys = (overrides: KeyBinding[] = []) => resolveKeymap([...defaultBindings(), ...overrides]).byCommand;
const submenuOf = (item: MenuItemConstructorOptions) => item.submenu as MenuItemConstructorOptions[];
const labelled = (items: MenuItemConstructorOptions[], label: string) => items.find((item) => item.label === label)!;
const roles = (items: MenuItemConstructorOptions[]) => items.map((item) => item.role ?? item.type ?? item.label);
const lanternItems = (platform: NodeJS.Platform, run = vi.fn(), byCommand = keys()) => submenuOf(appMenuTemplate(platform, 'Lantern', run, byCommand)[0]);

describe('application menu', () => {
  it('puts the command items between About and Services in the macOS app menu', () => {
    const [app] = appMenuTemplate('darwin', 'Lantern', vi.fn(), keys());
    expect(app.label).toBe('Lantern');
    expect(roles(submenuOf(app))).toEqual(['about', 'separator', 'Command palette…', 'Settings…', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit']);
  });

  it('keeps the standard File, Edit, View and Window menus on macOS', () => {
    expect(roles(appMenuTemplate('darwin', 'Lantern', vi.fn(), keys()).slice(1))).toEqual(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu']);
  });

  it.each(['win32', 'linux'] as const)('keeps the standard Edit, View and Window menus on %s', (platform) => {
    expect(roles(appMenuTemplate(platform, 'Lantern', vi.fn(), keys()).slice(1))).toEqual(['editMenu', 'viewMenu', 'windowMenu']);
  });

  it.each(['win32', 'linux'] as const)('puts the command items in the File menu on %s', (platform) => {
    const [file] = appMenuTemplate(platform, 'Lantern', vi.fn(), keys());
    expect(file.label).toBe('File');
    expect(roles(submenuOf(file))).toEqual(['Command palette…', 'Settings…', 'separator', 'quit']);
  });

  it.each(['darwin', 'linux'] as const)('takes the default accelerators from the keymap on %s', (platform) => {
    const items = lanternItems(platform);
    expect(labelled(items, 'Command palette…').accelerator).toBe('CmdOrCtrl+Shift+P');
    expect(labelled(items, 'Settings…').accelerator).toBe('CmdOrCtrl+,');
  });

  it.each([
    ['Command palette…', 'palette.open'],
    ['Settings…', 'settings.open'],
  ] as const)('runs its command when %s is clicked', (label, id) => {
    const run = vi.fn();
    (labelled(lanternItems('darwin', run), label).click as () => void)();
    expect(run).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('follows a user override of the key', () => {
    const items = lanternItems('darwin', vi.fn(), keys([{ key: 'mod+shift+k', command: 'palette.open' }]));
    expect(labelled(items, 'Command palette…').accelerator).toBe('CmdOrCtrl+Shift+K');
  });

  it('drops the accelerator when the binding is removed', () => {
    const items = lanternItems('darwin', vi.fn(), keys([{ key: 'mod+,', command: '-settings.open' }]));
    expect(labelled(items, 'Settings…').accelerator).toBeUndefined();
    expect(labelled(items, 'Command palette…').accelerator).toBe('CmdOrCtrl+Shift+P');
  });
});
