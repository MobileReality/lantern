import os from 'node:os';
import path from 'node:path';
import { result } from './checks.mjs';
import { bundlePanel } from './panel.mjs';
import { buildReport, capExceeded, sumCost } from './report.mjs';
import { MAP_TIMEOUT_MS, mapPrompt, RUN_TIMEOUT_MS, runClaude, runPrompt } from './session.mjs';
import { verifyProject } from './verify.mjs';
import { REPO_ROOT, transcriptsHome } from './workspace.mjs';

export const PROJECTS_HOME = path.join(os.homedir(), '.claude', 'projects');

export function sessionFailure(session) {
  if (session.spawnError) return `claude did not start: ${session.spawnError}`;
  if (session.timedOut) return 'timed out';
  if (!session.result) return `no result line (exit ${session.exitCode}), see the .err log`;
  if (session.result.is_error) return `result is_error (${session.result.subtype})`;
  return null;
}

export function sessionCheck(name, session) {
  const failure = sessionFailure(session);
  return result(name, failure === null, failure ?? `ok, $${sumCost(session.results).toFixed(2)}`);
}

export const spentBy = (states) => states.reduce((sum, s) => sum + sumCost(s.map?.results ?? []) + sumCost(s.run?.results ?? []), 0);

function runPhase(states, { key, prompt, budgetUsd, timeoutMs, bin, ws, children }) {
  return Promise.all(
    states.map(async (state) => {
      const logFile = path.join(ws.logsDir, `${key}-${state.project.name}.jsonl`);
      state[key] = await runClaude({ bin, cwd: state.project.dir, prompt: prompt(state.project), budgetUsd, logFile, timeoutMs, children, home: state.project.home });
    }),
  );
}

async function checksFor({ state, ws, panel, sinceMs, projectsHome, verifyOptions }) {
  const checks = [sessionCheck('map-build-session', state.map)];
  if (!state.run) return [...checks, result('session-finished', false, 'skipped: the orchestrator session was not started')];
  try {
    const verified = await verifyProject({ ws, project: state.project, sessionResult: state.run.result, sinceMs, projectsHome: transcriptsHome(state.project, projectsHome), panel, ...verifyOptions });
    return [...checks, ...verified];
  } catch (e) {
    return [...checks, result('verification', false, `verification crashed: ${e.message}`)];
  }
}

export async function executeAll({ ws, cap, budgets, bin, children, sinceMs, startedAt, projectsHome = PROJECTS_HOME, log = console.log, verifyOptions = {} }) {
  const states = ws.projects.map((project) => ({ project, map: null, run: null }));
  const common = { bin, ws, children };
  let aborted = null;

  log(`phase 1: building the Lantern map in ${states.length} project(s), in parallel`);
  await runPhase(states, { ...common, key: 'map', prompt: mapPrompt, budgetUsd: budgets.setup, timeoutMs: MAP_TIMEOUT_MS });
  if (capExceeded(spentBy(states), cap)) aborted = `cost cap exceeded after the map builds ($${spentBy(states).toFixed(2)})`;

  const ready = states.filter((s) => sessionFailure(s.map) === null);
  if (aborted) log(`stopping: ${aborted}`);
  else {
    log(`phase 2: lantern-delegate run in ${ready.length} project(s), in parallel (spent so far $${spentBy(states).toFixed(2)})`);
    await runPhase(ready, { ...common, key: 'run', prompt: (p) => runPrompt(p.task), budgetUsd: budgets.run, timeoutMs: RUN_TIMEOUT_MS });
    if (capExceeded(spentBy(states), cap)) aborted = `cost cap exceeded ($${spentBy(states).toFixed(2)})`;
  }

  log('phase 3: checking the results');
  const panel = await bundlePanel(REPO_ROOT, ws.root);
  const projects = [];
  for (const state of states) {
    projects.push({
      name: state.project.name,
      checks: await checksFor({ state, ws, panel, sinceMs, projectsHome, verifyOptions }),
      setupCostUsd: sumCost(state.map?.results ?? []),
      runCostUsd: sumCost(state.run?.results ?? []),
      costUnknown: [state.map, state.run].some((s) => s && !s.costKnown),
    });
  }
  return buildReport({ startedAt, capUsd: cap, projects, aborted });
}
