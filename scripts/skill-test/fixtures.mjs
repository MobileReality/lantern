import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dirForMapFile, enumerate, hashFile, MAP_DIR, mapFileFor, readLang, FORMAT_HEADER } from '../../skills/lantern-setup/scripts/lib.mjs';
import { REPO_ROOT } from '../e2e-delegate/workspace.mjs';

export const SETUP_SCRIPTS = path.join(REPO_ROOT, 'skills', 'lantern-setup', 'scripts');
export const SYNC_SCRIPTS = path.join(REPO_ROOT, 'skills', 'lantern-sync', 'scripts');
export const GIT_IDENTITY = { name: 'Skill Test', email: 'skill-test@example.test' };
export const BASE_BRANCH = 'main';
export const SYNC_MODEL = 'claude-sonnet-5-5';
export const FIXTURE_GITIGNORE = ['.claude/', '.ai/tmp/', '.ai/runs/'];

export const TINY_PROJECT = {
  'src/greet.mjs': "export function greet(name) {\n  return `hello ${name}`;\n}\n",
  'src/shout.mjs': "import { greet } from './greet.mjs';\n\nexport function shout(name) {\n  return greet(name).toUpperCase();\n}\n",
};

export const TINY_CHANGE = {
  file: 'src/greet.mjs',
  content: "export function greet(name) {\n  return `hello, ${name}!`;\n}\n",
};

export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

export function git(cwd, args, env = {}) {
  const res = spawnSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${res.stderr || res.stdout}`);
  return res.stdout;
}

export function initRepo(root) {
  git(root, ['init', '-q', '-b', BASE_BRANCH]);
  git(root, ['config', 'user.name', GIT_IDENTITY.name]);
  git(root, ['config', 'user.email', GIT_IDENTITY.email]);
}

export function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

export function createTinyProject(root, { repo = false } = {}) {
  fs.mkdirSync(root, { recursive: true });
  writeFiles(root, { ...TINY_PROJECT, '.gitignore': `${FIXTURE_GITIGNORE.join('\n')}\n` });
  if (repo) {
    initRepo(root);
    commitAll(root, 'chore: initial commit');
  }
}

export function installSkills(root) {
  const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'install-skills.mjs'), root], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`install-skills failed for ${root}: ${res.stderr || res.stdout}`);
}

const TEST_FILE = /(^|[/.])(test|spec)[./]|_test\./;

export function roleOf(rel) {
  if (path.basename(rel) === 'package.json') return 'config';
  return TEST_FILE.test(rel) ? 'test' : 'util';
}

const purposeOf = (rel) => `Fixture file ${path.basename(rel)}`;

function textFileFor(root, mapFile) {
  const below = mapFile.slice(`${MAP_DIR}/`.length);
  return path.join(root, '.lantern', 'lang', readLang(root), `${below}.json`);
}

function writeMapFile(root, mapFile, paths) {
  const lines = [FORMAT_HEADER, `# ${dirForMapFile(mapFile)}`, ''];
  const text = {};
  for (const rel of [...paths].sort()) {
    lines.push(`${rel} . ${roleOf(rel)} ${hashFile(root, rel)}`);
    text[path.basename(rel)] = purposeOf(rel);
  }
  fs.mkdirSync(path.dirname(path.join(root, mapFile)), { recursive: true });
  fs.writeFileSync(path.join(root, mapFile), `${lines.join('\n')}\n`);
  const textFile = textFileFor(root, mapFile);
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, `${JSON.stringify({ text }, null, 1)}\n`);
}

export function mapProject(root, { skip = [] } = {}) {
  const byMapFile = new Map();
  for (const { path: rel } of enumerate(root)) {
    if (skip.includes(rel)) continue;
    const mapFile = mapFileFor(rel);
    byMapFile.set(mapFile, [...(byMapFile.get(mapFile) ?? []), rel]);
  }
  for (const [mapFile, paths] of byMapFile) writeMapFile(root, mapFile, paths);
  return [...byMapFile.values()].flat().sort();
}

export function snapshotSources(root) {
  return Object.fromEntries(enumerate(root).map(({ path: rel }) => [rel, hashFile(root, rel)]));
}

export function changedSources(root, before) {
  const after = snapshotSources(root);
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

export function runScript(script, args, cwd) {
  const res = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

export const validateSettled = (root) => runScript(path.join(SETUP_SCRIPTS, 'validate.mjs'), [root, '--settled'], root);
export const syncCommand = (root, command, args = []) => runScript(path.join(SYNC_SCRIPTS, 'sync.mjs'), [command, ...args, '--root', root], root);

export function parseJson(res, label) {
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`${label} printed no JSON (exit ${res.status}): ${(res.stdout || res.stderr).trim().slice(0, 200)}`);
  }
}
