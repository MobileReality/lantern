import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptDirs } from './checks.mjs';
import { stopChild, waitForLine } from './child.mjs';
import { startFakeLantern } from './fake-lantern.mjs';
import { EXTENSION_SLOT, ExtensionsError, readSkillLinker, setExtensions, setSkillLinker, setSwitchedOff } from '../../skills/lantern-delegate/scripts/extensions.mjs';
import { defaultSkillRoots, settingsSnippet } from '../../skills/lantern-delegate/scripts/permissions.mjs';
import { DELIVERY, setPreference } from '../../skills/lantern-delegate/scripts/preferences.mjs';
import { configuredSkillLinkerPath } from '../../skills/lantern-delegate/scripts/skill-linker.mjs';
import { createProject, extrasOf, offOf, orchestratorExtrasOf, projectSettings, writeExtraSkills } from './projects.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const FAKE_SSH = path.join(HERE, 'fake-ssh.sh');
export const REDIRECT_FETCH = path.join(HERE, 'redirect-fetch.mjs');
const MOCK_SCRIPT = path.join(HERE, 'mock-bitbucket.mjs');
const MOCK_START_TIMEOUT_MS = 15000;

async function startMockChild() {
  const child = spawn(process.execPath, [MOCK_SCRIPT], { env: { ...process.env, MOCK_BB_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const match = await waitForLine(child, /listening on (\d+)/, MOCK_START_TIMEOUT_MS).catch((err) => {
    stopChild(child);
    throw err;
  });
  return { child, port: Number(match[1]) };
}

function installSkills(dir, home) {
  const env = home ? { ...process.env, HOME: home, USERPROFILE: home } : process.env;
  const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'install-skills.mjs'), dir], { encoding: 'utf8', env });
  if (res.status !== 0) throw new Error(`install-skills failed for ${dir}: ${res.stderr || res.stdout}`);
}

function writeSettings(dir, settings) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), `${JSON.stringify(settings, null, 2)}\n`);
}

const AUTH_ENTRIES = [['Library'], ['.claude', '.credentials.json']];

function realSkillLinker(realHome) {
  try {
    return readSkillLinker(realHome);
  } catch (e) {
    if (e instanceof ExtensionsError) return null;
    throw e;
  }
}

export function createIsolatedHome({ root, project, dir, realHome = os.homedir() }) {
  const home = path.join(root, 'homes', project.name);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  for (const parts of AUTH_ENTRIES) {
    const source = path.join(realHome, ...parts);
    if (fs.existsSync(source)) fs.symlinkSync(source, path.join(home, ...parts));
  }
  const linker = realSkillLinker(realHome);
  if (linker) setSkillLinker(linker, home);
  const extras = extrasOf(project);
  if (extras.length > 0) setExtensions(EXTENSION_SLOT.delegate, extras, home);
  const off = offOf(project);
  if (off.length > 0) setSwitchedOff(EXTENSION_SLOT.delegate, off, home);
  const orchestratorExtras = orchestratorExtrasOf(project);
  if (orchestratorExtras.length > 0) setExtensions(EXTENSION_SLOT.orchestrator, orchestratorExtras, home);
  const snippet = settingsSnippet({ skillRoots: defaultSkillRoots(dir, home), skillLinker: configuredSkillLinkerPath({ home }) ?? undefined });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), `${snippet}\n`);
  return home;
}

export const transcriptsHome = (project, fallback) => (project.home ? path.join(project.home, '.claude', 'projects') : fallback);

export function removeTranscripts(projectsHome, projectDir, root) {
  const marker = path.basename(root).replace(/[^a-zA-Z0-9]/g, '-');
  const removed = [];
  for (const dir of transcriptDirs(projectsHome, projectDir)) {
    if (path.dirname(dir) !== projectsHome || !path.basename(dir).includes(marker)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

export async function createWorkspace(projects, { holder = {}, install = installSkills, projectsHome = path.join(os.homedir(), '.claude', 'projects'), delivery = DELIVERY.pr, realHome = os.homedir() } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lantern-e2e-'));
  const remotesDir = path.join(root, 'remotes');
  const logsDir = path.join(root, 'logs');
  fs.mkdirSync(remotesDir);
  fs.mkdirSync(logsDir);
  const ws = { root, remotesDir, logsDir, mock: null, lantern: null, delivery, projects: [] };
  holder.ws = ws;
  try {
    ws.mock = await startMockChild();
    ws.lantern = await startFakeLantern(root);
    for (const project of projects) {
      const { dir, bare } = createProject({ root, project, remotesDir, fakeSsh: FAKE_SSH });
      const home = createIsolatedHome({ root, project, dir, realHome });
      ws.projects.push({ ...project, dir, bare, home });
      install(dir, home);
      writeExtraSkills(dir, [...extrasOf(project), ...orchestratorExtrasOf(project)]);
      writeSettings(dir, projectSettings({ redirectFetch: REDIRECT_FETCH, fakeSsh: FAKE_SSH, remotesDir, mockPort: ws.mock.port, credentialSocket: ws.lantern.socketPath }));
      setPreference(dir, 'delivery', delivery);
    }
  } catch (err) {
    disposeWorkspace(ws, { keep: false, projectsHome });
    throw err;
  }
  return ws;
}

export function disposeWorkspace(ws, { keep, projectsHome }) {
  if (ws.mock) stopChild(ws.mock.child);
  if (ws.lantern) ws.lantern.close();
  if (keep) return [];
  const removed = ws.projects.flatMap((p) => removeTranscripts(projectsHome, p.dir, ws.root));
  fs.rmSync(ws.root, { recursive: true, force: true });
  return removed;
}

export async function fetchMockPrs(port) {
  const res = await fetch(`http://127.0.0.1:${port}/__prs`);
  if (!res.ok) throw new Error(`mock dump answered ${res.status}`);
  return (await res.json()).values;
}
