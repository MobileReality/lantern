import { ENDPOINT, SETTINGS_PATH } from '../shared/config';
import { removeInstalledHooks } from './hook-cleanup';

function uninstallFrom(settingsPath: string) {
  return removeInstalledHooks(settingsPath, 'ccmonitor', (command) => command.includes(ENDPOINT));
}

function uninstall() {
  return uninstallFrom(SETTINGS_PATH);
}

export { uninstall, uninstallFrom };
