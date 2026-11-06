import fs from 'node:fs';
import path from 'node:path';

type Settings = Record<string, unknown>;
type MergeResult = { settings: Settings; changed: boolean };

const WORKTREES_GLOB = '**/.claude/worktrees';
const WORKTREES_CONTENTS_GLOB = '**/.claude/worktrees/**';
const TS_SERVER_MEMORY_KEYS = ['js/ts.tsserver.maxMemory', 'typescript.tsserver.maxTsServerMemory'] as const;
const TS_SERVER_MEMORY_MB = 2048;
const TS_WATCH_OPTIONS_KEYS = ['js/ts.tsserver.watchOptions', 'typescript.tsserver.watchOptions'] as const;
const TS_EXCLUDE_DIRECTORIES_KEY = 'excludeDirectories';
const TRUST_KEY = 'security.workspace.trust.enabled';

const EXCLUDE_OBJECTS: Record<string, readonly string[]> = {
  'files.exclude': [WORKTREES_GLOB],
  'search.exclude': [WORKTREES_GLOB],
  'files.watcherExclude': [WORKTREES_GLOB, WORKTREES_CONTENTS_GLOB],
};

function isPlainObject(value: unknown): value is Settings {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addMissingKeys(target: Settings, keys: readonly string[]): boolean {
  let changed = false;
  for (const key of keys) {
    if (key in target) continue;
    target[key] = true;
    changed = true;
  }
  return changed;
}

function mergeExcludeObject(settings: Settings, key: string, globs: readonly string[]): boolean {
  if (!(key in settings)) settings[key] = {};
  const existing = settings[key];
  return isPlainObject(existing) && addMissingKeys(existing, globs);
}

// The setting defaults to "vscode": tsserver then uses VS Code's own watchers, which already honour
// files.watcherExclude. Writing an object would switch tsserver back to its own watchers.
function mergeWatchOptions(settings: Settings, key: string): boolean {
  const options = settings[key];
  if (!isPlainObject(options)) return false;
  if (!(TS_EXCLUDE_DIRECTORIES_KEY in options)) options[TS_EXCLUDE_DIRECTORIES_KEY] = [];
  const dirs = options[TS_EXCLUDE_DIRECTORIES_KEY];
  if (!Array.isArray(dirs) || dirs.includes(WORKTREES_GLOB)) return false;
  dirs.push(WORKTREES_GLOB);
  return true;
}

export function mergeEditorSettings(current: Settings): MergeResult {
  const settings = structuredClone(current);
  let changed = false;
  // Restricted Mode disables extensions, including Claude Code.
  if (settings[TRUST_KEY] !== false) {
    settings[TRUST_KEY] = false;
    changed = true;
  }
  // The unified key is read by current VS Code servers; the old one is still read by older servers.
  // A missing key takes the user's value from the other one, so the user's cap wins on every server.
  const userMemory = TS_SERVER_MEMORY_KEYS.map((key) => settings[key]).find((value) => value !== undefined);
  for (const key of TS_SERVER_MEMORY_KEYS) {
    if (key in settings) continue;
    settings[key] = userMemory ?? TS_SERVER_MEMORY_MB;
    changed = true;
  }
  for (const [key, globs] of Object.entries(EXCLUDE_OBJECTS)) {
    changed = mergeExcludeObject(settings, key, globs) || changed;
  }
  for (const key of TS_WATCH_OPTIONS_KEYS) {
    changed = mergeWatchOptions(settings, key) || changed;
  }
  return { settings, changed };
}

export function ensureEditorSettingsFile(file: string): void {
  let current: Settings = {};
  let existed = false;
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.trim()) current = JSON.parse(text);
    existed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return; // JSONC with comments cannot be parsed; never clobber it
  }
  if (!isPlainObject(current)) return;
  const { settings, changed } = mergeEditorSettings(current);
  if (!changed) return;
  try {
    if (!existed) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  } catch {}
}
