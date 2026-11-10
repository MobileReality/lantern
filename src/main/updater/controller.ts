import { UPDATE_ACTION_CHANNEL, UPDATE_GET_CHANNEL, parseUpdateAction } from '../../shared/updates';
import { type DialogAction, type ResultDialog, resultDialog } from './dialogs';
import { isReleasePageUrl } from './feed';
import type { Updater } from './service';

type Handler = (event: any, ...args: any[]) => unknown;

export interface ControllerDeps {
  updater: Updater;
  version: string;
  showResult(dialog: ResultDialog): Promise<DialogAction>;
  openExternal(url: string): unknown;
}

export function createUpdateController({ updater, version, showResult, openExternal }: ControllerDeps) {
  return async function checkForUpdates(): Promise<void> {
    const outcome = await updater.check();
    const dialog = resultDialog(outcome, version);
    const action = await showResult(dialog);
    if (action === 'view' && dialog.viewUrl && isReleasePageUrl(dialog.viewUrl)) await openExternal(dialog.viewUrl);
    if (action === 'restart') await updater.restartNow();
  };
}

export interface UpdateIpcDeps {
  handle(channel: string, listener: Handler): void;
  fromWorkspace(fn: Handler): Handler;
  updater: Updater;
}

export function registerUpdateIpc({ handle, fromWorkspace, updater }: UpdateIpcDeps) {
  handle(UPDATE_GET_CHANNEL, fromWorkspace(() => updater.notice()));
  handle(
    UPDATE_ACTION_CHANNEL,
    fromWorkspace(async (_event, value: unknown) => {
      const action = parseUpdateAction(value);
      if (action) await updater.handle(action);
      return updater.notice();
    }),
  );
}
