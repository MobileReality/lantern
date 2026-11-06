import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { app } from 'electron';
import { SKILL_MARKER } from '../../scripts/lantern-bundle.mjs';
import { SKILLS_REPO_ENV } from '@skills/lantern-delegate/scripts/skill-linker.mjs';
import { providerSkillsDir } from './provider';
import type { Provider } from './provider';

type LinkResult = 'linked' | 'skipped-bundled' | 'skipped-local' | 'missing-source' | 'failed';

let repo = '';
let cachedVersion: string | null | undefined; // undefined = not yet computed, null = unavailable
let cachedRemote: string | undefined;

function configFile() {
  return path.join(app.getPath('userData'), 'ccm-skills.json');
}
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (c && c.repo) repo = c.repo;
  } catch {}
  cachedVersion = undefined;
  cachedRemote = undefined;
  publishRepo();
}

function publishRepo() {
  if (repo) process.env[SKILLS_REPO_ENV] = repo;
  else delete process.env[SKILLS_REPO_ENV];
}

// Repo version from its git tags, e.g. "v1.4.0" or "v1.4.0-3-gabcdef" when ahead.
function version() {
  if (cachedVersion !== undefined) return cachedVersion;
  if (!repo) return null;
  try {
    cachedVersion = execFileSync('git', ['-C', repo, 'describe', '--tags', '--always'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
}
function remoteOf() {
  if (cachedRemote !== undefined) return cachedRemote;
  if (!repo) return '';
  try {
    const out = execFileSync('git', ['-C', repo, 'config', '--get-regexp', '^remote\\..*\\.url$'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    cachedRemote = out.split('\n')[0].replace(/^\S+\s+/, '').trim();
  } catch {
    cachedRemote = '';
  }
  return cachedRemote;
}
function saveConfig() {
  try {
    fs.writeFileSync(configFile(), JSON.stringify({ repo }));
  } catch {}
}

function setRepo(p: string) {
  repo = p;
  cachedVersion = undefined;
  cachedRemote = undefined;
  publishRepo();
  saveConfig();
}

function hasSkillWithin(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
  return entries.some((e) => {
    const child = path.join(dir, e.name);
    return fs.existsSync(path.join(child, 'SKILL.md')) || fs.readdirSync(child, { withFileTypes: true }).some((g) => g.isDirectory() && fs.existsSync(path.join(child, g.name, 'SKILL.md')));
  });
}

function looksLikeRepo(dir: string) {
  try {
    return fs.existsSync(path.join(dir, '.git')) && hasSkillWithin(dir);
  } catch {
    return false;
  }
}

function findSkillDirs(root: string) {
  const res: string[] = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) res.push(d);
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') stack.push(path.join(d, e.name));
    }
  }
  return res;
}

function available() {
  if (!repo) return [];
  return findSkillDirs(repo)
    .map((dir) => {
      const rel = path.relative(repo, dir);
      if (!rel) return null;
      const segs = rel.split(path.sep);
      if (segs[0].startsWith('.')) return null;
      if (segs.length === 1) return { role: '', name: segs[0], src: dir };
      return { role: segs[0], name: segs.slice(1).join('-'), src: dir };
    })
    .filter((s): s is { role: string; name: string; src: string } => s !== null)
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

function isInstalled() {
  return available().length > 0;
}

// Windows can't create file/dir symlinks without admin or Developer Mode, but it
// CAN create directory junctions unprivileged — so link skills as junctions there.
function makeLink(src: string, dest: string) {
  fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : undefined);
}

// Remove a symlink (posix) or junction (Windows dir reparse needs rmdir, not unlink).
function removeLink(dest: string) {
  try {
    fs.unlinkSync(dest);
    return;
  } catch {}
  try {
    fs.rmdirSync(dest);
  } catch {}
}

// Does a link target resolve inside the skills repo? Normalizes the Windows
// `\\?\` junction prefix and compares case-insensitively there.
function underRepo(dir: string, target: string) {
  if (!repo) return false;
  let resolved = path.resolve(dir, target).replace(/^\\\\\?\\/, '');
  let base = repo;
  if (process.platform === 'win32') {
    resolved = resolved.toLowerCase();
    base = base.toLowerCase();
  }
  return resolved === base || resolved.startsWith(base + path.sep);
}

function canonical(dir: string) {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return path.resolve(dir);
  }
}

function safeSkillsDir(projectPath: string, provider: Provider) {
  if (provider === 'claude') return providerSkillsDir(projectPath, provider);
  if (canonical(projectPath) === canonical(os.homedir())) return null;
  const dir = providerSkillsDir(projectPath, provider);
  for (const ancestor of [path.dirname(dir), dir]) {
    try {
      if (!fs.lstatSync(ancestor).isDirectory()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
  }
  return dir;
}

function linkedFor(projectPath: string, provider: Provider = 'claude') {
  const linked: string[] = [];
  const broken: string[] = [];
  const dir = safeSkillsDir(projectPath, provider);
  if (!dir) return { linked, broken };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { linked, broken };
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let target;
    try {
      if (!fs.lstatSync(full).isSymbolicLink()) continue;
      target = fs.readlinkSync(full);
    } catch {
      continue;
    }
    if (underRepo(dir, target)) {
      linked.push(e.name);
      if (!fs.existsSync(full)) broken.push(e.name);
    }
  }
  return { linked, broken };
}

function realFoldersFor(projectPath: string, provider: Provider = 'claude') {
  const bundled: string[] = [];
  const local: string[] = [];
  const dir = safeSkillsDir(projectPath, provider);
  if (!dir) return { bundled, local };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { bundled, local };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    (fs.existsSync(path.join(dir, e.name, SKILL_MARKER)) ? bundled : local).push(e.name);
  }
  return { bundled, local };
}

function stackKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/js$/, '');
}

function dependencyKeys(projectPath: string) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
    return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).map(stackKey));
  } catch {
    return new Set<string>();
  }
}

function recommendedFor(projectPath: string, all: { role: string; name: string }[]) {
  const deps = dependencyKeys(projectPath);
  return all.filter((s) => s.role && deps.has(stackKey(s.role))).map((s) => s.name);
}

function listFor(projectPath: string | null, provider: Provider = 'claude') {
  const all = available();
  const project = projectPath ? { path: projectPath, name: path.basename(projectPath) } : null;
  const { linked, broken } = project ? linkedFor(projectPath!, provider) : { linked: [], broken: [] };
  const { bundled, local } = project ? realFoldersFor(projectPath!, provider) : { bundled: [], local: [] };
  return {
    installed: all.length > 0,
    repo,
    remote: remoteOf(),
    version: all.length ? version() : null,
    project,
    available: all.map(({ role, name }) => ({ role, name })),
    linked,
    broken,
    bundled,
    local,
    recommended: project ? recommendedFor(projectPath!, all) : [],
  };
}

function skillNamesIn(dir: string | null): string[] {
  if (!dir) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => fs.existsSync(path.join(dir, name, 'SKILL.md')));
}

function installedNames(projectPath: string | null, provider: Provider = 'claude', home: string = os.homedir()): string[] {
  const project = projectPath ? safeSkillsDir(projectPath, provider) : null;
  return [...new Set([...skillNamesIn(project), ...skillNamesIn(providerSkillsDir(home, provider))])].sort();
}

// Only the linked names, like the bundle: skills the user adds to the same directory
// stay visible to git.
function excludeFromGit(projectPath: string, names: string[], provider: Provider = 'claude') {
  try {
    const gitDir = path.join(projectPath, '.git');
    if (!fs.statSync(gitDir).isDirectory()) return;
    const exclude = path.join(gitDir, 'info', 'exclude');
    let content = '';
    try {
      content = fs.readFileSync(exclude, 'utf8');
    } catch {}
    const present = new Set(content.split('\n').map((l) => l.trim()));
    const dir = providerSkillsDir('', provider).split(path.sep).join('/');
    const missing = names.map((name) => `${dir}/${name}`).filter((entry) => !present.has(entry));
    if (!missing.length) return;
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `${content && !content.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  } catch {}
}

function isPlainName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && path.basename(name) === name && !name.includes('\\');
}

function linkOne(name: string, src: string | undefined, dir: string): LinkResult {
  if (!isPlainName(name)) return 'failed';
  if (!src) return 'missing-source';
  const dest = path.join(dir, name);
  try {
    if (fs.lstatSync(dest).isSymbolicLink()) removeLink(dest);
    else return fs.existsSync(path.join(dest, SKILL_MARKER)) ? 'skipped-bundled' : 'skipped-local';
  } catch {}
  try {
    makeLink(src, dest);
    return 'linked';
  } catch (err) {
    console.error(`skills: failed to link ${name}:`, (err as Error).message);
    return 'failed';
  }
}

function link(projectPath: string, names: string[], provider: Provider = 'claude') {
  const results: Record<string, LinkResult> = {};
  if (!projectPath) return results;
  const dir = safeSkillsDir(projectPath, provider);
  if (!dir) return results;
  const byName = new Map(available().map((s) => [s.name, s.src]));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) results[name] = linkOne(name, byName.get(name), dir);
  excludeFromGit(projectPath, names.filter((name) => results[name] === 'linked'), provider);
  return results;
}

function unlink(projectPath: string, names: string[], provider: Provider = 'claude') {
  if (!projectPath) return;
  const dir = safeSkillsDir(projectPath, provider);
  if (!dir) return;
  for (const name of names) {
    if (!isPlainName(name)) continue;
    const dest = path.join(dir, name);
    try {
      const target = fs.readlinkSync(dest);
      if (underRepo(dir, target)) removeLink(dest);
    } catch {}
  }
}

// Clone into the chosen location and remember it. `picked` may be the repo itself
// (an existing checkout to adopt) or a parent to clone "skills" into.
function clone(picked: string, remoteUrl = '') {
  return new Promise((resolve) => {
    const base = (picked || '').trim();
    if (!base) return resolve({ ok: false, error: 'choose a folder for the skills repo' });
    if (looksLikeRepo(base)) {
      setRepo(base);
      return resolve({ ok: true, repo: base, adopted: true });
    }
    const dest = path.join(base, 'skills');
    if (looksLikeRepo(dest)) {
      setRepo(dest);
      return resolve({ ok: true, repo: dest, adopted: true });
    }
    if (fs.existsSync(dest)) return resolve({ ok: false, error: `${dest} already exists` });
    const url = remoteUrl.trim() || remoteOf();
    if (!url) return resolve({ ok: false, error: `no skills checkout at ${base}; enter the remote URL of your skills repo to clone it` });
    if (url.startsWith('-')) return resolve({ ok: false, error: 'the remote URL is not valid' });
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch {}
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    let p;
    try {
      p = spawn('git', ['clone', '--', url, dest], { env });
    } catch (e) {
      return resolve({ ok: false, error: (e as Error).message });
    }
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('exit', (code) => {
      if (code === 0) {
        setRepo(dest);
        resolve({ ok: true, repo: dest });
      } else {
        resolve({ ok: false, error: err.trim() || `git exited ${code}` });
      }
    });
  });
}

function defaultCloneParent() {
  return os.homedir();
}

function repoPath() {
  return repo;
}

function git(args: string[]) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    let p;
    try {
      p = spawn('git', ['-C', repo, ...args], { env });
    } catch (e) {
      return resolve({ code: 1, out: '', err: (e as Error).message });
    }
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ code: 1, out: '', err: e.message }));
    p.on('exit', (code) => resolve({ code: code ?? 1, out, err }));
  });
}

// Fetch latest tags and fast-forward the checkout (works without upstream
// tracking by fetching the branch explicitly and merging FETCH_HEAD).
async function sync() {
  if (!isInstalled()) return { ok: false, error: 'skills repo not found' };
  const remote = (await git(['remote'])).out.split('\n')[0].trim() || 'origin';
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
  const fetchArgs = ['fetch', '--tags', remote, ...(branch && branch !== 'HEAD' ? [branch] : [])];
  const f = await git(fetchArgs);
  cachedVersion = undefined;
  if (f.code !== 0) return { ok: false, error: (f.err || '').trim() || 'fetch failed', version: version() };
  if (branch && branch !== 'HEAD') {
    const m = await git(['merge', '--ff-only', 'FETCH_HEAD']);
    cachedVersion = undefined;
    if (m.code !== 0) return { ok: false, error: (m.err || '').trim() || 'could not fast-forward', version: version() };
  }
  return { ok: true, version: version() };
}

export { isInstalled, listFor, installedNames, link, unlink, clone, sync, loadConfig, defaultCloneParent, repoPath };
