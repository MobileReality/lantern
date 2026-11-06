import fs from 'node:fs';
import path from 'node:path';
import { DELIVERY, storedPreference } from '../../skills/lantern-delegate/scripts/preferences.mjs';
import { executeAll } from '../e2e-delegate/execute.mjs';
import { PROJECTS } from '../e2e-delegate/projects.mjs';
import { planBudgets } from '../e2e-delegate/report.mjs';
import { createWorkspace, disposeWorkspace, fetchMockPrs, REPO_ROOT } from '../e2e-delegate/workspace.mjs';
import { runAgent, usd } from './agent.mjs';
import { extraSkills } from './extra-skills.mjs';
import {
  BASE_BRANCH,
  changedSources,
  commitAll,
  createTinyProject,
  git,
  installSkills,
  mapProject,
  parseJson,
  runScript,
  snapshotSources,
  SYNC_MODEL,
  syncCommand,
  TINY_CHANGE,
  validateSettled,
  writeFiles,
} from './fixtures.mjs';
import { LANTERN_AREAS } from './lantern-areas-slices.mjs';
import { SETUP_PROMPT, SYNC_PROMPT } from './prompts.mjs';
import { VOCABULARY } from './vocab-slices.mjs';

const SELFTEST = path.join(REPO_ROOT, 'skills', 'lantern-sync', 'scripts', 'selftest.mjs');
const OK = (reason, extra = {}) => ({ ...extra, ok: true, reason });
const FAIL = (reason, extra = {}) => ({ ...extra, ok: false, reason });
const lastLine = (text) => text.trim().split('\n').at(-1)?.trim() ?? '';

export { SETUP_PROMPT, SYNC_PROMPT };

function setupFixture(ctx) {
  const root = path.join(ctx.tmp, 'setup-fixture');
  createTinyProject(root);
  installSkills(root);
  ctx.fixture = { root, before: snapshotSources(root) };
  const unmapped = validateSettled(root);
  const names = Object.keys(ctx.fixture.before);
  if (unmapped.status === 0 || !unmapped.stdout.includes('unmapped')) return FAIL(`the fresh fixture should fail validate --settled as unmapped, got exit ${unmapped.status}`);
  return OK(`${names.length} files to map, validate --settled is red before the agent runs`);
}

async function setupMap(ctx) {
  const { root, before } = ctx.fixture;
  const agent = await runAgent(ctx, { name: 'setup-map', cwd: root, prompt: SETUP_PROMPT });
  if (!agent.ok) return agent;
  const settled = validateSettled(root);
  if (settled.status !== 0 || !/^OK$/m.test(settled.stdout)) return FAIL(`validate --settled exit ${settled.status}: ${(lastLine(settled.stdout) || lastLine(settled.stderr)).slice(0, 160)}`, agent);
  const touched = changedSources(root, before);
  if (touched.length > 0) return FAIL(`source files changed: ${touched.join(', ')}`, agent);
  if (fs.readdirSync(path.join(root, '.lantern', 'map'), { recursive: true }).length === 0) return FAIL('.lantern/map is empty', agent);
  return OK(`map settled for ${Object.keys(before).length} files, no source touched`, agent);
}

function syncSelftest() {
  const res = runScript(SELFTEST, [], REPO_ROOT);
  const done = res.stdout.match(/all (\d+) assertions passed/);
  if (res.status !== 0 || !done) return FAIL(`selftest exit ${res.status}: ${res.stdout.split('\n').find((l) => l.startsWith('not ok')) ?? res.stderr.trim().slice(0, 160)}`);
  return OK(`${done[1]} assertions passed`);
}

function syncFixture(ctx) {
  const root = path.join(ctx.tmp, 'sync-fixture');
  createTinyProject(root, { repo: true });
  mapProject(root);
  commitAll(root, 'chore: add the Lantern map');
  git(root, ['switch', '-q', '-c', 'feat/fixture-change']);
  writeFiles(root, { [TINY_CHANGE.file]: TINY_CHANGE.content });
  commitAll(root, 'feat: change the greeting');
  installSkills(root);
  ctx.fixture = { root, before: snapshotSources(root) };
  const red = syncCommand(root, 'verify', ['--base', BASE_BRANCH]);
  if (red.status !== 1) return FAIL(`verify should be red on the un-updated branch, got exit ${red.status}`);
  const work = parseJson(syncCommand(root, 'finish', ['--base', BASE_BRANCH, '--model', SYNC_MODEL, '--json']), 'finish').workList;
  if (work.length !== 1 || work[0].path !== TINY_CHANGE.file) return FAIL(`finish should list exactly ${TINY_CHANGE.file}, got ${work.map((w) => w.path).join(', ') || 'nothing'}`);
  return OK(`verify is red and finish lists ${TINY_CHANGE.file} before the agent runs`);
}

async function syncCycle(ctx) {
  const { root, before } = ctx.fixture;
  const agent = await runAgent(ctx, { name: 'sync-cycle', cwd: root, prompt: SYNC_PROMPT });
  if (!agent.ok) return agent;
  const verify = syncCommand(root, 'verify', ['--base', BASE_BRANCH]);
  if (verify.status !== 0 || !/\bGREEN\b/.test(verify.stdout)) return FAIL(`verify exit ${verify.status}: ${lastLine(verify.stdout)}`, agent);
  const work = parseJson(syncCommand(root, 'finish', ['--base', BASE_BRANCH, '--model', SYNC_MODEL, '--json']), 'finish').workList;
  if (work.length > 0) return FAIL(`finish still lists ${work.map((w) => w.path).join(', ')}`, agent);
  const touched = git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
  if (touched.length === 0 || touched.some((file) => !file.startsWith('.lantern/'))) return FAIL(`the last commit must touch only .lantern/, it touched: ${touched.join(', ') || 'nothing'}`, agent);
  const sources = changedSources(root, before);
  if (sources.length > 0) return FAIL(`source files changed: ${sources.join(', ')}`, agent);
  return OK('verify is green, finish lists nothing, the map commit touches only .lantern/', agent);
}

const todoProject = () => PROJECTS.find((p) => p.name === 'todo-cli');

async function delegateRig(ctx) {
  const project = todoProject();
  ctx.ws = await createWorkspace([project], { projectsHome: ctx.projectsHome, delivery: ctx.delivery });
  ctx.cleanups.push(() => disposeWorkspace(ctx.ws, { keep: ctx.keep, projectsHome: ctx.projectsHome }));
  const [ready] = ctx.ws.projects;
  const prs = await fetchMockPrs(ctx.ws.mock.port);
  const remote = git(ready.dir, ['ls-remote', 'origin', BASE_BRANCH], { GIT_SSH_COMMAND: path.join(REPO_ROOT, 'scripts', 'e2e-delegate', 'fake-ssh.sh'), E2E_REMOTES: ctx.ws.remotesDir });
  if (!remote.startsWith(git(ready.dir, ['rev-parse', 'HEAD']).trim())) return FAIL('the fake ssh remote does not hold the fixture commit on main');
  if (prs.length !== 0) return FAIL(`the mock Bitbucket starts with ${prs.length} pull request(s), expected none`);
  if (storedPreference(ready.dir, 'delivery') !== ctx.delivery) return FAIL(`the project does not store delivery ${ctx.delivery}`);
  const settings = JSON.parse(fs.readFileSync(path.join(ready.dir, '.claude', 'settings.local.json'), 'utf8'));
  const credentialVars = Object.keys(settings.env ?? {}).filter((name) => /TOKEN|EMAIL|PASSWORD/i.test(name));
  if (credentialVars.length > 0 || fs.existsSync(path.join(ready.dir, '.ai', '.env'))) return FAIL(`the project holds a credential outside the Lantern socket (${credentialVars.join(', ') || '.ai/.env'})`);
  return OK(`${project.name} fixture (delivery ${ctx.delivery}), mock Bitbucket and fake ssh are up, no pull request yet, the account is only on the fake Lantern socket`);
}

function delegateDetail(report) {
  return report.projects.flatMap((p) => p.checks.map((c) => `${c.ok ? 'ok  ' : c.hard ? 'FAIL' : 'warn'} ${c.name}: ${c.reason}`));
}

async function delegateRun(ctx) {
  const cap = ctx.capUsd - ctx.spentUsd;
  const report = await executeAll({
    ws: ctx.ws,
    cap,
    budgets: planBudgets(cap, 1),
    bin: ctx.bin,
    children: ctx.children,
    sinceMs: Date.now(),
    startedAt: new Date().toISOString(),
    projectsHome: ctx.projectsHome,
    log: ctx.log,
    verifyOptions: { withTranscripts: ctx.live },
  });
  ctx.spentUsd += report.totalUsd;
  const detail = delegateDetail(report);
  const base = { costUsd: report.totalUsd, detail };
  if (report.overCap || report.aborted) return FAIL(report.aborted ?? `cost cap exceeded: spent ${usd(report.totalUsd)} of cap ${usd(cap)}`, { ...base, capExceeded: true });
  const [project] = report.projects;
  if (!project.passed) return FAIL(`failed checks: ${project.failed.join(', ')}`, base);
  const asked = ctx.ws.lantern.requests.length;
  if ((ctx.delivery === DELIVERY.pr) !== asked > 0) return FAIL(`delivery ${ctx.delivery}: the fake Lantern socket was asked for the account ${asked} time(s), expected ${ctx.delivery === DELIVERY.pr ? 'at least once' : 'never'}`, base);
  return OK(`${project.checks.length} checks passed on ${project.name} (delivery ${ctx.delivery}, ${asked} account request(s) on the Lantern socket)`, base);
}

export const SKILLS = {
  'lantern-setup': {
    defaultCapUsd: 1,
    summary: 'maps a 2-file fixture and validates the map settled',
    slices: [
      { name: 'fixture-unmapped', paid: false, doc: 'the fresh fixture fails validate --settled as unmapped (the check can fail)', run: setupFixture },
      { name: 'map-fixture', paid: true, doc: 'one agent call maps the fixture; validate --settled prints OK, no source file changes', run: setupMap },
    ],
  },
  'lantern-sync': {
    defaultCapUsd: 1,
    summary: 'finish/verify cycle on a fixture change, plus the skill self-test',
    slices: [
      { name: 'selftest', paid: false, doc: 'skills/lantern-sync/scripts/selftest.mjs passes every assertion', run: syncSelftest },
      { name: 'fixture-red', paid: false, doc: 'on the fixture branch verify is red and finish lists the changed file', run: syncFixture },
      { name: 'finish-verify-cycle', paid: true, doc: 'one agent call re-maps the listed file; verify is green, only .lantern/ is committed', run: syncCycle },
    ],
  },
  'lantern-vocabulary': VOCABULARY,
  'lantern-areas': LANTERN_AREAS,
  'lantern-delegate': {
    defaultCapUsd: 3,
    summary: 'one e2e project (todo-cli) instead of four: map build, delegate run, handover checks',
    slices: [
      { name: 'rig-ready', paid: false, doc: 'fixture project with the stored delivery, mock Bitbucket and fake ssh answer; the account only on a fake Lantern socket', run: delegateRig },
      { name: 'extra-skills', paid: false, doc: "each role's required-skills list is its fixed skills plus its slot, once each, and the skill-use gate goes red on a slot skill not read in full with no extra line in the brief; the skill files run the list command and name no fixed extra skill", run: extraSkills },
      { name: 'delegate-run', paid: true, doc: 'two agent calls (map build, lantern-delegate run); the e2e checks pass on the pushed branch', run: delegateRun },
    ],
  },
};

export const SKILL_NAMES = Object.keys(SKILLS);
