import { SETTING_DEFAULTS } from '../../shared/settings-registry';
import type { SettingKey, SettingsChange, SettingsSnapshot, SettingValue } from '../../shared/settings-registry';

export const SETTINGS_CHANGED_EVENT = 'mr:settings-changed';

export type SettingsChangedDetail = Pick<SettingsChange, 'changed'>;

let current: SettingsSnapshot = { values: SETTING_DEFAULTS, modified: [], problems: [], writable: true };
let version = 0;

export function settingsSnapshot(): SettingsSnapshot {
  return current;
}

export function settingValue<K extends SettingKey>(key: K): SettingValue<K> {
  return current.values[key];
}

export function replaceSettings(next: SettingsSnapshot, changed: readonly SettingKey[]): void {
  current = next;
  version += 1;
  const detail: SettingsChangedDetail = { changed: [...changed] };
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail }));
}

export function beginSettingsLoad(): (snapshot: SettingsSnapshot) => boolean {
  const startedAt = version;
  return (snapshot) => {
    if (version !== startedAt) return false;
    replaceSettings(snapshot, []);
    return true;
  };
}

export function onSettingsChanged(listener: (changed: readonly SettingKey[]) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<SettingsChangedDetail>).detail.changed);
  window.addEventListener(SETTINGS_CHANGED_EVENT, handle);
  return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handle);
}
