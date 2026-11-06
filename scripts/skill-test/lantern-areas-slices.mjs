import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from './agent.mjs';
import { areasCheck, hasAreasFile, parseTree } from './areas-checks.mjs';
import { installSkills, parseJson, runScript, SETUP_SCRIPTS, snapshotSources, validateSettled } from './fixtures.mjs';
import { judgeOverflow, judgeRetagTree, judgeSmall, judgeTreeOrFlat } from './lantern-areas-checks.mjs';
import { lanternAreasAdd, lanternAreasRetag, lanternAreasSetup } from './lantern-areas-fake.mjs';
import { FIXTURES, NEW_FEATURE } from './lantern-areas-fixtures.mjs';
import { SHOP } from './lantern-areas-specs.mjs';
import { LANTERN_AREAS_DELEGATE_PROMPT, LANTERN_AREAS_RETAG_PROMPT, LANTERN_AREAS_SETUP_PROMPT } from './prompts.mjs';
import { mapState, validateStrict } from './vocab-checks.mjs';

const OK = (reason, extra = {}) => ({ ...extra, ok: true, reason });
const FAIL = (reason, extra = {}) => ({ ...extra, ok: false, reason });
const MIN_RECORDS = 121;
const MAX_SMALL_RECORDS = 120;
const FEATURES_RANGE = [10, 14];
const PLATFORMS_RANGE = [2, 3];
const MIN_SMALL_FEATURES = 8;
const EXIT_NO_TREE = 2;

const CASES = {
  good: { judge: judgeTreeOrFlat, run: lanternAreasSetup, red: true },
  trap: { judge: judgeTreeOrFlat, run: lanternAreasSetup, red: true, badReason: /blind lookup/ },
  small: { judge: judgeSmall, run: lanternAreasSetup, red: false, badReason: /too small/ },
  retag: { judge: judgeRetagTree, run: lanternAreasRetag, red: true },
  overflow: { judge: judgeOverflow, run: lanternAreasAdd, red: true },
};

const lines = (root, rel) => fs.readFileSync(path.join(root, '.lantern', rel), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const inside = (n, [low, high]) => n >= low && n <= high;
const functionOf = (id) => SHOP.features.find((f) => f.id === id)?.fn;

function prepare(ctx, key) {
  const root = path.join(ctx.tmp, `areas-${key}`);
  FIXTURES[key](root);
  const control = `${root}-control`;
  fs.cpSync(root, control, { recursive: true });
  installSkills(root);
  const fixture = { root, control, before: snapshotSources(root), beforeState: mapState(root), beforeTree: hasAreasFile(root) ? parseTree(root) : null };
  ctx.lanternAreas = { ...ctx.lanternAreas, [key]: fixture };
  return fixture;
}

function shapeProblem(key, fixture) {
  const { root, beforeState } = fixture;
  const records = beforeState.size;
  const features = lines(root, 'features').length;
  const platforms = lines(root, 'platforms').length;
  if (key === 'small') return records > MAX_SMALL_RECORDS || features >= MIN_SMALL_FEATURES ? `${records} records and ${features} features, a small project has at most ${MAX_SMALL_RECORDS} records and fewer than ${MIN_SMALL_FEATURES} features` : null;
  if (records < MIN_RECORDS) return `${records} mapped records, the loop needs more than ${MAX_SMALL_RECORDS}`;
  if (!inside(features, FEATURES_RANGE)) return `${features} features, expected ${FEATURES_RANGE.join(' to ')}`;
  return inside(platforms, PLATFORMS_RANGE) ? null : `${platforms} platforms, expected ${PLATFORMS_RANGE.join(' to ')}`;
}

function startProblem(key, fixture) {
  const { root } = fixture;
  if (key === 'overflow') {
    if (!hasAreasFile(root)) return 'the overflow fixture must start with a tree';
    const strict = areasCheck(root);
    if (strict.status !== 0 || Object.keys(fixture.beforeTree).length !== 7) return `the starting tree must be a full seven-area tree that passes check, exit ${strict.status}`;
    return validateSettled(root).status === 0 ? `${NEW_FEATURE} files must start unmapped (validate --settled is green)` : null;
  }
  if (hasAreasFile(root)) return 'the fixture must start without .lantern/areas';
  if (areasCheck(root).status !== EXIT_NO_TREE) return 'areas.mjs check should exit 2 without a tree';
  if (validateSettled(root).status !== 0) return 'the fixture map must be settled';
  return validateStrict(root).status === 0 ? null : 'the fixture map must pass validate --strict';
}

function trapProblem(fixture) {
  const run = runScript(path.join(SETUP_SCRIPTS, 'areas.mjs'), [fixture.root, 'propose', '--json'], fixture.root);
  const { candidates } = parseJson(run, 'areas.mjs propose');
  const best = [...candidates].sort((a, b) => b.insideShare - a.insideShare)[0];
  const pure = best.groupsList.filter((g) => new Set(g.features.map(functionOf)).size === 1);
  return pure.length ? `the best coupling candidate has a group of one product function (${pure.map((g) => g.features.join('+')).join('; ')}), the trap is not misleading` : null;
}

function controlProblems(key, fixture) {
  const { judge, run, badReason } = CASES[key];
  const problems = [];
  for (const scenario of ['good', 'broken']) {
    for (const reader of [true, false]) {
      const work = `${fixture.root}-try`;
      fs.rmSync(work, { recursive: true, force: true });
      fs.cpSync(fixture.control, work, { recursive: true });
      run(work, scenario);
      const verdict = judge(work, { ...fixture, report: '', reader });
      fs.rmSync(work, { recursive: true, force: true });
      const label = `${scenario} answer, ${reader ? 'offline reader' : 'agent files'}`;
      if (scenario === 'good' && !verdict.ok) problems.push(`the judge rejects the ${label}: ${verdict.reason}`);
      if (scenario === 'broken' && verdict.ok) problems.push(`the judge accepts the ${label}`);
      if (scenario === 'broken' && !verdict.ok && badReason && !badReason.test(verdict.reason)) problems.push(`the ${label} fails for the wrong reason: ${verdict.reason}`);
    }
  }
  return problems;
}

function fixtureSlice(key, summary) {
  return (ctx) => {
    const fixture = prepare(ctx, key);
    const problem = shapeProblem(key, fixture) ?? startProblem(key, fixture) ?? (key === 'trap' ? trapProblem(fixture) : null);
    if (problem) return FAIL(problem);
    const { judge, red } = CASES[key];
    const before = judge(fixture.root, { ...fixture, report: '', reader: true });
    if (red && before.ok) return FAIL(`the judge passes the fixture before the agent ran (${before.reason}); the check cannot fail`);
    if (!red && !before.ok) return FAIL(`the judge fails the untouched small project: ${before.reason}`);
    const problems = controlProblems(key, fixture);
    if (problems.length) return FAIL(problems[0], { detail: problems });
    return OK(`${summary(fixture)}; ${red ? `red before the agent runs (${before.reason.slice(0, 60)})` : 'green on nothing written'}; the right answer passes and the wrong one fails`);
  };
}

function runFixture(key, name, prompt) {
  return async (ctx) => {
    const fixture = ctx.lanternAreas[key];
    const agent = await runAgent(ctx, { name, cwd: fixture.root, prompt });
    if (!agent.ok) return agent;
    return { ...CASES[key].judge(fixture.root, { ...fixture, report: agent.report, reader: !ctx.live }), costUsd: agent.costUsd };
  };
}

const sized = (fixture) => `${fixture.beforeState.size} records, ${lines(fixture.root, 'features').length} features, ${lines(fixture.root, 'platforms').length} platforms, no tree`;

export const LANTERN_AREAS = {
  defaultCapUsd: 12,
  summary: 'five neutral shop and studio projects through the areas loop (setup, a misleading-coupling trap, a small project, retag, a delegate whose feature fits no area), judged by scripts only: validate --settled --strict, areas.mjs check, the blind lookup and direct file comparisons',
  slices: [
    { name: 'good-fixture', paid: false, doc: '154 mapped records in 13 features on 3 platforms that fall into 6 product functions, no .lantern/areas; the judge is red before the agent runs, accepts the right tree and rejects a layered one', run: fixtureSlice('good', sized) },
    { name: 'trap-fixture', paid: false, doc: 'the same shop with coupling that crosses product functions: the best propose candidate mixes them, the misleading tree passes check but fails the blind lookup, the right tree passes both', run: fixtureSlice('trap', sized) },
    { name: 'small-fixture', paid: false, doc: 'six features and 50 records; the loop must write nothing, the judge fails any tree written for it', run: fixtureSlice('small', sized) },
    { name: 'retag-fixture', paid: false, doc: 'a 152-record studio map with 12 features and no .lantern/areas, tidy for Retag mode; the judge is red before the agent runs, accepts the right tree and rejects a layered one', run: fixtureSlice('retag', sized) },
    { name: 'overflow-fixture', paid: false, doc: 'a full seven-area tree and one new feature (staff-rota, 5 unmapped files) that fits no area; validate --settled is red before the agent runs, the judge accepts a rebuilt tree and rejects an eighth area', run: fixtureSlice('overflow', (f) => `${f.beforeState.size} records, a seven-area tree that passes check`) },
    { name: 'good-setup', paid: true, isolated: true, doc: 'one agent call runs lantern-setup on the good shop; a tree that passes check and the blind lookup (packets and answers kept in .ai/tmp/areas) or the flat view said in the report, never a bad tree, no record changed', run: runFixture('good', 'areas-good', LANTERN_AREAS_SETUP_PROMPT) },
    { name: 'trap-setup', paid: true, isolated: true, doc: 'one agent call runs lantern-setup where coupling points at the wrong groups; a tree that passes check and the blind lookup, or the flat view, never the misleading tree', run: runFixture('trap', 'areas-trap', LANTERN_AREAS_SETUP_PROMPT) },
    { name: 'small-setup', paid: true, isolated: true, doc: 'one agent call runs lantern-setup on the small project; no .lantern/areas, no areas text, the map untouched', run: runFixture('small', 'areas-small', LANTERN_AREAS_SETUP_PROMPT) },
    { name: 'retag-run', paid: true, isolated: true, doc: 'one agent call runs lantern-setup in Retag mode on the old map; a valid tree (check and lookup) or the flat view, records kept, retag done, strict clean', run: runFixture('retag', 'areas-retag', LANTERN_AREAS_RETAG_PROMPT) },
    { name: 'overflow-delegate', paid: true, isolated: true, doc: 'one agent call follows the delegate map-update step for a feature that fits no area; staff-rota is mapped and placed in a rebuilt tree that passes strict check and the lookup, or sits under "To assign" with the old tree intact', run: runFixture('overflow', 'areas-overflow', LANTERN_AREAS_DELEGATE_PROMPT) },
  ],
};
