#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stopChild } from './child.mjs';
import { executeAll, PROJECTS_HOME } from './execute.mjs';
import { parseArgs, renderPlan, selectProjects, USAGE } from './plan.mjs';
import { extensionsPath } from '../../skills/lantern-delegate/scripts/extensions.mjs';
import { exitCodeFor, fingerprintFile, renderReport, withConfigGuard } from './report.mjs';
import { createWorkspace, disposeWorkspace, REPO_ROOT } from './workspace.mjs';

export const REPORT_FILE = path.join(REPO_ROOT, '.ai', 'tmp', 'e2e-delegate-report.json');

export async function runLive({ opts, projects, bin, plan, workspaceOptions = {} }) {
  const startedAt = new Date().toISOString();
  const sinceMs = Date.now();
  const children = new Set();
  const holder = {};
  const projectsHome = workspaceOptions.projectsHome ?? PROJECTS_HOME;
  const cleanup = () => {
    for (const child of children) stopChild(child);
    if (!holder.ws) return;
    const removed = disposeWorkspace(holder.ws, { keep: opts.keep, projectsHome });
    console.log(opts.keep ? `kept ${holder.ws.root}` : `removed ${holder.ws.root} and ${removed.length} transcript folder(s)`);
  };
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const configFile = extensionsPath(workspaceOptions.realHome);
    const configBefore = fingerprintFile(configFile);
    const ws = await createWorkspace(projects, { ...workspaceOptions, holder });
    console.log(`\nworkspace ${ws.root}, mock Bitbucket on port ${ws.mock.port}`);
    const executed = await executeAll({ ws, cap: plan.cap, budgets: plan.budgets, bin, children, sinceMs, startedAt, projectsHome });
    const report = withConfigGuard(executed, { file: configFile, before: configBefore, after: fingerprintFile(configFile) });
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n${renderReport(report)}\n\nreport: ${REPORT_FILE}`);
    return exitCodeFor(report);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    cleanup();
  }
}

export async function main(argv, env) {
  let opts;
  let projects;
  let plan;
  const bin = env.CLAUDE_BIN || 'claude';
  try {
    opts = parseArgs(argv, env);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    projects = selectProjects(opts.only);
    plan = renderPlan({ env, projects, claudeBin: bin });
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
  console.log(plan.text);
  if (opts.dryRun) {
    console.log('\ndry run: no claude session was started, nothing was spent');
    return 0;
  }
  if (!opts.yes) {
    console.error('\nrefusing to start: this spends real money. Pass --yes (or E2E_YES=1) to run it.');
    return 2;
  }
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    console.error(`cannot run "${bin} --version": ${probe.error?.message ?? probe.stderr}`);
    return 2;
  }
  return runLive({ opts, projects, bin, plan });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invoked) process.exitCode = await main(process.argv.slice(2), process.env);
