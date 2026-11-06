import type { SettingsNode } from './settings-schema';

export const DEFAULT_IDLE_TAB_MINUTES = 10;
const MIN_IDLE_TAB_MINUTES = 1;
const MAX_IDLE_TAB_MINUTES = 24 * 60;

export const TAB_SETTINGS = {
  id: 'tabs',
  title: 'Project tabs',
  properties: {
    'tabs.closeIdleProjectTabs': {
      type: 'boolean',
      default: false,
      order: 1,
      description:
        'Close a project tab that has not been selected for the idle time and has no running or waiting agent session (a session that has finished its turn, including a chat idle at its prompt, does not keep the tab open), so the editor server can free its memory about a minute later. Reopening the project opens a fresh tab. Takes effect for the server the next time Lantern starts it.',
    },
    'tabs.idleMinutes': {
      type: 'number',
      default: DEFAULT_IDLE_TAB_MINUTES,
      minimum: MIN_IDLE_TAB_MINUTES,
      maximum: MAX_IDLE_TAB_MINUTES,
      order: 2,
      description: 'Minutes a project tab can stay unselected before it is closed. Only used when "Close idle project tabs" is on.',
    },
  },
} satisfies SettingsNode;
