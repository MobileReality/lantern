#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { siblingSkill } from '../../lantern-setup/scripts/shell.mjs';
import { ITEM_STATUS } from './plan-format.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const planScript = path.join(here, 'plan.mjs');
const syncScript = path.join(siblingSkill(import.meta.url, 'lantern-sync'), 'scripts', 'sync.mjs');
const L = await import(pathToFileURL(path.join(siblingSkill(import.meta.url, 'lantern-setup'), 'scripts', 'lib.mjs')).href);

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plan-selftest-'));
const env = {
    ...process.env,
    LANTERN_LANG: 'en',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Selftest',
    GIT_AUTHOR_EMAIL: 'selftest@example.invalid',
    GIT_COMMITTER_NAME: 'Selftest',
    GIT_COMMITTER_EMAIL: 'selftest@example.invalid',
};

let failures = 0;
let count = 0;

function check(name, condition, detail = '') {
    count++;
    if (condition) console.log(`ok ${count} - ${name}`);
    else {
        failures++;
        console.log(`not ok ${count} - ${name}${detail ? `\n    ${String(detail).split('\n').join('\n    ')}` : ''}`);
    }
}

const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
const git = (...args) => {
    const result = run('git', args);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
};
const plan = (...args) => run(process.execPath, [planScript, ...args]);
const sync = (...args) => run(process.execPath, [syncScript, ...args]);
const planJson = (...args) => JSON.parse(plan(...args, '--json').stdout);
const write = (rel, text) => {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
};
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const commit = (message, ...paths) => {
    git('add', ...paths);
    git('commit', '-q', '-m', message);
};

function writeMap() {
    const hash = (rel) => L.hashFile(repo, rel);
    write('.lantern/map/src.lantern', `lantern 1\n# src\n\nsrc/a.ts . service ${hash('src/a.ts')}\n#feature core\n  = src/b.ts\nsrc/b.ts . util ${hash('src/b.ts')}\n#feature core\n`);
}

function seed() {
    git('init', '-q', '-b', 'main');
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 1;\n');
    write('.lantern/features', 'core\n');
    write('.lantern/lang/en/features.json', '{"text":{"core":"the core"}}\n');
    write('.lantern/lang/en/src.lantern.json', '{"text":{"a.ts":"entry","b.ts":"helper","a.ts = src/b.ts":"calls"}}\n');
    writeMap();
    commit('base', '.');
}

function writePlan() {
    plan('new', 'demo', '--title', 'Change b', '--goal', 'b changes.');
    const steps = [
        ['scope', 'in', 'The b file.'],
        ['scope', 'out', 'Everything else.'],
        ['impact', 'feature', 'core', 'b lives in the core.'],
        ['stage', 'Change it'],
        ['item', 's1', 'Change b', '--touch', 'file:src/b.ts', '--accept', 'b is 2.'],
        ['question', 's1', 'Keep the name?'],
        ['risk', 'None known.'],
    ];
    for (const step of steps) plan('add', 'demo', ...step);
}

function approveAll() {
    for (const section of ['title', 'goal', 'scope', 'impact', 's1', 'risks']) plan('approve', 'demo', section, '--by', 'self');
    return plan('approve', 'demo', 'plan', '--by', 'self');
}

function openPullRequest() {
    git('checkout', '-q', '-b', 'feat/change-b');
    write('src/b.ts', 'export const b = 2;\n');
    commit('change b', 'src/b.ts');
    writeMap();
    commit('chore: update the Lantern map', '.lantern');
    return sync('pr', '301', '--url', 'https://example.test/301', '--title', 'Change b', '--base', 'main', '--branch', 'feat/change-b', '--reason', 'src/b.ts=Moves b to 2.', '--plan', 'demo', '--item', 's1.1');
}

seed();
check('gate opens on a settled map', plan('gate').status === 0, plan('gate').stdout);
write('src/c.ts', 'export const c = 1;\n');
check('gate stays closed while the map is behind', plan('gate').status === 1 && /Planning needs a settled Lantern map/.test(plan('gate').stdout));
fs.rmSync(path.join(repo, 'src/c.ts'));

const impact = planJson('impact', '--file', 'src/b.ts');
check('impact lists the dependents of a file', impact.dependents.map((d) => d.path).join() === 'src/a.ts' && impact.counts.dependents === 1, JSON.stringify(impact.counts));

writePlan();
check('check passes a plan built with new and add', plan('check', 'demo').status === 0, plan('check', 'demo').stdout);
const broken = plan('add', 'demo', 'risk', 'x'.repeat(200));
check('a line over the cap is refused and the file is unchanged', broken.status === 1 && /the cap is 160/.test(broken.stderr));
check('the first section to review is the title', planJson('show', 'demo').next === 'title');
check('the plan cannot be approved while sections are pending', plan('approve', 'demo', 'plan', '--by', 'self').status === 1);
check('handoff refuses a plan that is not approved', plan('handoff', 'demo').status === 1);
check('approving every section and then the plan works', approveAll().status === 0);
check('an approved plan checks clean', plan('check', 'demo').status === 0);
check('an open question blocks the stage', planJson('handoff', 'demo').ask.length === 1 && planJson('handoff', 'demo').items.length === 0);
plan('add', 'demo', 'answer', 's1.q1', 'self', 'Keep it.');
check('answering keeps the approval and releases the item', plan('check', 'demo').status === 0 && planJson('handoff', 'demo').items.map((i) => i.id).join() === 's1.1');
commit('plan', '.lantern/plans');

check('editing an approved section is caught by check', (() => {
    fs.writeFileSync(path.join(repo, '.lantern/plans/demo.plan'), read('.lantern/plans/demo.plan').replace('#goal b changes.', '#goal b changes a lot.'));
    const result = plan('check', 'demo');
    git('checkout', '-q', '--', '.lantern/plans/demo.plan');
    return result.status === 1 && /section goal is changed since it was approved/.test(result.stdout);
})());

check('status reads every item as planned before any pull request', planJson('status', 'demo').counts.planned === 1);
const pr = openPullRequest();
check('sync pr --plan --item writes the tick', pr.status === 0 && /#plan demo s1\.1/.test(read('.lantern/prs/301.pr')), pr.stderr);
check('sync pr refuses an item the plan lacks', sync('pr', '301', '--url', 'u', '--title', 't', '--base', 'main', '--branch', 'feat/change-b', '--plan', 'demo', '--item', 's9.9').status === 1);
commit('chore: record pull request #301', '.lantern/prs');
const origin = `${repo}-origin.git`;
fs.mkdirSync(origin);
spawnSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin, env });
git('remote', 'add', 'origin', origin);
git('push', '-q', 'origin', 'main', 'feat/change-b');
check('verify is green and quiet about the plan', (() => {
    const result = sync('verify', '--base', 'main', '--require-pr', '--branch', 'feat/change-b');
    return result.status === 0 && !/warning: .*plan/.test(result.stdout);
})(), sync('verify', '--base', 'main', '--require-pr', '--branch', 'feat/change-b').stdout);
check('an open pull request puts the item in progress', planJson('status', 'demo').stages[0].items[0].status === ITEM_STATUS.IN_PROGRESS, JSON.stringify(planJson('status', 'demo').stages[0].items[0]));
git('checkout', '-q', 'main');
git('merge', '-q', '--no-ff', '-m', 'Merged in feat/change-b (pull request #301)', 'feat/change-b');
check('a merged pull request makes the item implemented', planJson('status', 'demo').stages[0].items[0].status === ITEM_STATUS.IMPLEMENTED);
check('verified is the only status the plan stores', plan('verified', 'demo', 's1.1', '--by', 'self').status === 0 && planJson('status', 'demo').stages[0].items[0].status === ITEM_STATUS.VERIFIED && plan('check', 'demo').status === 0);
check('handoff then reports nothing left', /nothing to delegate/.test(plan('handoff', 'demo').stdout));
check('the planning skills resolve', plan('skills').status === 0, plan('skills').stdout);

fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(origin, { recursive: true, force: true });
if (failures) {
    console.log(`${failures} of ${count} assertions failed`);
    process.exit(1);
}
console.log(`all ${count} assertions passed`);
