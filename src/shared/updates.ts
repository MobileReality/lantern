export const UPDATE_NOTICE_CHANNEL = 'update:notice';
export const UPDATE_GET_CHANNEL = 'update:get';
export const UPDATE_ACTION_CHANNEL = 'update:action';

export const UPDATE_ACTIONS = ['restart', 'later', 'view', 'dismiss'] as const;
export type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export type UpdateNotice =
  | { kind: 'ready'; version: string; waiting: boolean }
  | { kind: 'available'; version: string };

export function parseUpdateAction(value: unknown): UpdateAction | null {
  return typeof value === 'string' && (UPDATE_ACTIONS as readonly string[]).includes(value) ? (value as UpdateAction) : null;
}
