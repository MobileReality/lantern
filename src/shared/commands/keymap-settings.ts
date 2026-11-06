import type { SettingsNode } from '../settings-schema';

export const KEYMAP_SETTINGS = {
  id: 'keymap',
  title: 'Keyboard shortcuts',
  properties: {
    'keymap.bindings': {
      type: 'bindings',
      default: [],
      description:
        'A list of { "key", "command" } entries layered over the default shortcuts, for example { "key": "mod+shift+l", "command": "lantern.open" }. Later entries win. A command written as "-id" removes that default binding for the key. "mod" is Cmd on a Mac and Ctrl elsewhere. An unknown command or a malformed entry makes the whole list invalid, and the default shortcuts are used instead.',
    },
  },
} satisfies SettingsNode;
