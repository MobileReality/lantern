import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { app } from 'electron';
import { SKILL_MARKER } from '../../scripts/lantern-bundle.mjs';
import { SKILLS_REPO_ENV } from '@skills/lantern-delegate/scripts/skill-linker.mjs';
import { providerSkillsDir } from './provider';
import type { Provider } from './provider';
import { catalogueOf, linkerRepo } from './skills-catalogue';

type LinkResult = 'linked' | 'skipped-bundled' | 'skipped-local' | 'missing-source' | 'failed';

let repo = '';
let cache: { root: string; version: string | null | undefined; remote: string | undefined } = { root: '', version: undefined, remote: undefined };

function forgetCache() {
  cache = { root: '', version: undefined, remote: undefined };
}

function cacheFor(root: string) {
  if (cache.root !== root) cache = { root, version: undefined, remote: undefined };
  return cache;
}

function forgetVersion() {
  cacheFor(currentRepo()).version = undefined;
}

// An explicitly saved repo wins. Without one the catalogue is the repo of the configured
// skill linker, found again on every call so a changed linker needs no restart and nothing is written.
function repoState(): { root: string; fromLinker: boolean } {
  if (repo) return { root: repo, fromLinker: false };
  const root = linkerRepo(os.homedir());
  return { root, fromLinker: root !== '' };
}

const currentRepo = () => repoState().root;

function configFile() {
  return path.join(app.getPath('userData'), 'ccm-skills.json');
}
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (c && c.repo) repo = c.repo;
  } catch {}
  forgetCache();
  publishRepo();
}

// Only a saved repo is published: the linker's own path already reaches every session through lantern-extensions.json.
function publishRepo() {
  if (repo) process.env[SKILLS_REPO_ENV] = repo;
  else delete process.env[SKILLS_REPO_ENV];
}

// Repo version from its git tags, e.g. "v1.4.0" or "v1.4.0-3-gabcdef" when ahead.
function version(root: string = currentRepo()) {
  if (!root) return null;
  const known = cacheFor(root);
  if (known.version !== undefined) return known.version;
  try {
    known.version = execFileSync('git', ['-C', root, 'describe', '--tags', '--always'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    known.version = null;
  }
  return known.version;
}
function remoteOf(root: string = currentRepo()) {
  if (!root) return '';
  const known = cacheFor(root);
  if (known.remote !== undefined) return known.remote;
  try {
    const out = execFileSync('git', ['-C', root, 'config', '--get-regexp', '^remote\\..*\\.url$'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    known.remote = out.split('\n')[0].replace(/^\S+\s+/, '').trim();
  } catch {
    known.remote = '';
  }
  return known.remote;
}
function saveConfig() {
  try {
    fs.writeFileSync(configFile(), JSON.stringify({ repo }));
  } catch {}
}

function setRepo(p: string) {
  repo = p;
  forgetCache();
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

function available(root: string = currentRepo()) {
  return catalogueOf(root);
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
function underRepo(dir: string, target: string, root: string) {
  if (!root) return false;
  let resolved = path.resolve(dir, target).replace(/^\\\\\?\\/, '');
  let base = root;
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
  const root = currentRepo();
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let target;
    try {
      if (!fs.lstatSync(full).isSymbolicLink()) continue;
      target = fs.readlinkSync(full);
    } catch {
      continue;
    }
    if (underRepo(dir, target, root)) {
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
  const { root, fromLinker } = repoState();
  const all = available(root);
  const project = projectPath ? { path: projectPath, name: path.basename(projectPath) } : null;
  const { linked, broken } = project ? linkedFor(projectPath!, provider) : { linked: [], broken: [] };
  const { bundled, local } = project ? realFoldersFor(projectPath!, provider) : { bundled: [], local: [] };
  return {
    installed: all.length > 0,
    repo: root,
    repoFromLinker: fromLinker,
    remote: remoteOf(root),
    version: all.length ? version(root) : null,
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
  const root = currentRepo();
  for (const name of names) {
    if (!isPlainName(name)) continue;
    const dest = path.join(dir, name);
    try {
      const target = fs.readlinkSync(dest);
      if (underRepo(dir, target, root)) removeLink(dest);
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
  return currentRepo();
}

function git(args: string[]) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    let p;
    try {
      p = spawn('git', ['-C', currentRepo(), ...args], { env });
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
  forgetVersion();
  if (f.code !== 0) return { ok: false, error: (f.err || '').trim() || 'fetch failed', version: version() };
  if (branch && branch !== 'HEAD') {
    const m = await git(['merge', '--ff-only', 'FETCH_HEAD']);
    forgetVersion();
    if (m.code !== 0) return { ok: false, error: (m.err || '').trim() || 'could not fast-forward', version: version() };
  }
  return { ok: true, version: version() };
}

export { isInstalled, listFor, installedNames, link, unlink, clone, sync, loadConfig, defaultCloneParent, repoPath };
