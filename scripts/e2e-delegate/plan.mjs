import { CHECK_DOCS } from './checks.mjs';
import { extrasOf, offOf, orchestratorExtrasOf, PROJECTS } from './projects.mjs';
import { ESTIMATE_USD, planBudgets, resolveCap } from './report.mjs';

export const USAGE = `usage: pnpm run e2e:delegate -- --yes [--dry-run] [--keep] [--only name,name]
  Reruns the lantern-delegate end-to-end test on four fresh dummy projects with a mock Bitbucket,
  a fake ssh and headless Claude sessions. It spends real money, so it refuses to start without
  --yes (or E2E_YES=1). --dry-run prints the plan and exits without spawning claude.
  E2E_MAX_USD sets the cost cap in USD (default 12), CLAUDE_BIN the claude binary, --keep keeps the
  temp projects and the session transcripts, --only runs a subset of the projects.`;

export function parseArgs(argv, env) {
  const opts = { yes: env.E2E_YES === '1', dryRun: false, keep: false, only: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--only') opts.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

export function selectProjects(only) {
  if (!only) return PROJECTS;
  const unknown = only.filter((name) => !PROJECTS.some((p) => p.name === name));
  if (unknown.length > 0 || only.length === 0) throw new Error(`--only needs project names from: ${PROJECTS.map((p) => p.name).join(', ')}`);
  return PROJECTS.filter((p) => only.includes(p.name));
}

export function renderPlan({ env, projects, claudeBin }) {
  const cap = resolveCap(env);
  const budgets = planBudgets(cap, projects.length);
  const estimate = (ESTIMATE_USD * projects.length) / PROJECTS.length;
  const lines = ['lantern-delegate end-to-end test: plan', ''];
  lines.push(`claude binary: ${claudeBin}`, `projects (${projects.length}):`);
  for (const p of projects) {
    lines.push(`  ${p.name} (${p.language}): ${p.task}`);
    if (extrasOf(p).length) lines.push(`    delegate extra: ${extrasOf(p).join(', ')}`);
    if (offOf(p).length) lines.push(`    delegate off: ${offOf(p).join(', ')}`);
    if (orchestratorExtrasOf(p).length) lines.push(`    orchestrator extra: ${orchestratorExtrasOf(p).join(', ')}`);
  }
  lines.push('each session runs with an isolated HOME and extensions config; the real ~/.claude/lantern-extensions.json is fingerprinted before and after');
  lines.push('', 'per project, in parallel: 1) headless lantern-setup map build, 2) headless orchestrator running lantern-delegate');
  lines.push('checks:', ...Object.entries(CHECK_DOCS).map(([name, doc]) => `  ${name}: ${doc}`));
  lines.push('', `estimated cost: about $${estimate.toFixed(2)} (a previous full run cost about $7)`);
  lines.push(`cost cap: $${cap.toFixed(2)} (E2E_MAX_USD); per call --max-budget-usd: map $${budgets.setup.toFixed(2)}, run $${budgets.run.toFixed(2)}`);
  return { cap, budgets, text: lines.join('\n') };
}
