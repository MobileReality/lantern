import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DELIVERY, storedPreference } from '../../skills/lantern-delegate/scripts/preferences.mjs';
import { REPO_ROOT } from '../e2e-delegate/workspace.mjs';
import { BASE_BRANCH, git, mapProject, parseJson, snapshotSources, SYNC_MODEL, syncCommand, validateSettled } from './fixtures.mjs';
import { areasAdd, areasSetup } from './areas-fake.mjs';
import { lanternAreasAdd, lanternAreasRetag, lanternAreasSetup } from './lantern-areas-fake.mjs';
import { vocabRetag, vocabSetup } from './vocab-fake.mjs';

export const FAKE_COST_USD = 0.05;
export const BROKEN = 'broken';
export const NO_REASON = 'no-reason';
const DELEGATE_BRANCH = 'feat/fake-rename';
const BRANCH_RECORD_NAME = 'feat__fake-rename.branch';
const REMOTE_WORKSPACE = 'e2e';
const PR_URL = /pull-requests\/(\d+)/;

const ACTIONS = [
  { name: 'areas-add', matches: (prompt) => prompt.includes('map-update step') },
  { name: 'delegate', matches: (prompt) => prompt.includes('lantern-delegate skill') },
  { name: 'sync', matches: (prompt) => prompt.includes('lantern-sync skill') },
  { name: 'retag', matches: (prompt) => prompt.includes('lantern-setup skill') && prompt.includes('Retag mode') },
  { name: 'setup', matches: (prompt) => prompt.includes('lantern-setup skill') },
];

export const actionFor = (prompt) => ACTIONS.find((a) => a.matches(prompt))?.name ?? null;

export function parseAgentArgs(argv) {
  const prompt = argv[argv.indexOf('-p') + 1] ?? '';
  const budgetAt = argv.indexOf('--max-budget-usd');
  return { prompt, budgetUsd: budgetAt === -1 ? Infinity : Number(argv[budgetAt + 1]) };
}

function settingsEnv(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.local.json'), 'utf8')).env ?? {};
  } catch {
    return {};
  }
}

function step(cwd, env, command, args) {
  const res = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${res.status}: ${(res.stderr || res.stdout).trim()}`);
  return res.stdout;
}

function setupMap(cwd, { scenario, prompt }) {
  if (vocabSetup(cwd, scenario) || areasSetup(cwd, scenario) || lanternAreasSetup(cwd, scenario)) return;
  const [first] = Object.keys(snapshotSources(cwd));
  mapProject(cwd, { skip: scenario === BROKEN ? [first] : [] });
  if (!prompt.includes('git push')) return;
  const env = settingsEnv(cwd);
  step(cwd, env, 'git', ['add', '.lantern']);
  step(cwd, env, 'git', ['commit', '-q', '-m', 'chore: add the Lantern map']);
  step(cwd, env, 'git', ['push', '-q', 'origin', BASE_BRANCH]);
}

function syncCycle(cwd, { scenario }) {
  if (scenario === BROKEN) return;
  const finishArgs = ['--base', BASE_BRANCH, '--model', SYNC_MODEL, '--json'];
  const work = parseJson(syncCommand(cwd, 'finish', finishArgs), 'finish').workList;
  if (work.length === 0) throw new Error('finish listed nothing to re-map');
  mapProject(cwd);
  if (validateSettled(cwd).status !== 0) throw new Error('validate --settled is red after the re-map');
  if (parseJson(syncCommand(cwd, 'finish', finishArgs), 'finish').workList.length !== 0) throw new Error('finish still lists files');
  git(cwd, ['add', '.lantern']);
  git(cwd, ['commit', '-q', '-m', 'chore: update the Lantern map']);
}

function delegateRun(cwd, { scenario }) {
  const env = settingsEnv(cwd);
  const run = (command, args) => step(cwd, env, command, args);
  const skills = path.join(cwd, '.claude', 'skills');
  const sync = path.join(skills, 'lantern-sync', 'scripts', 'sync.mjs');
  const prCreate = path.join(skills, 'lantern-delegate', 'scripts', 'pr-create.mjs');
  const title = 'feat: add rename to the todo list';
  run('git', ['switch', '-q', '-c', DELEGATE_BRANCH]);
  fs.appendFileSync(path.join(cwd, 'src.mjs'), 'export function rename(list, i, text) { return list.map((t, j) => (j === i ? { ...t, text } : t)); }\n');
  run('git', ['add', 'src.mjs']);
  run('git', ['commit', '-q', '-m', title]);
  const delivery = storedPreference(cwd, 'delivery') ?? DELIVERY.pr;
  syncCycle(cwd, { scenario: delivery === DELIVERY.pr ? 'good' : scenario });
  const writeRecord = (idArgs, recordFile, subject) => {
    if (scenario === BROKEN) return false;
    writeRecordInputs(cwd);
    run(process.execPath, [sync, 'pr', ...idArgs, '--base', BASE_BRANCH, '--branch', DELEGATE_BRANCH, '--reason-file', '.ai/tmp/reason.json', '--order-file', '.ai/tmp/order.json', '--flow-file', '.ai/tmp/flow.json', '--describe-file', '.ai/tmp/describe.json']);
    if (scenario === NO_REASON) dropReasons(path.join(cwd, recordFile));
    if (!subject) return true;
    run('git', ['add', recordFile]);
    run('git', ['commit', '-q', '-m', subject]);
    return true;
  };
  const pushBranch = () => run('git', ['push', '-q', 'origin', `HEAD:refs/heads/${DELEGATE_BRANCH}`]);
  if (delivery !== DELIVERY.pr) {
    if (delivery === DELIVERY.push) pushBranch();
    writeRecord([], `.lantern/local/${BRANCH_RECORD_NAME}`, null);
    return;
  }
  pushBranch();
  fs.mkdirSync(path.join(cwd, '.ai', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.ai', 'tmp', 'pr-body.md'), '## What this changes\nAdds rename.\n');
  const opened = run(process.execPath, [prCreate, '--workspace', REMOTE_WORKSPACE, '--repo', path.basename(cwd), '--target', BASE_BRANCH, '--branch', DELEGATE_BRANCH, '--title', title, '--body-file', '.ai/tmp/pr-body.md']);
  const id = opened.match(PR_URL)?.[1];
  if (!id) throw new Error(`no pull request id in: ${opened.trim()}`);
  const recorded = writeRecord([id, '--url', opened.match(/https?:\/\/\S+/)?.[0] ?? '', '--title', title], `.lantern/prs/${id}.pr`, `chore: record pull request #${id} in the Lantern map`);
  if (recorded) pushBranch();
}

function writeRecordInputs(cwd) {
  fs.mkdirSync(path.join(cwd, '.ai', 'tmp'), { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(cwd, '.ai', 'tmp', name), JSON.stringify(value));
  write('reason.json', { 'src.mjs': 'Adds the rename helper the todo list was missing' });
  write('order.json', ['src.mjs']);
  write('flow.json', [{ title: 'A user renames a todo', steps: [{ kind: 'actor', text: 'User' }, { kind: 'action', text: 'renames' }, { kind: 'subject', text: 'a todo', files: ['src.mjs'] }], below: [{ kind: 'consequence', old: 'the text stayed as typed', new: 'the text can be changed' }] }]);
  write('describe.json', { what: ['A todo can be renamed after it was created.'], before: ['The text stayed as typed.'], after: ['The text can be changed.'], verified: ['The fake agent ran the finish loop.'] });
}

function dropReasons(file) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.startsWith('#reason ')).join('\n'));
}

const HANDLERS = {
  'areas-add': (cwd, { scenario, prompt }) => lanternAreasAdd(cwd, scenario) || areasAdd(cwd, scenario, prompt),
  setup: setupMap,
  retag: (cwd, { scenario }) => lanternAreasRetag(cwd, scenario) || vocabRetag(cwd, scenario),
  sync: syncCycle,
  delegate: delegateRun,
};

export function resultLine({ costUsd, subtype = 'success', note = 'done' }) {
  return JSON.stringify({ type: 'result', subtype, is_error: subtype !== 'success', total_cost_usd: costUsd, num_turns: 1, permission_denials: [], result: note });
}

export function runFakeAgent(argv, { scenario = 'good', costUsd = FAKE_COST_USD } = {}, cwd = process.cwd(), out = (line) => console.log(line)) {
  const { prompt, budgetUsd } = parseAgentArgs(argv);
  if (costUsd > budgetUsd) {
    out(resultLine({ costUsd, subtype: 'error_max_budget_usd', note: `budget of $${budgetUsd} exceeded` }));
    return 1;
  }
  const action = actionFor(prompt);
  if (!action) {
    out(resultLine({ costUsd, subtype: 'error_during_execution', note: 'the fake agent does not know this prompt' }));
    return 1;
  }
  try {
    HANDLERS[action](cwd, { scenario, prompt });
  } catch (e) {
    out(resultLine({ costUsd, subtype: 'error_during_execution', note: e.message }));
    return 1;
  }
  out(resultLine({ costUsd }));
  return 0;
}

export function writeFakeClaude(file, config) {
  const module = path.join(REPO_ROOT, 'scripts', 'skill-test', 'fake-agent.mjs');
  const source = `#!/usr/bin/env node\nimport { runFakeAgent } from ${JSON.stringify(`file://${module}`)};\nprocess.exitCode = runFakeAgent(process.argv.slice(2), ${JSON.stringify(config)});\n`;
  fs.writeFileSync(file, source, { mode: 0o755 });
  return file;
}
