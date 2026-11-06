import path from 'node:path';
import { app } from 'electron';
import { SETTINGS_PATH } from '../shared/config';
import { isLegacyNotifierCommand, removeInstalledHooks } from './hook-cleanup';

function hooksDir() {
  return path.join(app.getPath('userData'), 'notify-hooks');
}

function uninstallFrom(settingsPath: string, installedHooksDir: string) {
  return removeInstalledHooks(settingsPath, 'mrch', (command) => isLegacyNotifierCommand(command, installedHooksDir));
}

function uninstall() {
  return uninstallFrom(SETTINGS_PATH, hooksDir());
}

export { uninstall, uninstallFrom };
