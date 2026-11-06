import fs from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { PR_EXPLAIN_MAX_RAW_CHARS, PR_EXPLAIN_MODEL, cleanExplanation } from './pr-explain-prompt';
import { isSignalablePid, killChildTree } from './prockill';

const PR_EXPLAIN_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const MAX_STDERR_CHARS = 4_000;

// `--tools ""` leaves the model with no tools at all, so no permission rule of the project or the user applies;
// the scratch working directory keeps the project's own settings and CLAUDE.md out of the run.
const PR_EXPLAIN_ARGS = ['-p', '--model', PR_EXPLAIN_MODEL, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'];

interface Launch {
  command: string;
  args: string[];
}

interface OneShotUsage {
  costUsd?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

type OneShotResult = { ok: true; text: string; usage: OneShotUsage } | { ok: false; cancelled: boolean; error: string };

interface OneShotDeps {
  prepareLaunch(args: string[]): Launch | { error: string };
  scratchDir: string;
  timeoutMs?: number;
  maxReplyChars?: number;
  spawn?: typeof nodeSpawn;
}

interface OneShotRun {
  done: Promise<OneShotResult>;
  cancel(): void;
}

function numberOf(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function usageOf(reply: Record<string, unknown>): OneShotUsage {
  const usage = (reply.usage && typeof reply.usage === 'object' ? reply.usage : {}) as Record<string, unknown>;
  return {
    costUsd: numberOf(reply.total_cost_usd),
    durationMs: numberOf(reply.duration_ms),
    inputTokens: numberOf(usage.input_tokens),
    outputTokens: numberOf(usage.output_tokens),
  };
}

function parseReply(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function failureText(stderr: string, code: number | null) {
  const line = stderr.trim().split('\n').find((l) => l.trim());
  return line ? line.trim().slice(0, 300) : `claude exited ${code}`;
}

function outcome(stdout: string, stderr: string, code: number | null, maxReplyChars = PR_EXPLAIN_MAX_RAW_CHARS): OneShotResult {
  const reply = parseReply(stdout);
  if (reply?.is_error === true) return { ok: false, cancelled: false, error: cleanExplanation(reply.result).slice(0, 300) || failureText(stderr, code) };
  if (code !== 0) return { ok: false, cancelled: false, error: failureText(stderr, code) };
  const text = reply ? cleanExplanation(reply.result, maxReplyChars) : '';
  if (!text) return { ok: false, cancelled: false, error: reply ? 'Claude returned an empty explanation.' : 'Claude returned an unreadable reply.' };
  return { ok: true, text, usage: usageOf(reply!) };
}

function killRun(proc: ChildProcess) {
  const pid = proc.pid;
  if (process.platform === 'win32') {
    void killChildTree(proc, 0);
    return;
  }
  try {
    if (pid !== undefined && isSignalablePid(pid)) process.kill(-pid, 'SIGKILL');
    else proc.kill('SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {}
  }
}

function startOneShot(deps: OneShotDeps, prompt: string): OneShotRun | { error: string } {
  const launch = deps.prepareLaunch(PR_EXPLAIN_ARGS);
  if ('error' in launch) return launch;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let proc: ChildProcess;
  try {
    fs.mkdirSync(deps.scratchDir, { recursive: true });
    // `detached` gives the CLI its own process group so cancel and the timeout reach everything it started.
    proc = (deps.spawn ?? nodeSpawn)(launch.command, launch.args, { cwd: deps.scratchDir, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  } catch (e) {
    return { error: (e as Error).message };
  }

  let settled = false;
  let finish: (result: OneShotResult) => void = () => {};
  const done = new Promise<OneShotResult>((resolve) => {
    finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
  });
  const timeoutMs = deps.timeoutMs ?? PR_EXPLAIN_TIMEOUT_MS;
  const timer = setTimeout(() => {
    finish({ ok: false, cancelled: false, error: `Timed out after ${Math.round(timeoutMs / 1000)} seconds.` });
    killRun(proc);
  }, timeoutMs);

  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (d: Buffer | string) => {
    if (stdout.length < MAX_OUTPUT_CHARS) stdout += d.toString();
  });
  proc.stderr?.on('data', (d: Buffer | string) => {
    stderr = `${stderr}${d.toString()}`.slice(-MAX_STDERR_CHARS);
  });
  proc.on('error', (e) => finish({ ok: false, cancelled: false, error: e.message }));
  proc.on('close', (code) => finish(outcome(stdout, stderr, code, deps.maxReplyChars)));
  proc.stdin?.on('error', () => {});
  proc.stdin?.end(prompt);

  return {
    done,
    cancel() {
      finish({ ok: false, cancelled: true, error: 'Cancelled.' });
      killRun(proc);
    },
  };
}

export { PR_EXPLAIN_ARGS, PR_EXPLAIN_TIMEOUT_MS, startOneShot };
export type { OneShotDeps, OneShotResult, OneShotRun, OneShotUsage };
