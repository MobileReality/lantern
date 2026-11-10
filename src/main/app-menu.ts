import type { MenuItemConstructorOptions } from 'electron';
import { COMMANDS } from '../shared/commands';
import type { CommandId } from '../shared/commands';
import { accelerator } from '../shared/commands/keymap';
import { msg } from '../shared/lang/messages';

export function appMenuTemplate(
  platform: NodeJS.Platform,
  appName: string,
  run: (id: CommandId) => void,
  byCommand: ReadonlyMap<CommandId, string>,
  checkForUpdates?: () => void,
): MenuItemConstructorOptions[] {
  const commandItems = COMMANDS.filter((c) => c.schema.menu).map((c): MenuItemConstructorOptions => {
    const keys = byCommand.get(c.id);
    return { label: `${c.schema.title}…`, accelerator: keys ? accelerator(keys) : undefined, click: () => run(c.id) };
  });
  const updateItems: MenuItemConstructorOptions[] = checkForUpdates ? [{ label: msg('updates.menu'), click: () => checkForUpdates() }] : [];
  const standard: MenuItemConstructorOptions[] = [{ role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }];
  if (platform !== 'darwin') {
    const afterCommands: MenuItemConstructorOptions[] = checkForUpdates ? [{ type: 'separator' }, ...updateItems] : [];
    return [{ label: 'File', submenu: [...commandItems, ...afterCommands, { type: 'separator' }, { role: 'quit' }] }, ...standard];
  }
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        ...updateItems,
        { type: 'separator' },
        ...commandItems,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    ...standard,
  ];
}
