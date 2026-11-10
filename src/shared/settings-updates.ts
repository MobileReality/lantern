import type { SettingsNode } from './settings-schema';

export const UPDATE_SETTINGS = {
  id: 'updates',
  title: 'Updates',
  properties: {
    'updates.checkAutomatically': {
      type: 'boolean',
      default: true,
      order: 1,
      description:
        'Look for a newer Lantern release when Lantern starts and every few hours after. On a Mac the update downloads by itself and installs only when nothing running would be ended; elsewhere a notice links to the release page. Off, Lantern makes no update requests at all, including from Check for Updates.',
    },
  },
} satisfies SettingsNode;
