import type { UpdateAction, UpdateNotice } from '../../shared/updates';
import { updateNoticeView } from '../lib/update-notice-view';
import { byId } from '../lib/util';

export interface UpdateNoticeActions {
  notice(): Promise<UpdateNotice | null>;
  act(action: UpdateAction): Promise<unknown>;
  onNotice(listener: (notice: UpdateNotice | null) => void): void;
}

export async function showUpdateNotice(actions: UpdateNoticeActions) {
  const host = byId('update-notice');
  const title = byId('update-notice-title');
  const text = byId('update-notice-text');
  const primary = byId('update-notice-primary');
  const secondary = byId('update-notice-secondary');

  const paint = (notice: UpdateNotice | null) => {
    if (!notice) return host.classList.add('hidden');
    const view = updateNoticeView(notice);
    title.textContent = view.title;
    text.textContent = view.text;
    primary.textContent = view.primary.label;
    primary.dataset.action = view.primary.action;
    secondary.textContent = view.secondary.label;
    secondary.dataset.action = view.secondary.action;
    host.classList.remove('hidden');
  };

  for (const button of [primary, secondary]) {
    button.addEventListener('click', () => {
      const action = button.dataset.action as UpdateAction | undefined;
      if (action) void actions.act(action).catch(() => undefined);
    });
  }
  actions.onNotice(paint);
  paint(await actions.notice().catch(() => null));
}
