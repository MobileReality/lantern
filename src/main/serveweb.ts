// Manages a local `code serve-web` process (VS Code's built-in web server) so the
// workspace can embed real VS Code instances as webviews.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_PERCENT, classifyProgressLine, type ServerPage } from './serveweb-parse';
import { fetchServerPage } from './serveweb-probe';
import { codeCandidates, findCodeBin } from './serveweb-code-paths';
import { killChildTree } from './prockill';
import { KILL_GRACE_MS, reclaimPort, type ReclaimOutcome } from './serveweb-reclaim';
import { choosePort } from './serveweb-port';
import { createOutputTail, describeEarlyExit } from './serveweb-failure';
import { ensureEditorSettingsFile } from './serveweb-settings';
import type { ServerLicenseConsent } from './serveweb-license';
import { chooseServerCommand, type LaunchFs, type ServerDirs } from './serveweb-launch';
import { DEV_PROFILE } from '../shared/config';
import { reportDiagnostic } from './diagnostics';
import { commandText, createServerOutputReporter, describeLaunchError, describeProbe, describeServerStop } from './diagnostics/editor-server';

const CONNECTION_TOKEN = randomBytes(24).toString('hex');
const PREFERRED_PORT = DEV_PROFILE ? 9889 : 9888;
const SERVER_DATA_DIR = path.join(os.homedir(), '.vscode-server');
const SERVER_EXT_DIR = path.join(SERVER_DATA_DIR, 'extensions');
const SERVER_USER_DIR = path.join(SERVER_DATA_DIR, 'data');
const USER_SETTINGS = path.join(SERVER_USER_DIR, 'User', 'settings.json');
const SERVER_DIRS: ServerDirs = { data: SERVER_DATA_DIR, extensions: SERVER_EXT_DIR, user: SERVER_USER_DIR };
const LAUNCH_FS: LaunchFs = {
  realpath: (file) => fs.realpathSync(file),
  readText: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  isExecutable: (file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};
const CLAUDE_EXT_ID = 'anthropic.claude-code';
const CODEX_EXT_ID = 'openai.chatgpt';
const SERVER_EXT_IDS = [CLAUDE_EXT_ID, CODEX_EXT_ID];
const PROBE_TIMEOUT_MS = 1500;
const POLL_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 1000;
const MS_PER_MINUTE = 60_000;
const START_DEADLINE_MS = 5 * MS_PER_MINUTE;
const EXIT_GRACE_MS = 5000;
const OUTPUT_DRAIN_MS = 500;
const LICENSE_DECLINED = 'The editor needs you to accept the VS Code server licence. Retry to be asked again.';

const CODE_CANDIDATES = codeCandidates({ platform: process.platform, home: os.homedir(), env: process.env });

// On Windows `code` is a .cmd shim, which Node refuses to spawn without a shell;
// quote args so paths with spaces (Program Files) survive the shell join.
function spawnCode(bin: string, args: string[], opts: any) {
  if (process.platform === 'win32') {
    const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
    return spawn(q(bin), args.map(q), { ...opts, shell: true, windowsHide: true });
  }
  return spawn(bin, args, opts);
}

let proc: ChildProcess | null = null;
let ready = false;
let onReadyCb: (() => void) | null = null;
let onProgressCb: (() => void) | null = null;
let progress = '';
let phase = '';
let percent: number | null = null;
let failed = false;
let starting = false;
let port = PREFERRED_PORT;
let pollGen = 0;
let dying: ChildProcess | null = null;
let stopping: Promise<void> = Promise.resolve();
let killing = 0;
let reclaimIdleHosts = false;
let graceSeconds: number | null = null;
let directLaunchFailed = false;
let licenseConsent: ServerLicenseConsent | null = null;
let askingLicense = false;
let lastPage: ServerPage | null = null;

function setProgress(text: string, ph?: string, pct?: number | null) {
  progress = text;
  if (ph !== undefined) phase = ph;
  if (pct !== undefined) percent = pct;
  if (onProgressCb) onProgressCb();
}

function handleLine(line: string) {
  const p = classifyProgressLine(line);
  if (p) setProgress(p.text, p.phase, p.percent);
}

function consume(stream: NodeJS.ReadableStream | null, onLine?: (line: string) => void) {
  if (!stream) return;
  let buf = '';
  stream.on('data', (d: Buffer) => {
    buf += d.toString();
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i);
      handleLine(line);
      onLine?.(line);
      buf = buf.slice(i + 1);
      i = buf.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (buf) onLine?.(buf);
    buf = '';
  });
}

function codeBin() {
  return findCodeBin(CODE_CANDIDATES, fs.existsSync);
}

function isAvailable() {
  return !!codeBin();
}

// The `code` wrapper sets ELECTRON_RUN_AS_NODE itself; strip any inherited value
// so it isn't double-set.
function cleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function hasExtension(id: string) {
  try {
    return fs.readdirSync(SERVER_EXT_DIR).some((n) => n.toLowerCase().startsWith(id));
  } catch {
    return false;
  }
}

// Best-effort install of the missing extensions (Claude Code, Codex) into the
// serve-web store, one at a time; always calls cb so startup proceeds.
function ensureExtension(bin: string, cb: () => void, ids = SERVER_EXT_IDS) {
  const id = ids.find((e) => !hasExtension(e));
  if (!id) return cb();
  setProgress(`Installing the ${id === CODEX_EXT_ID ? 'Codex' : 'Claude Code'} extension…`, 'extension', null);
  let p;
  try {
    p = spawnCode(bin, ['--extensions-dir', SERVER_EXT_DIR, '--install-extension', id], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return cb();
  }
  consume(p.stdout);
  consume(p.stderr);
  // Move on whether or not it installed, so a failing id can't loop.
  let done = false;
  const next = () => {
    if (done) return;
    done = true;
    ensureExtension(bin, cb, ids.filter((e) => e !== id));
  };
  p.on('exit', next);
  p.on('error', next);
}

// The Claude extension disables voice in a "remote" host
// (isSpeechToTextEnabled(){ if(<vscode>.env.remoteName) return false; ... }), but
// serve-web is physically this Mac, so strip only that guard to re-enable the mic.
// Version-resilient regex; backs up once.
function ensureSpeechPatch() {
  let dirs;
  try {
    dirs = fs.readdirSync(SERVER_EXT_DIR).filter((n) => n.startsWith(CLAUDE_EXT_ID));
  } catch {
    return false;
  }
  const guard = /(isSpeechToTextEnabled\(\)\{)if\([\w$]+\.env\.remoteName\)return\s*!1;/;
  let changed = false;
  for (const d of dirs) {
    const file = path.join(SERVER_EXT_DIR, d, 'extension.js');
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!guard.test(code)) continue;
    try {
      if (!fs.existsSync(file + '.ccm-bak')) fs.writeFileSync(file + '.ccm-bak', code);
      fs.writeFileSync(file, code.replace(guard, '$1'));
      changed = true;
    } catch {}
  }
  return changed;
}

// A killed server can still answer a probe for a moment; start() waits for its tree
// to die so the dying process is never mistaken for a ready one.
function stopProc() {
  pollGen++;
  const child = proc;
  proc = null;
  graceSeconds = null;
  if (!child) return;
  dying = child;
  setTimeout(() => {
    if (dying === child) dying = null;
  }, EXIT_GRACE_MS);
  killing++;
  stopping = killChildTree(child, KILL_GRACE_MS).finally(() => killing--);
}

// Lantern owns the server's lifetime: anything left running would hold the port
// across restarts and could not be recycled by the next run.
function shutdown() {
  const inFlight = stopping;
  stopProc();
  dying = null;
  ready = false;
  return Promise.all([inFlight, stopping]).then(() => {});
}

// Recycle the server so a freshly-patched extension is reloaded by the host. The
// scan loop's probe-first start respawns it. Also the Retry path out of a failure.
function recycle() {
  stopProc();
  ready = false;
  failed = false;
  starting = false;
  progress = '';
  phase = '';
  percent = null;
}

function markReady() {
  pollGen++;
  ready = true;
  starting = false;
  setProgress('VS Code server ready', 'ready', MAX_PERCENT);
  if (onReadyCb) onReadyCb();
}

// A failure sticks until recycle(): the scan loop calls start() every few seconds,
// and silently respawning is what used to leave users on an endless spinner.
function fail(text: string, alreadyReported = false) {
  stopProc();
  failed = true;
  starting = false;
  setProgress(text, 'error', null);
  if (!alreadyReported) reportDiagnostic({ source: 'editor-server', severity: 'error', message: text, detail: `Health check: ${describeProbe(lastPage, port)}` });
}

function start(onReady?: () => void, onProgress?: () => void, options?: StartOptions) {
  onReadyCb = onReady || onReadyCb;
  onProgressCb = onProgress || onProgressCb;
  if (options) {
    reclaimIdleHosts = options.reclaimIdleHosts;
    licenseConsent = options.license;
  }
  ensureEditorSettingsFile(USER_SETTINGS);
  if (ready) {
    if (onReadyCb) onReadyCb();
    return;
  }
  if (failed || starting || dying || killing || askingLicense) return;
  if (!licenseAccepted()) {
    if (options?.askLicense) askForLicense();
    return;
  }
  begin();
}

const licenseAccepted = () => licenseConsent?.accepted() === true;

function askForLicense() {
  if (!licenseConsent) return;
  askingLicense = true;
  licenseConsent.ask().then((granted) => {
    askingLicense = false;
    if (granted) return start();
    fail(LICENSE_DECLINED);
  });
}

function begin() {
  starting = true;
  lastPage = null;
  const gen = pollGen;
  setTimeout(() => {
    if (gen === pollGen && !ready) fail(`The VS Code server didn’t start within ${START_DEADLINE_MS / MS_PER_MINUTE} minutes.`);
  }, START_DEADLINE_MS);
  setProgress('Checking for a running server…', 'probe', null);
  reclaimPort(PREFERRED_PORT, () => setProgress('Stopping a leftover VS Code server…', 'probe', null))
    .then((outcome) => {
      if (gen === pollGen) probeThenChoose(outcome, gen);
    });
}

function probeThenChoose(outcome: ReclaimOutcome, gen: number) {
  const useOn = (chosen: number) => {
    if (gen !== pollGen) return;
    port = chosen;
    fetchServerPage(port, PROBE_TIMEOUT_MS, CONNECTION_TOKEN, (page) => {
      if (gen === pollGen) onPage(page, gen);
    });
  };
  const choose = () => choosePort(outcome, PREFERRED_PORT, port).then(useOn, () => {
    if (gen === pollGen) fail('No free local port is available for the VS Code server.');
  });
  if (outcome !== 'free') return void choose();
  fetchServerPage(PREFERRED_PORT, PROBE_TIMEOUT_MS, CONNECTION_TOKEN, (page) => {
    if (gen !== pollGen) return;
    if (!page || page === 'other') return void choose();
    port = PREFERRED_PORT;
    onPage(page, gen);
  });
}

function launch(gen: number) {
  const bin = codeBin();
  if (!bin) return fail('VS Code CLI not found');
  ensureExtension(bin, () => {
    if (gen !== pollGen) return;
    spawnServer(bin, gen);
  });
}

function serverCommand(bin: string) {
  const command = chooseServerCommand({
    codeBin: bin,
    port,
    token: CONNECTION_TOKEN,
    licenseAccepted: licenseAccepted(),
    home: os.homedir(),
    platform: process.platform,
    dirs: SERVER_DIRS,
    fs: LAUNCH_FS,
    reclaimIdleHosts,
    directLaunchFailed,
  });
  if (command.kind === 'serve-web' && command.warning) {
    console.warn(`[serveweb] not launching the server directly (${command.warning}); starting "code serve-web" with its default reconnection grace time`);
  }
  return command;
}

function abandonDirectLaunch(reason: string, bin: string) {
  directLaunchFailed = true;
  console.warn(`[serveweb] the directly launched server ${reason}; starting "code serve-web" instead`);
  reportDiagnostic({ source: 'editor-server', severity: 'warning', message: `The directly launched VS Code server ${reason}; starting "code serve-web" instead` });
  startServerProcess(bin);
}

function spawnServer(bin: string, gen: number) {
  if (proc) return;
  startServerProcess(bin);
  poll(gen);
}

function startServerProcess(bin: string) {
  if (!licenseAccepted()) return fail(LICENSE_DECLINED);
  setProgress('Starting the VS Code server…', 'starting', null);
  const command = serverCommand(bin);
  const direct = command.kind === 'direct';
  const options = { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
  const child = direct ? spawn(command.bin, command.args, options) : spawnCode(command.bin, command.args, options);
  proc = child;
  graceSeconds = command.graceSeconds;
  if (command.kind === 'direct') console.log(`[serveweb] launching server build ${command.commit} directly with a ${command.graceSeconds}s reconnection grace time`);
  const tail = createOutputTail();
  const stderrReport = createServerOutputReporter(reportDiagnostic);
  const commandLine = commandText(command.bin, command.args);
  consume(child.stdout, tail.push);
  consume(child.stderr, (line) => {
    tail.push(line);
    stderrReport.push(line);
  });
  child.on('error', (error) => {
    if (proc !== child) return;
    proc = null;
    graceSeconds = null;
    reportDiagnostic(describeLaunchError(error, commandLine, process.platform));
    if (direct) return abandonDirectLaunch('could not be started', bin);
    fail('Couldn’t launch the VS Code server.', true);
  });
  child.on('exit', (code, signal) => {
    if (dying === child) dying = null;
    if (proc !== child) return;
    proc = null;
    graceSeconds = null;
    const stop = describeServerStop({ code, signal, wasReady: ready, platform: process.platform, command: commandLine, tail: tail.lines() });
    if (stop) reportDiagnostic(stop);
    if (direct && !ready) return abandonDirectLaunch('exited before it was ready', bin);
    if (ready) {
      ready = false;
      return;
    }
    const exitGen = ++pollGen;
    afterOutputDrained(child, () => {
      if (exitGen === pollGen) fail(describeEarlyExit(tail.lines(), port), true);
    });
  });
}

function afterOutputDrained(child: ChildProcess, done: () => void) {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    done();
  };
  child.once('close', once);
  setTimeout(once, OUTPUT_DRAIN_MS);
}

function poll(gen: number) {
  fetchServerPage(port, POLL_TIMEOUT_MS, CONNECTION_TOKEN, (page) => {
    if (gen !== pollGen || ready || failed) return;
    onPage(page, gen);
  });
}

// A server still answering here is ours, or one reclaimPort couldn't identify (e.g.
// on Windows); reuse it rather than race it for the port.
function onPage(page: ServerPage | null, gen: number) {
  lastPage = page;
  if (page === 'workbench') return markReady();
  if (!page && !proc) return launch(gen);
  if (page === 'downloading' && phase !== 'download') setProgress('Downloading the VS Code server…', 'download', null);
  setTimeout(() => poll(gen), POLL_INTERVAL_MS);
}

function status() {
  return { port, token: CONNECTION_TOKEN, ready, available: isAvailable(), progress, phase, percent, graceSeconds };
}

function serverPid() {
  return proc?.pid ?? null;
}

export interface StartOptions {
  reclaimIdleHosts: boolean;
  license: ServerLicenseConsent;
  askLicense: boolean;
}

export { start, status, serverPid, isAvailable, ensureSpeechPatch as applyPatch, recycle, shutdown, classifyProgressLine, PREFERRED_PORT };
