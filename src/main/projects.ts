import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as state from './state';
import { resolveRoot } from './projectroot';
import type { Provider } from './provider';
import * as settings from './settings';
import { writeDataFile } from './metadir';

const PROJECT_FILE = 'project.json';
const SCHEMA_VERSION = 1;

interface SessionLite { id: string; provider: Provider; state: string; updatedAt: number; lastMessage: string; createdAt: number; }
interface Group { name: string; path: string; sessions: SessionLite[]; }

let manual: string[] = [];
let hidden: string[] = []; // project roots the user hid, so discovery won't re-add them
const windowed = new Set<string>(); // project roots with a window of their own: listed while it is open, never saved

function storeFile() {
  return path.join(app.getPath('userData'), 'ccm-projects.json');
}

// Stamp a project as opened in its local data folder, which keeps itself out of git.
function markOpened(projectPath: string, name?: string) {
  if (!projectPath) return;
  const now = Date.now();
  try {
    const record = {
      name: name || path.basename(projectPath),
      path: projectPath,
      lastOpened: new Date(now).toISOString(),
      managedBy: 'Lantern',
      schemaVersion: SCHEMA_VERSION,
    };
    writeDataFile(projectPath, PROJECT_FILE, `${JSON.stringify(record, null, 2)}\n`);
  } catch {}
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    if (Array.isArray(raw)) {
      manual = raw; // back-compat: the file used to be a bare array
      hidden = [];
    } else {
      manual = raw.manual || [];
      hidden = raw.hidden || [];
    }
  } catch {
    manual = [];
    hidden = [];
  }
}

function save() {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify({ manual, hidden }));
  } catch {}
}

function add(dir: string) {
  if (!dir) return;
  hidden = hidden.filter((p) => p !== dir);
  if (!manual.includes(dir)) manual.push(dir);
  save();
}

function attach(dir: string) {
  if (dir) windowed.add(dir);
}

function detach(dir: string) {
  windowed.delete(dir);
}

function known() {
  return [...new Set([...manual, ...windowed])];
}

function hide(dir: string) {
  if (!dir) return;
  manual = manual.filter((p) => p !== dir);
  if (!hidden.includes(dir)) hidden.push(dir);
  save();
}

// Keyed by resolved root, so a subdir or worktree session lands on the project the
// user has open; sorted alphabetically so the list stays stable.
function groups() {
  const byPath = new Map<string, Group>();
  const ensure = (p: string): Group => {
    let g = byPath.get(p);
    if (!g) {
      g = { name: path.basename(p) || p, path: p, sessions: [] };
      byPath.set(p, g);
    }
    return g;
  };
  const roots = known();
  for (const p of roots) ensure(p);
  for (const s of state.all()) {
    if (!s.cwd) continue;
    ensure(resolveRoot(s.cwd, roots)).sessions.push({
      id: s.id,
      provider: s.provider,
      state: s.state,
      updatedAt: s.updatedAt,
      lastMessage: s.lastMessage,
      createdAt: s.createdAt || 0,
    });
  }
  if (!state.isAvailable()) {
    for (const group of byPath.values()) {
      if (!group.sessions.length && settings.provider(group.path) === 'claude') group.sessions.push({ id: '__poll__', provider: 'claude', state: 'unavailable', updatedAt: 0, lastMessage: '', createdAt: 0 });
    }
  }
  for (const g of byPath.values()) g.sessions.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return [...byPath.values()]
    .filter((g) => windowed.has(g.path) || !hidden.includes(g.path))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

function aggregateState(g: Group) {
  for (const st of ['permission', 'failed', 'stopped', 'done', 'idle', 'running', 'unknown', 'unavailable']) {
    if (g.sessions.some((s) => s.state === st)) return st;
  }
  return 'open';
}

function rootForCwd(cwd: string) {
  return resolveRoot(cwd, known());
}

export { load, add, attach, detach, hide, groups, aggregateState, rootForCwd, markOpened };
