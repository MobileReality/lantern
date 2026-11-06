import type { SettingsNode } from './settings-schema';

export const NOTIFICATION_TIMBRES = ['bell', 'marimba', 'glass', 'synth', 'retro', 'none'] as const;

export type NotificationTimbre = (typeof NOTIFICATION_TIMBRES)[number];

export const NOTIFICATION_POSITIONS = ['left', 'center', 'right'] as const;

export type NotificationPosition = (typeof NOTIFICATION_POSITIONS)[number];

export const NOTIFICATION_KINDS = ['done', 'waiting', 'permission', 'error'] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const SOUND_SETTING_FOR_KIND = {
  done: 'notifications.doneSound',
  waiting: 'notifications.waitingSound',
  permission: 'notifications.permissionSound',
  error: 'notifications.errorSound',
} as const satisfies Record<NotificationKind, `notifications.${string}`>;

export const NOTIFICATION_SETTINGS = {
  id: 'notifications',
  title: 'Notifications',
  properties: {
    'notifications.enabled': {
      type: 'boolean',
      default: true,
      description: 'Show a notification card when a Claude session finishes, fails, needs your permission or is waiting for you.',
      order: 0,
    },
    'notifications.animations': {
      type: 'boolean',
      default: true,
      description: 'Animate cards as they appear, leave and move between screens. Always off when the system asks to reduce motion.',
      order: 1,
    },
    'notifications.followCursor': {
      type: 'boolean',
      default: true,
      description: 'Show cards on the screen under the mouse and move them along when the mouse changes screen. Off keeps them on the main screen.',
      order: 2,
    },
    'notifications.position': {
      type: 'string',
      enum: NOTIFICATION_POSITIONS,
      default: 'center',
      presentation: 'placement',
      description: 'Where cards appear along the top of the screen.',
      order: 3,
    },
    'notifications.dismissSeconds': {
      type: 'number',
      default: 10,
      minimum: 3,
      maximum: 60,
      description: 'How long a card stays before it dismisses itself. The countdown pauses while the mouse is over the card.',
      order: 4,
    },
    'notifications.volume': {
      type: 'number',
      default: 70,
      minimum: 0,
      maximum: 100,
      description: 'Volume of notification sounds.',
      order: 5,
    },
    'notifications.doneSound': {
      type: 'string',
      enum: NOTIFICATION_TIMBRES,
      default: 'bell',
      previewable: true,
      description: 'Sound when a session finishes: a quick rising arpeggio.',
      order: 6,
    },
    'notifications.waitingSound': {
      type: 'string',
      enum: NOTIFICATION_TIMBRES,
      default: 'glass',
      previewable: true,
      description: 'Sound when a session is waiting for you: a soft two-note question.',
      order: 7,
    },
    'notifications.permissionSound': {
      type: 'string',
      enum: NOTIFICATION_TIMBRES,
      default: 'synth',
      previewable: true,
      description: 'Sound when a session needs your permission: an urgent double pulse.',
      order: 8,
    },
    'notifications.errorSound': {
      type: 'string',
      enum: NOTIFICATION_TIMBRES,
      default: 'marimba',
      previewable: true,
      description: 'Sound when a session fails: a low falling step.',
      order: 9,
    },
  },
} satisfies SettingsNode;
