import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeFileAtomically } from './atomic-write';
import { SETTING_DEFAULTS, isSettingKey, settingSchema } from '../shared/settings-registry';
import type { SettingKey, SettingValue, SettingValues, SettingsChange, SettingsSnapshot, SettingsUpdateResult } from '../shared/settings-registry';
import {
  EMPTY_SETTINGS_TEXT,
  diffSettings,
  editSettingsText,
  isValidValue,
  modifiedKeys,
  normalizeSettingsText,
  parseSettingsFile,
  resolveSettings,
} from './settings-model';
import type { ParsedSettingsFile, UserSettings } from './settings-model';

const USER_SETTINGS_FILE = 'settings.json';
const PROJECT_SETTINGS_FILE = path.join('.lantern', 'settings.json');
const WATCH_DEBOUNCE_MS = 50;
const WATCH_RETRY_DELAY_MS = 1000;
const WATCH_MAX_RETRIES = 5;
const MISSING_FILE = 'ENOENT';
const MAX_ECHOED_VALUE_LENGTH = 40;

type SettingsListener = (snapshot: SettingsChange['snapshot'], changed: SettingsChange['changed']) => void;

let user: UserSettings = {};
let values: SettingValues = { ...SETTING_DEFAULTS };
let modified: SettingKey[] = [];
let problems: string[] = [];
let writable = true;
const listeners = new Set<SettingsListener>();
let watcher: fs.FSWatcher | null = null;
let pendingReload: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let watchRetries = 0;

export function file(): string {
  return path.join(app.getPath('userData'), USER_SETTINGS_FILE);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readText(): string | null {
  try {
    return fs.readFileSync(file(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === MISSING_FILE) return null;
    throw err;
  }
}

function readSettings(): { text: string | null; parsed: ParsedSettingsFile } {
  try {
    const text = readText();
    return { text, parsed: parseSettingsFile(text) };
  } catch (err) {
    return { text: null, parsed: { user: {}, error: `Cannot read ${USER_SETTINGS_FILE}: ${errorMessage(err)}` } };
  }
}

function writeAtomically(text: string): void {
  writeFileAtomically(file(), text);
}

function apply(parsed: ParsedSettingsFile): { changed: SettingKey[]; statusChanged: boolean } {
  if (parsed.error !== null) return keepLastGood(parsed.error);
  const resolved = resolveSettings(parsed.user);
  const changed = diffSettings(values, resolved.values);
  const statusChanged = setStatus(resolved.problems, true);
  user = parsed.user;
  values = resolved.values;
  modified = modifiedKeys(user, values);
  return { changed, statusChanged };
}

// A half-saved file must not flip settings back to their defaults; before the first good read these are the defaults.
function keepLastGood(error: string): { changed: SettingKey[]; statusChanged: boolean } {
  return { changed: [], statusChanged: setStatus([error], false) };
}

function setStatus(nextProblems: string[], nextWritable: boolean): boolean {
  const statusChanged = nextWritable !== writable || nextProblems.join('\n') !== problems.join('\n');
  problems = nextProblems;
  writable = nextWritable;
  return statusChanged;
}

export function load(): SettingsSnapshot {
  apply(readSettings().parsed);
  return snapshot();
}

export function snapshot(): SettingsSnapshot {
  return { values: { ...values }, modified: [...modified], problems: [...problems], writable };
}

export function projectSetting<K extends SettingKey>(project: string, key: K): SettingValue<K> | undefined {
  let raw: string | null;
  try {
    raw = fs.readFileSync(path.join(project, PROJECT_SETTINGS_FILE), 'utf8');
  } catch {
    return undefined;
  }
  const { user: stored, error } = parseSettingsFile(raw);
  if (error || !Object.hasOwn(stored, key) || !isValidValue(settingSchema(key), stored[key])) return undefined;
  return stored[key] as SettingValue<K>;
}

export function get<K extends SettingKey>(key: K): SettingValue<K> {
  return values[key];
}

export function reload(): SettingKey[] {
  const { changed, statusChanged } = apply(readSettings().parsed);
  if (changed.length > 0 || statusChanged) {
    const current = snapshot();
    for (const listener of listeners) {
      try {
        listener(current, changed);
      } catch (err) {
        console.error('[settings] change listener failed', err);
      }
    }
  }
  return changed;
}

function refuse(error: string): SettingsUpdateResult {
  return { ok: false, error };
}

function describeRejected(value: unknown): string {
  if (typeof value === 'object' && value !== null) return Array.isArray(value) ? 'an array' : 'an object';
  return String(value).slice(0, MAX_ECHOED_VALUE_LENGTH);
}

export function update(key: unknown, value: unknown): SettingsUpdateResult {
  if (!isSettingKey(key)) return refuse(`Unknown setting "${describeRejected(key)}"`);
  if (!isValidValue(settingSchema(key), value)) return refuse(`Invalid value for "${key}": ${describeRejected(value)}`);
  const { text, parsed } = readSettings();
  if (parsed.error) {
    reload();
    return refuse(`${USER_SETTINGS_FILE} cannot be changed until it is fixed: ${parsed.error}`);
  }
  try {
    const next = editSettingsText(text, key, value);
    if (next !== normalizeSettingsText(text)) writeAtomically(next);
  } catch (err) {
    return refuse(errorMessage(err));
  }
  reload();
  return { ok: true, snapshot: snapshot() };
}

export function ensureFile(): void {
  if (!fs.existsSync(file())) writeAtomically(EMPTY_SETTINGS_TEXT);
}

export function onDidChange(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function scheduleReload(): void {
  if (pendingReload) clearTimeout(pendingReload);
  pendingReload = setTimeout(() => {
    pendingReload = null;
    reload();
  }, WATCH_DEBOUNCE_MS);
}

function attachWatcher(): void {
  try {
    // The directory, not the file: the file may not exist yet, and the atomic rename replaces its inode.
    const attached = fs.watch(path.dirname(file()), (_event, filename) => {
      watchRetries = 0;
      if (!filename || filename === USER_SETTINGS_FILE) scheduleReload();
    });
    attached.on('error', (err) => onWatchFailure(attached, err));
    watcher = attached;
  } catch (err) {
    watcher = null;
    scheduleWatchRetry(err);
  }
}

function onWatchFailure(failed: fs.FSWatcher, err: unknown): void {
  if (failed !== watcher) return;
  failed.close();
  watcher = null;
  scheduleWatchRetry(err);
}

function scheduleWatchRetry(err: unknown): void {
  console.error('[settings] watching settings.json failed', err);
  if (watchRetries >= WATCH_MAX_RETRIES) {
    console.error('[settings] giving up watching settings.json; external edits need a restart');
    return;
  }
  watchRetries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    attachWatcher();
    if (watcher) scheduleReload();
  }, WATCH_RETRY_DELAY_MS);
}

export function watch(): void {
  if (watcher || retryTimer) return;
  watchRetries = 0;
  attachWatcher();
}

export function unwatch(): void {
  watcher?.close();
  watcher = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  watchRetries = 0;
  if (pendingReload) clearTimeout(pendingReload);
  pendingReload = null;
}
