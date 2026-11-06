import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { stopChild } from './child.mjs';
import { parseResultLines } from './report.mjs';

export const MODEL = 'sonnet';
export const MAP_TIMEOUT_MS = 25 * 60 * 1000;
export const RUN_TIMEOUT_MS = 50 * 60 * 1000;

export const mapPrompt = () =>
  [
    'Use the lantern-setup skill to build the .lantern/ map of this project, unattended: nobody can answer questions.',
    'Validate the map as the skill says, commit .lantern/ to main with the message "chore: add the Lantern map",',
    'then run git push origin main.',
  ].join(' ');

export const runPrompt = (task) =>
  [
    `Use the lantern-delegate skill to delegate this task: ${task}`,
    'Headless run, nobody can answer questions: ask the user nothing. The PR target is main (settled).',
    'Dispatch one delegate and run it in the foreground (run_in_background false), because this session ends when you return.',
    "Then do the skill's handover steps (map gate, cost, cleanup) and end with the closing message the skill specifies.",
  ].join(' ');

export function claudeArgs({ prompt, budgetUsd }) {
  return [
    '-p',
    prompt,
    '--permission-mode',
    'auto',
    '--setting-sources',
    'project,local',
    '--model',
    MODEL,
    '--max-budget-usd',
    String(budgetUsd),
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

const STRIPPED_ENV = /^(CLAUDECODE|BITBUCKET_.*|GITHUB_TOKEN|GH_TOKEN|ATLASSIAN_.*|GLOBAL_ATLASSIAN_TOKEN|LANTERN_CREDENTIAL_.*|AGENT_USAGE_REPO|GIT_COMMIT_(NAME|EMAIL)|GIT_AUTHOR_.*|GIT_COMMITTER_.*)$/;

export function claudeEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !STRIPPED_ENV.test(name)));
}

export const sessionEnv = (env, home) => (home ? { ...claudeEnv(env), HOME: home } : claudeEnv(env));

export const KILL_GRACE_MS = 15000;

export function runClaude({ bin, cwd, prompt, budgetUsd, logFile, timeoutMs, children, home, killGraceMs = KILL_GRACE_MS }) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'w');
    const err = fs.openSync(`${logFile}.err`, 'w');
    const child = spawn(bin, claudeArgs({ prompt, budgetUsd }), { cwd, env: sessionEnv(process.env, home), stdio: ['ignore', out, err] });
    children.add(child);
    let timedOut = false;
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild(child);
      killTimer = setTimeout(() => stopChild(child, 'SIGKILL'), killGraceMs);
    }, timeoutMs);
    let finished = false;
    const finish = (exitCode, spawnError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      children.delete(child);
      fs.closeSync(out);
      fs.closeSync(err);
      const results = parseResultLines(fs.readFileSync(logFile, 'utf8'));
      resolve({ exitCode, timedOut, spawnError, results, result: results.at(-1) ?? null, costKnown: results.length > 0 });
    };
    child.once('error', (e) => finish(null, e.message));
    child.once('exit', (code) => finish(code));
  });
}
