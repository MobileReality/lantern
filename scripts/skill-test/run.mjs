#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DELIVERY } from '../../skills/lantern-delegate/scripts/preferences.mjs';
import { stopChild } from '../e2e-delegate/child.mjs';
import { PROJECTS_HOME } from '../e2e-delegate/execute.mjs';
import { AGENT_TIMEOUT_MS, usd } from './agent.mjs';
import { BROKEN, FAKE_COST_USD, NO_REASON, writeFakeClaude } from './fake-agent.mjs';
import { buildReport, exitCodeFor, renderReport } from './report.mjs';
import { SKILL_NAMES, SKILLS } from './slices.mjs';

export const USAGE = `usage: pnpm run skill-test -- <${SKILL_NAMES.join('|')}> [--live] [--max-usd N] [--dry-run] [--keep] [--json]
  Checks one skill on a small fixture project in cheap slices, prints PASS/FAIL per slice and exits 0 or 1.
  Default: offline. A fake agent stands in for claude, nothing is spent and no network is used.
  --live       run real headless claude sessions (spends real usage); the cap is printed first
  --max-usd N  cost cap for the whole run in USD (or SKILL_TEST_MAX_USD); the default depends on the skill.
               Each claude call gets --max-budget-usd with what is left of the cap; spending past it is a FAIL.
  --dry-run    print the plan and the cap, then exit without creating a fixture
  --keep       keep the temp fixture and logs
  --json       print the report as JSON instead of text
  --delivery D lantern-delegate only: the project's stored PR delivery, pr (default), push or local; the checks follow it
  Offline only: --fake broken (the fake agent leaves the fixture broken), --fake no-reason (the fake delegate's record lacks its reasons), --fake-cost N (USD the fake reports per call, default ${FAKE_COST_USD}).
  CLAUDE_BIN names the claude binary for --live.`;

export function parseArgs(argv, env) {
  const opts = { skill: null, live: false, maxUsd: null, dryRun: false, keep: false, json: false, help: false, fake: 'good', fakeCost: FAKE_COST_USD, delivery: DELIVERY.pr };
  const need = (i, flag) => {
    if (argv[i + 1] === undefined) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--live') opts.live = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--max-usd') opts.maxUsd = need(i++, arg);
    else if (arg === '--fake') opts.fake = need(i++, arg);
    else if (arg === '--fake-cost') opts.fakeCost = Number(need(i++, arg));
    else if (arg === '--delivery') opts.delivery = need(i++, arg);
    else if (arg.startsWith('-')) throw new Error(`unknown argument ${arg}`);
    else if (opts.skill) throw new Error(`one skill at a time, got "${opts.skill}" and "${arg}"`);
    else opts.skill = arg;
  }
  if (opts.help) return opts;
  if (!SKILL_NAMES.includes(opts.skill)) throw new Error(`skill must be one of: ${SKILL_NAMES.join(', ')}`);
  if (!['good', BROKEN, NO_REASON].includes(opts.fake)) throw new Error(`--fake must be good, ${BROKEN} or ${NO_REASON}`);
  if (!Object.values(DELIVERY).includes(opts.delivery)) throw new Error(`--delivery must be one of: ${Object.values(DELIVERY).join(', ')}`);
  if (!Number.isFinite(opts.fakeCost) || opts.fakeCost < 0) throw new Error('--fake-cost must be a number of USD, 0 or more');
  if (opts.live && (opts.fake !== 'good' || argv.includes('--fake-cost'))) throw new Error('--fake and --fake-cost are for the offline mode only');
  opts.capUsd = resolveCap(opts.maxUsd ?? env.SKILL_TEST_MAX_USD, SKILLS[opts.skill].defaultCapUsd);
  return opts;
}

export function resolveCap(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error(`the cost cap must be a positive number of USD, got "${raw}"`);
  return cap;
}

export function renderPlan(opts, claudeBin) {
  const def = SKILLS[opts.skill];
  const lines = [`skill-test ${opts.skill}: plan`, '', `what: ${def.summary}`, `mode: ${opts.live ? 'LIVE, real headless claude sessions that spend usage' : `offline, fake agent (${opts.fake}), no network, nothing is spent`}`];
  if (opts.live) lines.push(`claude binary: ${claudeBin}`);
  if (opts.skill === 'lantern-delegate') lines.push(`delivery: ${opts.delivery} (stored as the project's PR delivery choice)`);
  lines.push('slices:');
  for (const s of def.slices) lines.push(`  ${s.name} [${s.paid ? (opts.live ? 'agent, paid' : 'agent, fake') : 'free'}]: ${s.doc}`);
  lines.push('', `cost cap: ${usd(opts.capUsd)} for the whole run${opts.live ? '' : ` (the fake agent reports ${usd(opts.fakeCost)} per call)`}`);
  lines.push(`each claude call gets --max-budget-usd with what is left of the cap, and a ${AGENT_TIMEOUT_MS / 60000} minute timeout; spending past the cap fails the run`);
  return lines.join('\n');
}

async function runSlices(def, ctx) {
  const results = [];
  let stopped = null;
  for (const slice of def.slices) {
    if (stopped) {
      results.push({ name: slice.name, ok: false, skipped: true, reason: `not run: ${stopped}` });
      continue;
    }
    const before = ctx.spentUsd;
    let outcome;
    try {
      outcome = await slice.run(ctx);
    } catch (e) {
      outcome = { ok: false, reason: `crashed: ${e.message}` };
    }
    results.push({ name: slice.name, costUsd: outcome.costUsd ?? ctx.spentUsd - before, ...outcome });
    if (!outcome.ok && !(slice.isolated && !outcome.capExceeded)) stopped = `${slice.name} failed`;
  }
  return results;
}

export async function runSkill(opts, { bin, log = console.log, projectsHome } = {}) {
  const def = SKILLS[opts.skill];
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lantern-skill-test-'));
  const logsDir = path.join(tmp, 'logs');
  fs.mkdirSync(logsDir);
  const children = new Set();
  const cleanups = [];
  const cleanup = async () => {
    for (const child of children) stopChild(child);
    for (const fn of cleanups) await fn();
    if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true });
    else log(`kept ${tmp}`);
  };
  const onSignal = () => {
    cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const agentBin = opts.live ? bin : writeFakeClaude(path.join(tmp, 'fake-claude'), { scenario: opts.fake, costUsd: opts.fakeCost });
    const ctx = {
      tmp,
      logsDir,
      children,
      cleanups,
      bin: agentBin,
      live: opts.live,
      keep: opts.keep,
      capUsd: opts.capUsd,
      spentUsd: 0,
      delivery: opts.delivery,
      log,
      projectsHome: opts.live ? (projectsHome ?? PROJECTS_HOME) : path.join(tmp, 'claude-home'),
    };
    const slices = await runSlices(def, ctx);
    return buildReport({ skill: opts.skill, mode: opts.live ? 'live' : `offline, fake agent ${opts.fake}`, capUsd: opts.capUsd, slices, spentUsd: ctx.spentUsd });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup();
  }
}

function printReport(report, opts, log) {
  if (opts.json) return log(JSON.stringify(report));
  log(renderReport(report));
  for (const s of report.slices.filter((x) => x.table)) log(`\n${s.name} ${s.table.join('\n')}`);
  for (const s of report.slices.filter((x) => !x.ok && !x.skipped && x.detail)) log(`\n${s.name} checks:\n${s.detail.map((l) => `  ${l}`).join('\n')}`);
}

export async function main(argv, env, { log = console.log, err = console.error } = {}) {
  let opts;
  const bin = env.CLAUDE_BIN || 'claude';
  try {
    opts = parseArgs(argv, env);
    if (opts.help) {
      log(USAGE);
      return 0;
    }
  } catch (e) {
    err(`${e.message}\n${USAGE}`);
    return 2;
  }
  (opts.json ? err : log)(renderPlan(opts, bin));
  if (opts.dryRun) {
    if (!opts.json) log('\ndry run: no fixture was created, no claude session was started, nothing was spent');
    return 0;
  }
  if (opts.live) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      err(`cannot run "${bin} --version": ${probe.error?.message ?? probe.stderr}`);
      return 2;
    }
  }
  if (!opts.json) log('');
  const report = await runSkill(opts, { bin, log: opts.json ? () => {} : log });
  printReport(report, opts, log);
  return exitCodeFor(report);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invoked) process.exitCode = await main(process.argv.slice(2), process.env);
