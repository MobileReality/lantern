import { msg, msgCount } from '../../shared/lang/messages';
import type { LiveParts } from './guard';
import { RELEASES_URL } from './feed';
import type { CheckOutcome } from './service';

export type DialogAction = 'close' | 'view' | 'restart';

export interface ResultDialog {
  message: string;
  detail: string;
  buttons: { label: string; action: DialogAction }[];
  viewUrl: string | null;
}

export interface RestartDialog {
  message: string;
  detail: string;
  confirm: string;
  cancel: string;
}

const CLOSE = { label: msg('updates.result.close'), action: 'close' } as const;

export function lostItems(live: LiveParts): string[] {
  const items: string[] = [];
  if (live.agentRunning) items.push(msg('updates.lost.agentRun'));
  if (live.terminals > 0) items.push(msgCount('updates.lost.terminals', live.terminals));
  if (live.running > 0) items.push(msgCount('updates.lost.running', live.running));
  if (live.unknown) items.push(msg('updates.lost.unknown'));
  return items;
}

export function restartDialog(live: LiveParts): RestartDialog {
  const lost = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(lostItems(live));
  return {
    message: msg('updates.restart.message'),
    detail: msg('updates.restart.detail', { lost }),
    confirm: msg('updates.restart.confirm'),
    cancel: msg('updates.restart.cancel'),
  };
}

function plain(message: string, detail: string): ResultDialog {
  return { message, detail, buttons: [CLOSE], viewUrl: null };
}

export function resultDialog(outcome: CheckOutcome, version: string): ResultDialog {
  switch (outcome.kind) {
    case 'up-to-date':
      return plain(msg('updates.result.upToDate'), msg('updates.result.upToDateDetail', { version }));
    case 'disabled':
      return plain(msg('updates.result.disabled'), msg('updates.result.disabledDetail'));
    case 'not-packaged':
      return plain(msg('updates.result.notPackaged'), msg('updates.result.notPackagedDetail'));
    case 'downloading':
      return plain(msg('updates.result.downloading', { version: outcome.version }), msg('updates.result.downloadingDetail'));
    case 'ready':
      return {
        message: msg('updates.result.ready', { version: outcome.version }),
        detail: msg('updates.result.readyDetail'),
        buttons: [{ label: msg('updates.result.restartNow'), action: 'restart' }, CLOSE],
        viewUrl: null,
      };
    case 'available':
      return {
        message: msg('updates.result.available', { version: outcome.version }),
        detail: msg('updates.result.availableDetail'),
        buttons: [{ label: msg('updates.result.view'), action: 'view' }, CLOSE],
        viewUrl: outcome.url,
      };
    case 'unavailable':
      return {
        message: msg('updates.result.unavailable'),
        detail: msg('updates.result.unavailableDetail'),
        buttons: [{ label: msg('updates.result.viewReleases'), action: 'view' }, CLOSE],
        viewUrl: RELEASES_URL,
      };
    case 'failed':
      return plain(msg('updates.result.failed'), msg('updates.result.failedDetail'));
  }
}
