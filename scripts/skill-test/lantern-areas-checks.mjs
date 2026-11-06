import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { areasCheck, hasAreasFile, parseTree } from './areas-checks.mjs';
import { changedSources, validateSettled } from './fixtures.mjs';
import { ANSWERS_NAME, findFiles, MANIFEST } from './lantern-areas-find.mjs';
import { NEW_FEATURE, SCRATCH_DIR } from './lantern-areas-fixtures.mjs';
import { scoreAnswersFor, standInAnswers, writePacketsFor } from './lantern-areas-reader.mjs';
import { mapState, recordDrift, retagPlan, validateStrict } from './vocab-checks.mjs';

const OK = (reason) => ({ ok: true, reason });
const FAIL = (reason, offenders = []) => ({ ok: false, reason: offenders.length ? `${reason}: ${offenders.join('; ')}` : reason });
const MAX_LINES = 4;
const FLAT_VIEW = /flat view/i;

const lines = (text, prefix) => text.split('\n').filter((l) => l.trimStart().startsWith(prefix)).map((l) => l.trim().slice(0, 140)).slice(0, MAX_LINES);
const indented = (text) => text.split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim().slice(0, 140)).slice(0, MAX_LINES);
const tagged = (text) => text.split('\n').filter((l) => /\[(areas|vocabulary)\]/.test(l)).map((l) => l.trim().slice(0, 160)).slice(0, MAX_LINES);
const afterFail = (text) => indented(text.slice(Math.max(text.indexOf('FAIL'), 0)));
const areasJson = (root) => path.join(root, '.lantern', 'lang', 'en', 'areas.json');
const readText = (file) => fs.readFileSync(file, 'utf8');

const ERROR_WORDS = /error|at most|at least|must/;
const settledReasons = (stdout) => [...new Set([...tagged(stdout).filter((l) => ERROR_WORDS.test(l)), ...afterFail(stdout)])].slice(0, MAX_LINES);

function validity(root) {
  const settled = validateSettled(root);
  if (settled.status !== 0 || !/^OK$/m.test(settled.stdout)) return FAIL(`validate --settled exit ${settled.status}`, settledReasons(settled.stdout));
  const strict = validateStrict(root);
  return strict.status === 0 ? null : FAIL(`validate --settled --strict exit ${strict.status}`, tagged(strict.stdout));
}

function featureDrift(beforeState, afterState) {
  return [...beforeState].filter(([file, record]) => afterState.get(file) && afterState.get(file).feature !== record.feature).map(([file, record]) => `${file}: ${record.feature ?? 'none'} -> ${afterState.get(file).feature ?? 'none'}`);
}

function untouched(root, ctx) {
  const stray = changedSources(root, ctx.before);
  if (stray.length) return FAIL('source files changed', stray);
  const state = mapState(root);
  const drift = recordDrift(ctx.beforeState, state).filter((d) => !(ctx.allowNew && d.endsWith(': new record')));
  if (drift.length) return FAIL('records changed beyond the allowed lines', drift.slice(0, MAX_LINES));
  const moved = ctx.allowFeatureChange ? [] : featureDrift(ctx.beforeState, state);
  return moved.length ? FAIL('feature tags changed', moved.slice(0, MAX_LINES)) : null;
}

function packetsMatch(manifest, fresh) {
  const dir = path.dirname(manifest);
  try {
    const listed = Object.keys(JSON.parse(readText(manifest)));
    const stale = listed.filter((name) => !fs.existsSync(path.join(dir, name)) || readText(path.join(dir, name)) !== readText(path.join(fresh, name)));
    return !stale.length && readText(path.join(fresh, MANIFEST)) === readText(manifest);
  } catch {
    return false;
  }
}

function answersFor(manifest) {
  const beside = path.join(path.dirname(manifest), ANSWERS_NAME);
  return fs.existsSync(beside) ? beside : null;
}

function agentLookup(root, fresh) {
  const scratch = path.join(root, SCRATCH_DIR);
  const manifests = findFiles(scratch, MANIFEST);
  if (!manifests.length) return { problem: `no lookup packets under ${SCRATCH_DIR}, the blind lookup was not run` };
  const manifest = manifests.find((m) => packetsMatch(m, fresh));
  if (!manifest) return { problem: `the packets under ${SCRATCH_DIR} do not match the final tree, the lookup ran on an earlier one` };
  const answers = answersFor(manifest);
  if (!answers) return { problem: `no ${ANSWERS_NAME} beside ${path.relative(root, manifest)}, the readers' answers were not kept` };
  return { answers };
}

export function lookupEvidence(root, { reader }) {
  const fresh = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'areas-judge-'));
  try {
    const packets = writePacketsFor(root, fresh);
    if (packets.status !== 0) return FAIL(`lookup packets exit ${packets.status}`, indented(packets.stdout + packets.stderr));
    const found = reader ? { answers: path.join(fresh, 'standin-answers.json') } : agentLookup(root, fresh);
    if (found.problem) return FAIL(found.problem);
    if (reader) fs.writeFileSync(found.answers, JSON.stringify(standInAnswers(fresh)));
    const score = scoreAnswersFor(root, found.answers);
    const head = score.stdout.split('\n')[0];
    const answers = JSON.parse(readText(found.answers));
    return score.status === 0 ? { ...OK(head), answers } : FAIL(`lookup score exit ${score.status}: ${head}`, lines(score.stdout, 'revise'));
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }
}

function treeVerdict(root, ctx) {
  const check = areasCheck(root);
  if (check.status !== 0) return FAIL(`areas.mjs check exit ${check.status}, the tree is written but does not pass`, lines(check.stdout, '- '));
  const lookup = lookupEvidence(root, ctx);
  if (!lookup.ok) return FAIL(`the tree passes check but not the blind lookup (${lookup.reason})`);
  return OK(`a tree of ${Object.keys(parseTree(root)).length} areas passes areas.mjs check and the blind lookup (${lookup.reason})`);
}

function leftovers(root) {
  return hasAreasFile(root) ? null : fs.existsSync(areasJson(root)) ? FAIL('lang/en/areas.json was left without a .lantern/areas') : null;
}

export function judgeTreeOrFlat(root, ctx) {
  const bad = untouched(root, ctx) ?? validity(root) ?? leftovers(root);
  if (bad) return bad;
  if (hasAreasFile(root)) return treeVerdict(root, ctx);
  if (FLAT_VIEW.test(ctx.report ?? '')) return OK('no tree: the agent kept the flat view and said so');
  return FAIL('no .lantern/areas and the report does not say the flat view was kept');
}

export function judgeRetagTree(root, ctx) {
  const verdict = judgeTreeOrFlat(root, { ...ctx, allowFeatureChange: true });
  if (!verdict.ok) return verdict;
  const plan = retagPlan(root);
  return /^RETAG DONE$/m.test(plan.stdout) ? verdict : FAIL(`plan.mjs . retag is not done: ${plan.stdout.trim().split('\n').at(-1)}`);
}

export function judgeSmall(root, ctx) {
  const bad = untouched(root, ctx) ?? validity(root);
  if (bad) return bad;
  if (hasAreasFile(root) || fs.existsSync(areasJson(root))) return FAIL('areas were written for a project too small for them (fewer than 8 features, at most 120 records)');
  return OK('nothing written: no .lantern/areas, no areas text, the map is untouched');
}

const withoutNew = (tree) => Object.fromEntries(Object.entries(tree).map(([area, leaves]) => [area, leaves.filter((l) => l !== NEW_FEATURE)]).filter(([, leaves]) => leaves.length));
const canon = (tree) => JSON.stringify(Object.entries(tree).map(([area, leaves]) => [area, [...leaves].sort()]).sort());
const sameTree = (a, b) => canon(a) === canon(b);

export function treeLost(beforeTree, afterTree) {
  return Object.entries(beforeTree).flatMap(([area, leaves]) => (afterTree[area] ? leaves.filter((l) => !afterTree[area].includes(l)).map((l) => `${l} left ${area}`) : [`area ${area} is gone`]));
}

function unassignedVerdict(root, ctx) {
  const check = areasCheck(root, ['--allow-unassigned']);
  if (check.status !== 0) return FAIL(`areas.mjs check exit ${areasCheck(root).status} strict and ${check.status} with --allow-unassigned`, lines(check.stdout, '- '));
  if (!check.stdout.includes(`To assign: ${NEW_FEATURE}`)) return FAIL(`${NEW_FEATURE} is neither placed nor listed under "To assign"`);
  const tree = parseTree(root);
  const lost = treeLost(ctx.beforeTree, tree);
  if (lost.length || !sameTree(tree, ctx.beforeTree)) return FAIL('the feature is under "To assign" but the old tree was not left intact', lost);
  return OK(`${NEW_FEATURE} shows under "To assign" and the old tree is intact and passes check --allow-unassigned`);
}

function featureProblems(root) {
  const staff = [...mapState(root).values()].filter((r) => r.path.includes(`/${NEW_FEATURE}/`));
  if (!staff.length) return [`no record of the ${NEW_FEATURE} files`];
  return staff.filter((r) => r.feature !== NEW_FEATURE).map((r) => `${r.path} is tagged ${r.feature ?? 'none'}`);
}

export function judgeOverflow(root, ctx) {
  const bad = untouched(root, { ...ctx, allowNew: true }) ?? validity(root);
  if (bad) return bad;
  const unmapped = featureProblems(root);
  if (unmapped.length) return FAIL(`${NEW_FEATURE} was not mapped as a feature`, unmapped);
  if (!hasAreasFile(root)) return FAIL('the areas file was deleted');
  const strict = areasCheck(root);
  if (strict.status !== 0) return unassignedVerdict(root, ctx);
  const tree = parseTree(root);
  if (!Object.values(tree).flat().includes(NEW_FEATURE)) return FAIL(`${NEW_FEATURE} was not placed in an area`);
  if (sameTree(withoutNew(tree), ctx.beforeTree)) return FAIL(`${NEW_FEATURE} was put into an area of the full tree that does not fit it, with no rebuild`);
  const lookup = lookupEvidence(root, ctx);
  if (!lookup.ok) return FAIL(`the rebuilt tree passes check but not the blind lookup (${lookup.reason})`);
  const home = Object.keys(tree).find((area) => tree[area].includes(NEW_FEATURE));
  const chosen = String(lookup.answers[NEW_FEATURE] ?? '').replace(/^["'`\s]+|["'`\s.]+$/g, '').toLowerCase();
  if (chosen !== home) return FAIL(`${NEW_FEATURE} sits in ${home} but a blind reader chose ${chosen || 'nothing'}, it does not fit there`);
  return OK(`${NEW_FEATURE} sits in a rebuilt tree of ${Object.keys(tree).length} areas that passes strict areas.mjs check and the blind lookup, no "To assign"`);
}
