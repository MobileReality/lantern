import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../../skills/lantern-setup/scripts/lib.mjs';
import { namesId } from '../../skills/lantern-setup/scripts/vocabulary.mjs';
import { changedSources, parseJson, runScript, SETUP_SCRIPTS, validateSettled } from './fixtures.mjs';
import { CLIENTS_CAPABILITIES, CLIENTS_PLATFORM_IDS, CLIENTS_PLATFORMS, SIBLING_PLUMBING, SIBLING_TWINS } from './vocab-fixtures.mjs';

const OK = (reason) => ({ ok: true, reason });
const FAIL = (reason, offenders = []) => ({ ok: false, reason: offenders.length ? `${reason}: ${offenders.join(', ')}` : reason });
const setupScript = (name, root, args = []) => runScript(path.join(SETUP_SCRIPTS, name), [root, ...args], root);
const lastLine = (text) => text.trim().split('\n').at(-1)?.trim() ?? '';
const unique = (list) => [...new Set(list)].sort();

export const macroEval = (root) => parseJson(setupScript('macro-eval.mjs', root, ['--json']), 'macro-eval');
export const validateStrict = (root) => setupScript('validate.mjs', root, ['--settled', '--strict']);
export const systemsCheck = (root) => setupScript('systems.mjs', root, ['check']);
export const retagPlan = (root) => setupScript('plan.mjs', root, ['retag']);
export const warnings = (evaluation) => evaluation.checks.filter((c) => c.status === 'WARN').map((c) => c.name);

export function vocabularyOffenders(evaluation) {
  const { collisions, nearDuplicates, libraryLike, unlisted } = evaluation.systems;
  return unique([...collisions.map((c) => c.id), ...nearDuplicates.flatMap((g) => g.ids), ...libraryLike, ...unlisted]);
}

export function evalTable(title, before, after) {
  const names = unique([...before.checks, ...after.checks].map((c) => c.name));
  const cell = (evaluation, name) => {
    const found = evaluation.checks.find((c) => c.name === name);
    return found ? `${found.status} ${found.value}` : '-';
  };
  const width = Math.max(...names.map((n) => n.length), 5);
  return [`macro-eval ${title}`, `  ${'check'.padEnd(width)}  before -> after`, ...names.map((n) => `  ${n.padEnd(width)}  ${cell(before, n)} -> ${cell(after, n)}`), `  warnings: ${warnings(before).length} -> ${warnings(after).length}`];
}

export function mapState(root) {
  const { records } = loadMap(root);
  return new Map(records.map((r) => [r.path, r]));
}

const externalsOf = (record) => unique(record.relations.filter((rel) => rel.external).map((rel) => rel.external));

function untouched(root, before) {
  const touched = changedSources(root, before);
  return touched.length ? FAIL('source files changed', touched) : null;
}

function settledAndStrict(root, evaluation) {
  const settled = validateSettled(root);
  if (settled.status !== 0 || !/^OK$/m.test(settled.stdout)) return FAIL(`validate --settled exit ${settled.status}: ${lastLine(settled.stdout) || lastLine(settled.stderr)}`.slice(0, 200));
  const strict = validateStrict(root);
  if (strict.status === 0) return null;
  const count = strict.stdout.split('\n').filter((l) => l.includes('[vocabulary]')).length;
  return FAIL(`validate --strict reports ${count} vocabulary error(s), offending ids`, vocabularyOffenders(evaluation));
}

function featureIdsNamingAPlatform(records, platformIds) {
  const used = unique(records.map((r) => r.feature).filter(Boolean));
  return used.filter((id) => platformIds.some((platform) => namesId(id, platform)));
}

function capabilityProblems(state) {
  const problems = [];
  for (const { name, files } of CLIENTS_CAPABILITIES) {
    const tags = files.map((file) => state.get(file)?.feature ?? null);
    if (tags.some((t) => t === null)) problems.push(`${name}: untagged (${files.map((f, i) => `${f}=${tags[i] ?? 'none'}`).join(', ')})`);
    else if (new Set(tags).size > 1) problems.push(`${name}: ${files.map((f, i) => `${f}=${tags[i]}`).join(', ')}`);
  }
  return problems;
}

function sharedSystemProblems(state) {
  const exporters = CLIENTS_CAPABILITIES.find((c) => c.name === 'exporting notes').files;
  const sets = exporters.map((file) => externalsOf(state.get(file)).join('+'));
  if (sets.some((s) => s === '')) return [`an export file names no outside system (${exporters.map((f, i) => `${f}=${sets[i] || 'none'}`).join(', ')})`];
  return new Set(sets).size > 1 ? [`the export clients name the relay differently (${sets.join(' vs ')})`] : [];
}

export function judgeClients(root, { before, evaluation }) {
  const stray = untouched(root, before);
  if (stray) return stray;
  if (fs.readFileSync(path.join(root, '.lantern', 'platforms'), 'utf8') !== CLIENTS_PLATFORMS) return FAIL('.lantern/platforms was edited');
  const bad = settledAndStrict(root, evaluation);
  if (bad) return bad;
  const state = mapState(root);
  const named = featureIdsNamingAPlatform([...state.values()], CLIENTS_PLATFORM_IDS);
  if (named.length) return FAIL('feature ids that equal or contain a platform id', named);
  const split = capabilityProblems(state);
  if (split.length) return FAIL('a capability carries different feature ids on the two clients', split);
  const capabilityIds = new Set(CLIENTS_CAPABILITIES.flatMap((c) => c.files.map((f) => state.get(f).feature)));
  const oneSided = evaluation.divergence.flatMap((g) => g.only).filter((o) => capabilityIds.has(o.feature)).map((o) => `${o.feature} only on ${o.platform}`);
  if (oneSided.length) return FAIL('macro-eval divergence: shared capability used by one client only', oneSided);
  const spelled = sharedSystemProblems(state);
  if (spelled.length) return FAIL('outside system is not canonical', spelled);
  const listed = systemsCheck(root);
  if (listed.status !== 0) return FAIL(`systems.mjs check exit ${listed.status}`, listed.stdout.split('\n').filter((l) => l.startsWith('problem:')).map((l) => l.slice(9, 100)));
  const warned = warnings(evaluation).filter((name) => /^(feature-divergence|feature-collisions|system-)/.test(name));
  if (warned.length) return FAIL('macro-eval warns', [...warned, ...vocabularyOffenders(evaluation)]);
  return OK(`same feature ids on both clients (${[...capabilityIds].sort().join(', ')}), the relay has one name, no platform in any feature id`);
}

export function judgePlain(root, { before, evaluation }) {
  const stray = untouched(root, before);
  if (stray) return stray;
  if (fs.existsSync(path.join(root, '.lantern', 'platforms'))) return FAIL('.lantern/platforms was invented for a single-platform project');
  const bad = settledAndStrict(root, evaluation);
  if (bad) return bad;
  const invented = unique([...mapState(root).values()].flatMap(externalsOf));
  const listed = setupScript('systems.mjs', root, ['list']).stdout.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'no .lantern/systems');
  if (invented.length || listed.length) return FAIL('outside systems invented in a project with none', unique([...invented, ...listed.map((l) => l.split(' | ')[0])]));
  const warned = warnings(evaluation);
  if (warned.length) return FAIL('macro-eval does not pass everywhere', warned);
  return OK(`no vocabulary warnings, no outside systems, macro-eval passes all ${evaluation.checks.length} checks`);
}

const headLines = (state) => [...state.values()].map((r) => `${r.path} ${r.marker} ${r.role} ${r.hash}`).sort();
const plainRelations = (record) => record.relations.filter((rel) => !rel.external).map((rel) => `${rel.arrow} ${rel.token}`);

export function recordDrift(beforeState, afterState) {
  const drift = [];
  const head = (state) => new Map(headLines(state).map((line) => [line.split(' ')[0], line]));
  const [was, now] = [head(beforeState), head(afterState)];
  for (const [file, line] of was) if (now.get(file) !== line) drift.push(`${file}: record line changed`);
  for (const file of now.keys()) if (!was.has(file)) drift.push(`${file}: new record`);
  for (const [file, record] of beforeState) {
    const after = afterState.get(file);
    if (after && plainRelations(record).join('|') !== plainRelations(after).join('|')) drift.push(`${file}: a relation to a file changed`);
    if (after && JSON.stringify([record.gotcha, record.seeAlso]) !== JSON.stringify([after.gotcha, after.seeAlso])) drift.push(`${file}: gotcha or see-also changed`);
  }
  return drift;
}

function siblingProblems(state) {
  const problems = [];
  for (const { counter, shelf, feature } of SIBLING_TWINS) {
    const got = state.get(counter)?.feature ?? null;
    const want = state.get(shelf)?.feature ?? feature;
    if (got !== want) problems.push(`${counter}=${got ?? 'none'} (its twin ${shelf} is ${want})`);
  }
  for (const file of SIBLING_PLUMBING) {
    const record = state.get(file);
    if (record?.feature) problems.push(`${file} is plumbing but tagged ${record.feature}`);
    else if (!record?.plumbing) problems.push(`${file} was not marked plumbing`);
  }
  return problems;
}

export function judgeSibling(root, { before, evaluation, beforeState }) {
  const stray = untouched(root, before);
  if (stray) return stray;
  const bad = settledAndStrict(root, evaluation);
  if (bad) return bad;
  const state = mapState(root);
  const drift = recordDrift(beforeState, state);
  if (drift.length) return FAIL('records changed beyond tag and plumbing mark', drift);
  const plan = retagPlan(root);
  if (!/^RETAG DONE$/m.test(plan.stdout)) return FAIL(`plan.mjs . retag is not done: ${lastLine(plan.stdout)}`);
  const unresolved = siblingProblems(state);
  if (unresolved.length) return FAIL('untagged records of the counter platform were not resolved like their twins', unresolved);
  const warned = warnings(evaluation).filter((name) => name.startsWith('untagged-'));
  if (warned.length) return FAIL('macro-eval still warns', warned);
  return OK(`the counter's untagged records carry their twins' features or a plumbing mark, retag is done, macro-eval has no untagged warning`);
}

export function judgeRetag(root, { before, evaluation, beforeEvaluation, beforeState }) {
  const stray = untouched(root, before);
  if (stray) return stray;
  const bad = settledAndStrict(root, evaluation);
  if (bad) return bad;
  const state = mapState(root);
  const features = unique([...state.values()].map((r) => r.feature).filter(Boolean));
  const systems = unique([...state.values()].flatMap(externalsOf));
  const left = [...features.filter((f) => f === 'acmepay'), ...systems.filter((s) => s === 'dayjs.js')];
  const dupes = evaluation.systems.nearDuplicates.flatMap((g) => g.ids);
  if (left.length || dupes.length) return FAIL('the untidy names survived', unique([...left, ...dupes]));
  const drift = recordDrift(beforeState, state);
  if (drift.length) return FAIL('records changed beyond tag and target text', drift);
  const listed = systemsCheck(root);
  if (listed.status !== 0) return FAIL(`systems.mjs check exit ${listed.status}`, listed.stdout.split('\n').filter((l) => l.startsWith('problem:')).map((l) => l.slice(9, 100)));
  const plan = retagPlan(root);
  if (!/^RETAG DONE$/m.test(plan.stdout)) return FAIL(`plan.mjs . retag is not done: ${lastLine(plan.stdout)}`);
  const [was, now] = [warnings(beforeEvaluation), warnings(evaluation)];
  if (now.length >= was.length || now.length > 0) return FAIL(`macro-eval did not improve to clean (${was.length} -> ${now.length} warnings)`, now);
  return OK(`strict is clean, records kept, macro-eval warnings ${was.length} -> ${now.length} (features now: ${features.join(', ')})`);
}
