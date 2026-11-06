import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { installBundle } from '../../scripts/lantern-bundle.mjs';
import { applyInjection } from './auth/spawn-env';
import type { CredentialInjection } from './auth/spawn-env';
import { binCandidatesFor, describeNotFound, planLaunch, resolveBinFor } from './claude-bin';
import type { BinContext } from './claude-bin';
import { readExistingMapLang } from './lantern-texts';
import { languageCode } from '../shared/languages';
import { codexArgs, createCodexDecoder, resolveCodexBin } from './agent-codex';
import { VIEW, say } from '../shared/lantern-plan-messages';
import { PROJECT_DATA_DIR } from '../shared/project-data';
import { ensureLocalDir } from './metadir';
import { planFixPrompt, planFixTools } from './lantern-plan-fix';
import { newWatch, runAreasGate, watchMessage, workerDenialText } from './lantern-run-gate';
import type { RunWatch } from './lantern-run-gate';
import { killChildTree } from './prockill';
import { isSessionId, providerLabel, providerSkillsDir } from './provider';
import type { Provider } from './provider';

interface AgentEvent {
  kind: 'start' | 'text' | 'tool' | 'done' | 'error' | 'cancelled';
  text?: string;
  tool?: string;
  detail?: string;
  ok?: boolean;
  costUsd?: number;
  durationMs?: number;
  denials?: number;
  runId?: number;
}

let configuredBin: () => string = () => '';

function setConfiguredBin(source: () => string) {
  configuredBin = source;
}

function binContext(): BinContext {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    exists: (file) => fs.existsSync(file),
  };
}

function binCandidates() {
  return binCandidatesFor(binContext(), configuredBin());
}

// GUI-launched apps inherit a minimal PATH, so look in the known install locations first,
// then every PATH entry, then ask the user's own shell where `claude` lives.
function resolveClaudeBin(): string | null {
  return resolveBinFor(binContext(), configuredBin());
}

function resolveBin(provider: Provider = 'claude') {
  return provider === 'codex' ? resolveCodexBin() : resolveClaudeBin();
}

function claudeNotFoundMessage() {
  return describeNotFound(binContext(), configuredBin());
}

// A run outside the agent slot (no project, no session) still finds and launches `claude` the way every other run does.
function prepareClaudeLaunch(args: string[]): { command: string; args: string[] } | { error: string } {
  const bin = resolveClaudeBin();
  if (!bin) return { error: claudeNotFoundMessage() };
  return planLaunch(binContext(), bin, args, readText);
}

function readText(file: string) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isAvailable(provider: Provider = 'claude') {
  return resolveBin(provider) !== null;
}

const UNATTENDED_LINE = "Nobody can answer you: this run is unattended, so never end it by asking the user a question or for a choice. If the language you were given disagrees with the language the existing map is written in, keep the map's existing primary language and continue.";

const LANTERN_AREAS_SCRATCH = `${PROJECT_DATA_DIR}/areas`;

const RESUME_LINE = 'This run may continue an earlier one that was stopped: whatever is already in .lantern/ is finished work. Map only the chunks plan.mjs . pending lists, and never redo a chunk that is done.';

const KINDS = {
  lantern: {
    skill: 'lantern-setup',
    prompt: [
      'Use the lantern-setup skill to build the .lantern/ architecture map for this project.',
      'Follow the whole lantern-setup procedure, including platforms (step 1a), sections (step 4) and areas (step 4a).',
      RESUME_LINE,
      UNATTENDED_LINE,
      'Write only inside .lantern/: map records in .lantern/map/, texts in .lantern/lang/. Finish with validate.mjs . --settled --require-areas passing.',
    ],
  },
  'lantern-refresh': {
    skill: 'lantern-setup',
    prompt: [
      'Use the lantern-setup skill to refresh the existing .lantern/ architecture map for this project.',
      'Follow the whole lantern-setup procedure, including platforms (step 1a), sections (step 4) and areas (step 4a): re-map stale files, add unmapped ones, drop deleted ones.',
      'If the existing map is a legacy one (records with " | purpose"), run migrate-lang.mjs first.',
      RESUME_LINE,
      UNATTENDED_LINE,
      'Write only inside .lantern/. Finish with validate.mjs . --settled --require-areas passing.',
    ],
  },
} as const;

type AgentKind = keyof typeof KINDS | 'plan-fix';

function isAgentKind(kind: unknown): kind is AgentKind {
  return kind === 'plan-fix' || (typeof kind === 'string' && Object.hasOwn(KINDS, kind));
}

function skillFor(kind: AgentKind) {
  if (kind === 'plan-fix') return 'lantern-plan';
  return KINDS[kind].skill;
}

function skillLinked(projectPath: string, skill: string, provider: Provider = 'claude') {
  try {
    return fs.existsSync(path.join(providerSkillsDir(projectPath, provider), skill));
  } catch {
    return false;
  }
}

function lanternRunLines(project: string | undefined, provider: Provider): string[] {
  const gated = provider === 'claude';
  const root = project ?? '<project root>';
  const skill = project ? path.join(providerSkillsDir(project, provider), 'lantern-setup') : '<skill folder>';
  return [
    `Project root: ${root}. Skill folder: ${skill}.`,
    `Run every skill script as ONE plain command with those literal absolute paths, for example: node ${skill}/scripts/plan.mjs ${root} status. This run refuses cd, shell variables (L=...; $L), loops, heredocs, redirects, python and find -exec, and a refused call is lost work. Put the same rule and the literal paths in the brief of every lantern-mapper worker you dispatch.${gated ? ' A worker whose command is refused fails this run.' : ''}`,
    `Areas (step 4a) are part of this run, not an extra. After the last chunk and the sections, node ${skill}/scripts/areas.mjs ${root} required says whether the map needs them. When it exits 1, run the whole "Areas loop" yourself, never in a worker, with the blind lookup as areas.mjs ${root} lookup run --out ${LANTERN_AREAS_SCRATCH}.${gated ? ' A run that has not done step 4a is reported as failed.' : ''}`,
  ];
}

function buildPrompt(kind: Exclude<AgentKind, 'plan-fix'>, _language = 'english', _target?: string, provider: Provider = 'claude', project?: string) {
  return [...KINDS[kind].prompt, ...lanternRunLines(project, provider)].join(' ');
}

// The lantern-setup skill must run its own node scripts (enumerate, plan, validate) to
// get real hashes; acceptEdits alone would deny them in headless mode. Not narrowed to
// the skill's scripts/*.mjs: the skill invokes them through a `$L` shell variable and
// the CLI matches the unexpanded command text, so a path-scoped pattern would deny them.
// Read is allowed too: headless acceptEdits denies reading the skill's own references/
// (format.md, roles.md) under .claude/skills, and a run without them can leave files unmapped.
// Agent lets the run dispatch lantern-mapper workers for maps of more than 2 chunks.
// The read-only shell commands stop those workers from being denied when they cat or grep
// files, which made them write nothing and sent the whole chunk back to the main agent.
const LANTERN_READONLY_SHELL = ['Bash(cat:*)', 'Bash(ls:*)', 'Bash(wc:*)', 'Bash(head:*)', 'Bash(grep:*)', 'Bash(tail:*)', 'Bash(sort:*)', 'Bash(uniq:*)', 'Bash(cut:*)', 'Bash(du:*)'];

function allowedToolsFor(kind: AgentKind, target?: string): string[] {
  if (kind === 'plan-fix') return planFixTools(target ?? '');
  return isLanternKind(kind) ? ['Bash(node:*)', 'Read', 'Agent', ...LANTERN_READONLY_SHELL] : [];
}

const LANTERN_MODEL = 'claude-sonnet-5-5';

function isLanternKind(kind: AgentKind) {
  return kind === 'lantern' || kind === 'lantern-refresh';
}

// An explicit choice wins; otherwise a run on an existing map speaks the map's language, so a
// refresh of a Polish map does not see every record as unmapped.
function runLanguageCode(requested: string | undefined, mapPrimary: string | null) {
  return requested ? languageCode(requested) : mapPrimary || 'en';
}

// The app ships its own copy of the skills: esbuild puts them at out/skills/<name>, and in
// dev/tests they are the repo's skills/ folder two levels above src/main.
const LANTERN_SKILLS = ['lantern-setup', 'lantern-sync'];

function bundledSkillsRoot() {
  const shipped = path.join(__dirname, 'skills');
  return fs.existsSync(shipped) ? shipped : path.join(__dirname, '..', '..', 'skills');
}

function bundledSkillDir() {
  return path.join(bundledSkillsRoot(), 'lantern-setup');
}

// Set up / Refresh need the two skills even where git does not ignore .claude: the user asked
// for the run, so the git guard of the open-time install does not apply. Same rules otherwise.
function ensureLanternSkills(project: string, home = os.homedir(), root = bundledSkillsRoot(), provider: Provider = 'claude') {
  return installBundle({ project, root, home, skills: LANTERN_SKILLS, agents: false, provider }).skills;
}

function preflight(project: string, kind: AgentKind, provider: Provider = 'claude'): string | null {
  if (isLanternKind(kind)) return null;
  const skill = skillFor(kind);
  if (skillLinked(project, skill, provider)) return null;
  return provider === 'claude' ? `The ${skill} skill is not linked in this project — add it via Skills first.` : `The ${skill} skill is not linked for ${providerLabel(provider)} in this project — add it via Skills first.`;
}

function prepareLocalDir(project: string) {
  try {
    ensureLocalDir(project);
  } catch {}
}

const MAPPER_AGENT = 'lantern-mapper.md';

function ensureMapperAgent(project: string, home = os.homedir(), root = bundledSkillsRoot()): 'exists' | 'installed' | 'refreshed' | 'missing-source' {
  if (!fs.existsSync(path.join(root, 'lantern-setup', 'agents', MAPPER_AGENT))) return 'missing-source';
  const existed = fs.existsSync(path.join(project, '.claude', 'agents', MAPPER_AGENT));
  const { agents } = installBundle({ project, root, home, skills: [], agents: [MAPPER_AGENT], adopt: [MAPPER_AGENT] });
  if (!agents?.files.includes(MAPPER_AGENT)) return 'exists';
  return existed ? 'refreshed' : 'installed';
}

// acceptEdits would let a plan fix edit any file of the project, so it asks for the default mode and only the allowed tools.
function buildArgs(kind: AgentKind, prompt: string, sessionId?: string | null, target?: string) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', kind === 'plan-fix' ? 'default' : 'acceptEdits'];
  if (isLanternKind(kind)) args.push('--model', LANTERN_MODEL);
  const tools = allowedToolsFor(kind, target);
  if (tools.length) args.push('--allowedTools', ...tools);
  if (sessionId) args.push('--resume', sessionId, '--fork-session');
  return args;
}

let child: ChildProcess | null = null;
let runCounter = 0;
let currentRunId = 0;
let currentProvider: Provider = 'claude';
let currentTerminal = false;
let emitToRun: ((event: AgentEvent) => void) | null = null;
const cancelled = new WeakSet<ChildProcess>();

function exitEvent(code: number | null, wasCancelled: boolean, stderr: string, hadTerminal = false, provider: Provider = 'claude'): AgentEvent | null {
  if (provider === 'claude') {
    if (wasCancelled || code === 0) return null;
    return { kind: 'error', text: stderr.trim() || `claude exited ${code}` };
  }
  if (wasCancelled || hadTerminal) return null;
  const name = providerLabel(provider);
  if (code === 0) return { kind: 'error', text: stderr.trim() || `${name} exited without a completion event.` };
  return { kind: 'error', text: stderr.trim() || `${name} exited ${code}` };
}

function onProcessClose(proc: ChildProcess, onClose: (code: number | null) => void) {
  proc.once('close', onClose);
}

function isRunning() {
  return currentProvider === 'claude' ? child !== null : child !== null && !currentTerminal;
}

function runningProvider(): Provider | null {
  return child ? currentProvider : null;
}

const DETAIL_MAX = 400;

function toolDetail(input: any): string | undefined {
  const raw = input?.file_path ?? input?.command ?? input?.description ?? input?.pattern;
  if (typeof raw !== 'string') return undefined;
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, DETAIL_MAX) : undefined;
}

function handleLine(line: string, onEvent: (e: AgentEvent) => void, watch?: RunWatch) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (watch) watchMessage(watch, msg, (input) => toolDetail(input));
  if (msg.type === 'system' && msg.subtype === 'init') {
    onEvent({ kind: 'start' });
  } else if (msg.type === 'assistant') {
    for (const c of msg.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) onEvent({ kind: 'text', text: c.text });
      else if (c.type === 'tool_use') onEvent({ kind: 'tool', tool: c.name, detail: toolDetail(c.input) });
    }
  } else if (msg.type === 'result') {
    onEvent({
      kind: 'done',
      ok: msg.subtype === 'success' && !msg.is_error,
      costUsd: msg.total_cost_usd,
      durationMs: msg.duration_ms,
      denials: (msg.permission_denials || []).length,
    });
  }
}

interface StartOptions {
  project: string;
  kind: AgentKind;
  target?: string;
  language?: string;
  sessionId?: string | null;
  provider?: Provider;
  credentialEnv?: CredentialInjection;
  onSessionId?: (id: string) => void;
  onEvent: (e: AgentEvent) => void;
}

// A Codex CLI can linger after turn.completed while isRunning() already reports idle;
// reap it so the next run isn't refused. A cancel still in flight keeps the slot.
function reapFinishedCodex() {
  if (!child || currentProvider !== 'codex' || !currentTerminal || cancelled.has(child)) return;
  const proc = child;
  cancelled.add(proc);
  try {
    if (process.platform !== 'win32' && proc.pid && proc.pid > 1) process.kill(-proc.pid, 'SIGKILL'); // whole process group; -1 would signal every process the user owns
    else proc.kill();
  } catch {}
  child = null;
}

function start(options: StartOptions): { ok: boolean; error?: string; runId?: number } {
  if (!isAgentKind(options.kind)) return { ok: false, error: `Unknown agent kind: ${String(options.kind)}` };
  if (options.kind === 'plan-fix' && options.provider === 'codex') return { ok: false, error: say(VIEW.FIX_CODEX) };
  reapFinishedCodex();
  if (child) return { ok: false, error: 'already running' };
  return options.provider === 'codex' ? startCodex(options) : startClaude(options);
}

async function settleLanternRun(project: string, done: AgentEvent, watch: RunWatch, languageCode: string): Promise<AgentEvent> {
  if (!done.ok) return { ...done, denials: (done.denials ?? 0) + watch.denied.length };
  if (watch.denied.length) return { kind: 'error', text: workerDenialText(watch.denied) };
  const gate = await runAreasGate(project, path.join(bundledSkillDir(), 'scripts', 'areas.mjs'), languageCode);
  if (gate && !gate.ok) return { kind: 'error', text: gate.text };
  return done;
}

function startClaude({ project, kind, target, language, sessionId, credentialEnv, onEvent }: StartOptions): { ok: boolean; error?: string; runId?: number } {
  const bin = resolveBin();
  if (!bin) return { ok: false, error: claudeNotFoundMessage() };
  const blocked = preflight(project, kind);
  if (blocked) return { ok: false, error: blocked };
  prepareLocalDir(project);

  const request = kind === 'plan-fix' ? planFixPrompt(project, target) : { prompt: buildPrompt(kind, language, target, 'claude', project) };
  if ('error' in request) return { ok: false, error: request.error };

  const args = buildArgs(kind, request.prompt, sessionId, target);
  const launch = planLaunch(binContext(), bin, args, readText);
  if ('error' in launch) return { ok: false, error: launch.error };

  const env = applyInjection(process.env, credentialEnv);
  delete env.ELECTRON_RUN_AS_NODE;
  if (isLanternKind(kind)) {
    env.LANTERN_LANG = runLanguageCode(language, readExistingMapLang(project));
    if (launch.command === bin) env.CLAUDE_BIN = bin;
    try {
      for (const [name, status] of Object.entries(ensureLanternSkills(project))) {
        if (status === 'installed') onEvent({ kind: 'text', text: `Installed the bundled ${name} skill into .claude/skills/ for this run.` });
        else if (status === 'refreshed') onEvent({ kind: 'text', text: `Refreshed the bundled ${name} skill in .claude/skills/ for this run.` });
        else if (status === 'missing-source') return { ok: false, error: `The bundled ${name} skill is missing from this build.` };
      }
    } catch (e) {
      return { ok: false, error: `Could not install the bundled Lantern skills: ${(e as Error).message}` };
    }
    try {
      const installed = ensureMapperAgent(project);
      if (installed === 'installed') onEvent({ kind: 'text', text: 'Installed the lantern-mapper agent into .claude/agents/ for this run.' });
      else if (installed === 'refreshed') onEvent({ kind: 'text', text: 'Refreshed the lantern-mapper agent in .claude/agents/ for this run.' });
      else if (installed === 'missing-source') onEvent({ kind: 'text', text: 'lantern-mapper agent not found in the bundled skill; large maps may not be able to dispatch workers.' });
    } catch (e) {
      onEvent({ kind: 'text', text: `Could not install the lantern-mapper agent: ${(e as Error).message}` });
    }
  }

  try {
    // `detached` puts the CLI (and the subprocesses it spawns) in its own process
    // group so cancel can kill the whole tree — a plain child.kill() leaves those
    // children running and stranded the UI's run state.
    child = spawn(launch.command, launch.args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  } catch (err) {
    child = null;
    return { ok: false, error: (err as Error).message };
  }

  const proc = child;
  currentProvider = 'claude';
  currentRunId = ++runCounter;
  const runId = currentRunId;
  emitToRun = onEvent;
  const watch = isLanternKind(kind) ? newWatch() : undefined;
  let held: AgentEvent | null = null;
  const emit = (event: AgentEvent) => {
    if (watch && event.kind === 'done') held = event;
    else onEvent(event);
  };
  let buf = '';
  proc.stdout?.on('data', (d: Buffer) => {
    if (cancelled.has(proc)) return;
    buf += d.toString();
    let i = buf.indexOf('\n');
    while (i >= 0) {
      handleLine(buf.slice(0, i), emit, watch);
      buf = buf.slice(i + 1);
      i = buf.indexOf('\n');
    }
  });
  let err = '';
  proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  proc.on('error', (e) => {
    if (child === proc) child = null;
    if (!cancelled.has(proc)) onEvent({ kind: 'error', text: e.message });
  });
  let exitCode: number | null = null;
  proc.on('exit', (code) => {
    exitCode = code;
    if (child === proc && !(watch && code === 0)) child = null;
    const event = exitEvent(code, cancelled.has(proc), err);
    if (event) onEvent(event);
  });
  if (watch) {
    proc.once('close', () => {
      const done: AgentEvent | null = held;
      held = null;
      if (!done || !watch || cancelled.has(proc) || exitCode !== 0) {
        if (child === proc) child = null;
        return;
      }
      void settleLanternRun(project, done, watch, env.LANTERN_LANG ?? 'en').then((final) => {
        if (child === proc) child = null;
        if (!cancelled.has(proc)) onEvent(final);
      });
    });
  }

  return { ok: true, runId };
}

function startCodex({ project, kind, target, language, sessionId, credentialEnv, onSessionId, onEvent }: StartOptions): { ok: boolean; error?: string; runId?: number } {
  const provider: Provider = 'codex';
  const bin = resolveBin(provider);
  if (!bin) return { ok: false, error: `${providerLabel(provider)} CLI not found` };
  const blocked = preflight(project, kind, provider);
  if (blocked) return { ok: false, error: blocked };
  if (sessionId != null && !isSessionId(sessionId)) return { ok: false, error: 'Invalid session id for context' };
  prepareLocalDir(project);

  const prompt = buildPrompt(kind as Exclude<AgentKind, 'plan-fix'>, language, target, provider, project);
  const args = codexArgs(kind, sessionId, project);
  currentProvider = 'codex';
  currentRunId = ++runCounter;
  const runId = currentRunId;
  let terminal = false;
  currentTerminal = false;
  const emit = (event: AgentEvent) => {
    if (runId !== currentRunId || terminal) return;
    if (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled') {
      terminal = true;
      currentTerminal = true;
    }
    onEvent({ ...event, runId });
  };
  emitToRun = emit;
  const fail = (error: string) => {
    currentTerminal = true;
    emitToRun = null;
    return { ok: false, error };
  };

  const env = applyInjection({ ...process.env, LANTERN_PROVIDER: 'codex' }, credentialEnv);
  delete env.ELECTRON_RUN_AS_NODE;
  if (isLanternKind(kind)) {
    env.LANTERN_LANG = runLanguageCode(language, readExistingMapLang(project));
    try {
      for (const [name, status] of Object.entries(ensureLanternSkills(project, os.homedir(), bundledSkillsRoot(), provider))) {
        if (status === 'installed') emit({ kind: 'text', text: `Installed the bundled ${name} skill into .agents/skills/ for this run.` });
        else if (status === 'refreshed') emit({ kind: 'text', text: `Refreshed the bundled ${name} skill in .agents/skills/ for this run.` });
        else if (status === 'missing-source') return fail(`The bundled ${name} skill is missing from this build.`);
      }
    } catch (e) {
      return fail(`Could not install the bundled Lantern skills: ${(e as Error).message}`);
    }
  }

  try {
    // `detached` puts the CLI (and the subprocesses it spawns) in its own process
    // group so cancel can kill the whole tree — a plain child.kill() leaves those
    // children running and stranded the UI's run state.
    child = spawn(bin, args, {
      cwd: project,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
  } catch (err) {
    child = null;
    return fail((err as Error).message);
  }

  const proc = child;
  if (proc.stdin) {
    proc.stdin.on('error', () => {});
    proc.stdin.end(prompt);
  }
  const decoder = createCodexDecoder({ emit, onThread: (id) => isSessionId(id) ? onSessionId?.(id) : emit({ kind: 'error', text: 'Codex returned an invalid session id' }) });
  proc.stdout?.setEncoding?.('utf8');
  proc.stdout?.on('data', (d: Buffer | string) => {
    if (cancelled.has(proc) || runId !== currentRunId) return;
    decoder.write(d.toString());
  });
  let err = '';
  proc.stderr?.setEncoding?.('utf8');
  proc.stderr?.on('data', (d: Buffer | string) => (err = `${err}${d.toString()}`.slice(-16384)));
  proc.on('error', (e) => {
    if (child === proc) child = null;
    if (!cancelled.has(proc)) emit({ kind: 'error', text: e.message });
  });
  onProcessClose(proc, (code) => {
    if (child === proc) child = null;
    if (!cancelled.has(proc)) decoder.flush();
    const detail = [err.trim(), decoder.diagnostic()].filter(Boolean).join('\n');
    const event = exitEvent(code, cancelled.has(proc), detail, terminal, provider);
    if (event) emit(event);
    if (runId === currentRunId) emitToRun = null;
  });

  return { ok: true, runId };
}

async function cancel() {
  if (!child) return;
  if (currentProvider === 'claude') {
    cancelClaude();
    return;
  }
  await cancelCodex();
}

function cancelClaude() {
  if (!child) return;
  cancelled.add(child);
  const notify = emitToRun;
  const runId = currentRunId;
  const pid = child.pid;
  try {
    if (process.platform !== 'win32' && pid && pid > 1) process.kill(-pid, 'SIGKILL'); // whole process group; -1 would signal every process the user owns
    else child.kill();
  } catch {
    try {
      child.kill();
    } catch {}
  }
  child = null;
  notify?.({ kind: 'cancelled', runId });
}

async function cancelCodex() {
  if (!child) return;
  const proc = child;
  const closed = () => child !== proc ? Promise.resolve() : new Promise<void>((resolve) => proc.once('close', () => resolve()));
  if (cancelled.has(proc)) return closed();
  cancelled.add(proc);
  const notify = emitToRun;
  const closing = closed();
  const pid = proc.pid;
  if (pid && pid > 1) {
    if (process.platform === 'win32') {
      await killChildTree(proc, 1000);
    } else {
      try {
        process.kill(-pid, 'SIGKILL'); // whole process group; -1 would signal every process the user owns
      } catch {
        try {
          proc.kill();
        } catch {}
      }
    }
  }
  await closing;
  notify?.({ kind: 'cancelled' });
  currentTerminal = true;
  emitToRun = null;
}

export { prepareClaudeLaunch, start, cancel, exitEvent, handleLine, toolDetail, onProcessClose, allowedToolsFor, isRunning, runningProvider, isAvailable, resolveBin, binCandidates, claudeNotFoundMessage, setConfiguredBin, buildPrompt, buildArgs, skillLinked, languageCode, runLanguageCode, ensureMapperAgent, ensureLanternSkills, LANTERN_SKILLS, bundledSkillsRoot, bundledSkillDir, preflight, LANTERN_MODEL };
export type { AgentEvent, AgentKind };
