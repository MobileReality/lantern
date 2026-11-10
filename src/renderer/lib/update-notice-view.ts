import { msg } from '../../shared/lang/messages';
import type { UpdateAction, UpdateNotice } from '../../shared/updates';

export interface UpdateNoticeView {
  title: string;
  text: string;
  primary: { label: string; action: UpdateAction };
  secondary: { label: string; action: UpdateAction };
}

export function updateNoticeView(notice: UpdateNotice): UpdateNoticeView {
  const { version } = notice;
  if (notice.kind === 'available') {
    return {
      title: msg('updates.notice.available', { version }),
      text: msg('updates.notice.availableText'),
      primary: { label: msg('updates.notice.view'), action: 'view' },
      secondary: { label: msg('updates.notice.dismiss'), action: 'dismiss' },
    };
  }
  return {
    title: notice.waiting ? msg('updates.notice.readyWaiting') : msg('updates.notice.ready'),
    text: notice.waiting ? msg('updates.notice.readyWaitingText', { version }) : msg('updates.notice.readyText', { version }),
    primary: { label: msg('updates.notice.restartNow'), action: 'restart' },
    secondary: { label: msg('updates.notice.later'), action: 'later' },
  };
}
