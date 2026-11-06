import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../../skills/lantern-setup/scripts/lib.mjs';
import { runAgent } from './agent.mjs';
import { AREAS_SLICES } from './areas-slices.mjs';
import { installSkills, snapshotSources, validateSettled } from './fixtures.mjs';
import { RETAG_PROMPT, SETUP_PROMPT } from './prompts.mjs';
import { evalTable, judgeClients, judgePlain, judgeRetag, judgeSibling, macroEval, validateStrict, warnings } from './vocab-checks.mjs';
import { createClientsProject, createPlainProject, createSiblingProject, createUntidyProject } from './vocab-fixtures.mjs';

const OK = (reason, extra = {}) => ({ ...extra, ok: true, reason });
const FAIL = (reason, extra = {}) => ({ ...extra, ok: false, reason });
const MIN_FILES = 5;
const MAX_FILES = 14;
const SIBLING_MIN_FILES = 20;
const SIBLING_MAX_FILES = 30;
const MIN_UNTIDY_WARNINGS = 3;

const FIXTURES = {
  clients: { dir: 'vocab-clients', create: createClientsProject, judge: judgeClients, prompt: SETUP_PROMPT, label: 'clients (two interchangeable clients)' },
  plain: { dir: 'vocab-plain', create: createPlainProject, judge: judgePlain, prompt: SETUP_PROMPT, label: 'plain (no channels)' },
  retag: { dir: 'vocab-retag', create: createUntidyProject, judge: judgeRetag, prompt: RETAG_PROMPT, label: 'retag (untidy map)' },
  sibling: { dir: 'vocab-sibling', create: createSiblingProject, judge: judgeSibling, prompt: RETAG_PROMPT, label: 'sibling (untagged records beside a tagged twin platform)' },
};

function prepare(ctx, key) {
  const spec = FIXTURES[key];
  const root = path.join(ctx.tmp, spec.dir);
  spec.create(root);
  installSkills(root);
  const before = snapshotSources(root);
  const fixture = { root, before, beforeEvaluation: macroEval(root), beforeState: new Map(loadMap(root).records.map((r) => [r.path, r])) };
  ctx.vocab = { ...ctx.vocab, [key]: fixture };
  return fixture;
}

function sizeProblem(fixture, min = MIN_FILES, max = MAX_FILES) {
  const count = Object.keys(fixture.before).length;
  return count < min || count > max ? `${count} mapped files, expected ${min} to ${max}` : null;
}

function judgeUnmapped(key, fixture) {
  const verdict = FIXTURES[key].judge(fixture.root, { ...fixture, evaluation: fixture.beforeEvaluation });
  return verdict.ok ? FAIL(`the judge passes the fixture before the agent ran (${verdict.reason}); the check cannot fail`) : null;
}

function clientsFixture(ctx) {
  const fixture = prepare(ctx, 'clients');
  const problem = sizeProblem(fixture, 8);
  if (problem) return FAIL(problem);
  return judgeUnmapped('clients', fixture) ?? OK(`${Object.keys(fixture.before).length} files on 2 web-kind platforms; the judge is red before the agent runs`);
}

function plainFixture(ctx) {
  const fixture = prepare(ctx, 'plain');
  const problem = sizeProblem(fixture);
  if (problem) return FAIL(problem);
  if (fs.existsSync(path.join(fixture.root, '.lantern'))) return FAIL('the plain fixture must start without a .lantern/');
  return judgeUnmapped('plain', fixture) ?? OK(`${Object.keys(fixture.before).length} files, no platforms, no outside systems; the judge is red before the agent runs`);
}

function retagFixture(ctx) {
  const fixture = prepare(ctx, 'retag');
  const problem = sizeProblem(fixture);
  if (problem) return FAIL(problem);
  const settled = validateSettled(fixture.root);
  if (settled.status !== 0) return FAIL(`the untidy map should be settled before retag, validate --settled exit ${settled.status}`);
  if (validateStrict(fixture.root).status === 0) return FAIL('validate --strict should report vocabulary errors on the untidy map');
  const noisy = warnings(fixture.beforeEvaluation);
  if (noisy.length < MIN_UNTIDY_WARNINGS) return FAIL(`macro-eval should warn at least ${MIN_UNTIDY_WARNINGS} times on the untidy map, got ${noisy.join(', ') || 'none'}`);
  return judgeUnmapped('retag', fixture) ?? OK(`settled but untidy: validate --strict is red, macro-eval warns on ${noisy.join(', ')}`);
}

function siblingFixture(ctx) {
  const fixture = prepare(ctx, 'sibling');
  const problem = sizeProblem(fixture, SIBLING_MIN_FILES, SIBLING_MAX_FILES);
  if (problem) return FAIL(problem);
  const settled = validateSettled(fixture.root);
  if (settled.status !== 0) return FAIL(`the sibling map should be settled before retag, validate --settled exit ${settled.status}`);
  const noisy = warnings(fixture.beforeEvaluation).filter((name) => name.startsWith('untagged-'));
  if (!noisy.includes('untagged-divergence')) return FAIL(`macro-eval should warn untagged-divergence on the sibling map, got ${noisy.join(', ') || 'none'}`);
  return judgeUnmapped('sibling', fixture) ?? OK(`settled, but one platform is mostly untagged beside its twin: macro-eval warns on ${noisy.join(', ')}; the judge is red before the agent runs`);
}

function runFixture(key, name) {
  return async (ctx) => {
    const spec = FIXTURES[key];
    const fixture = ctx.vocab[key];
    const agent = await runAgent(ctx, { name, cwd: fixture.root, prompt: spec.prompt });
    if (!agent.ok) return agent;
    let evaluation;
    try {
      evaluation = macroEval(fixture.root);
    } catch (e) {
      return FAIL(`macro-eval could not read the result: ${e.message}`.slice(0, 200), { costUsd: agent.costUsd });
    }
    const verdict = spec.judge(fixture.root, { ...fixture, evaluation });
    return { ...verdict, costUsd: agent.costUsd, table: evalTable(spec.label, fixture.beforeEvaluation, evaluation) };
  };
}

export const VOCABULARY = {
  defaultCapUsd: 6,
  summary: 'four small projects through setup and retag, judged on feature and outside-system vocabulary by scripts only, plus a 12-feature shop through the areas tree (write it, place a new feature, rebuild the tree when none fits, keep "To assign" when the loop fails, re-place after a merge)',
  slices: [
    { name: 'clients-fixture', paid: false, doc: 'two web-kind clients of one capability (8 mapped files, .lantern/platforms); the judge is red before the agent runs', run: clientsFixture },
    { name: 'plain-fixture', paid: false, doc: 'a 6-file single-platform library with no platforms and no outside systems; the judge is red before the agent runs', run: plainFixture },
    { name: 'retag-fixture', paid: false, doc: 'a prebuilt untidy map (vendor-named feature, a library as ext:, two spellings of one service): settled, strict red', run: retagFixture },
    { name: 'sibling-fixture', paid: false, doc: 'two same-kind platforms, one of them with 10 untagged records of 16 (28 mapped files); settled, retag not done, macro-eval warns untagged-divergence', run: siblingFixture },
    { name: 'clients-setup', paid: true, isolated: true, doc: 'one agent call runs lantern-setup; same feature ids on both clients, no platform in a feature id, one name per outside system', run: runFixture('clients', 'vocab-clients') },
    { name: 'plain-setup', paid: true, isolated: true, doc: 'one agent call runs lantern-setup; no vocabulary warning, no invented system, macro-eval passes everywhere', run: runFixture('plain', 'vocab-plain') },
    { name: 'sibling-retag-run', paid: true, isolated: true, doc: 'one agent call runs lantern-setup in Retag mode; each untagged record gets its twin\'s feature or a plumbing mark, retag is done, strict is clean', run: runFixture('sibling', 'vocab-sibling') },
    { name: 'retag-run', paid: true, isolated: true, doc: 'one agent call runs lantern-setup in Retag mode; strict is clean, records kept, macro-eval improved', run: runFixture('retag', 'vocab-retag') },
    ...AREAS_SLICES,
  ],
};
