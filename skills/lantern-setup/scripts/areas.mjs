#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runGate } from './areas-gate.mjs';
import { buildPackets, planLookup, scoreAnswers, writePackets, MIN_LOOKUP } from './areas-lookup.mjs';
import { EXIT_UNUSABLE, groupsFromProject, requireMap } from './areas-project.mjs';
import { propose, renderProposal } from './areas-propose.mjs';
import { areasRequirement, requirementMessage } from './areas-required.mjs';
import { snapshotFromMap } from './areas-snapshot.mjs';
import { answerAll, CALL_TIMEOUT_MS, childEnv, claudeLauncher, DEFAULT_MODEL, makeScratch, readerLauncher } from './areas-reader.mjs';
import { fail, parseArgs } from './cli-args.mjs';

const COMMANDS = ['propose', 'check', 'required', 'lookup'];
const ANSWERS_NAME = 'answers.json';
const USAGE = 'usage: areas.mjs [root] propose [--json] | check [--json] [--allow-unassigned] [--input <snapshot.json>] | required [--json] | lookup packets [root] --out <dir> | lookup score [root] --answers <file.json> [--json] | lookup run [root] --out <dir> [--model <id>] [--reader <command>] [--timeout-ms <ms>] [--json]';
const EXIT_FAILED = 1;

function readJson(file) {
    let json;
    try {
        json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        fail(`areas.mjs: cannot read ${file} as JSON (${e.message})`, EXIT_UNUSABLE);
    }
    return json;
}

function groupsFromInput(input) {
    const ok = input && typeof input === 'object' && Array.isArray(input.blocks) && Array.isArray(input.edges) && input.areas && typeof input.areas === 'object';
    if (!ok) fail('areas.mjs: --input needs {"blocks": [], "edges": [], "external_systems": [], "platforms": [], "feature_texts": {}, "areas": {"<area>": ["<feature>"]}, "purposes": {"<area>": "<sentence>"}}', EXIT_UNUSABLE);
    const snap = { ...input, external_systems: input.external_systems ?? [], platforms: input.platforms ?? [], feature_texts: input.feature_texts ?? {} };
    return { snap, groups: input.areas, purposes: input.purposes ?? {}, where: 'input' };
}

function renderCheck(label, gate) {
    const { results, failed, unassigned } = gate;
    const head = `GATE ${label}: ${failed.length ? `FAIL, ${failed.length} of ${results.length} rules (check exits ${EXIT_FAILED})` : `PASS, ${results.length} of ${results.length} rules (check exits 0)`}`;
    const lines = results.flatMap((r) => [
        `  ${r.reasons.length ? 'FAIL' : 'pass'}  ${r.name}: ${r.summary}`,
        ...r.reasons.map((reason) => `        - ${reason}`),
        ...(r.reasons.length && r.hint ? [`        fix: ${r.hint}`] : []),
    ]);
    const toAssign = unassigned.length ? [`To assign: ${unassigned.join(', ')}`] : [];
    return [head, ...lines, ...toAssign].join('\n');
}

function jsonCheck(label, gate) {
    return {
        label,
        pass: gate.failed.length === 0,
        failed: gate.failed.map((r) => r.name),
        toAssign: gate.unassigned,
        rules: gate.results.map((r) => ({ name: r.name, pass: r.reasons.length === 0, summary: r.summary, reasons: r.reasons, fix: r.reasons.length ? r.hint : '' })),
    };
}

function runCheck(root, flags) {
    const source = flags.input ? groupsFromInput(readJson(flags.input)) : groupsFromProject(root);
    const gate = runGate(source.snap, source.groups, source.purposes, { allowUnassigned: !!flags['allow-unassigned'] });
    const label = flags.input ? flags.input : source.where;
    console.log(flags.json ? JSON.stringify(jsonCheck(label, gate), null, 1) : renderCheck(label, gate));
    if (gate.failed.length) process.exit(EXIT_FAILED);
}

function runRequired(root, flags) {
    const requirement = areasRequirement(root);
    const counts = `${requirement.records} records, ${requirement.features} features`;
    if (flags.json) console.log(JSON.stringify(requirement, null, 1));
    else if (!requirement.required) console.log(`areas: not required (${counts})`);
    else console.log(requirement.satisfied ? `areas: required and done (${counts})` : requirementMessage(requirement));
    if (requirement.required && !requirement.satisfied) process.exit(EXIT_FAILED);
}

function runPropose(root, flags) {
    const snap = flags.input ? readJson(flags.input) : snapshotFromMap(root);
    if (!Array.isArray(snap.blocks)) fail('areas.mjs: --input needs a "blocks" array', EXIT_UNUSABLE);
    requireMap(snap, root);
    const result = propose({ ...snap, edges: snap.edges ?? [], external_systems: snap.external_systems ?? [] });
    console.log(flags.json ? JSON.stringify(result, null, 1) : renderProposal(result));
}

function writeLookupPackets(root, flags, command) {
    if (typeof flags.out !== 'string') fail(`areas.mjs: ${command} needs --out <dir>`, EXIT_UNUSABLE);
    const { snap, groups, purposes } = groupsFromProject(root);
    const plan = planLookup(snap, groups);
    const packets = buildPackets(plan, purposes);
    if (!packets.length) fail('areas.mjs: no feature can be looked up (every feature is unplaced or has no text)', EXIT_UNUSABLE);
    writePackets(path.resolve(flags.out), packets);
    const say = command === 'lookup run' && flags.json ? console.error : console.log;
    say(`wrote ${packets.length} packets and manifest.json to ${flags.out}`);
    plan.skipped.forEach((s) => { say(`no packet for ${s.id}: ${s.reason}`); });
    return { plan, packets };
}

function runLookupPackets(root, flags) {
    writeLookupPackets(root, flags, 'lookup packets');
}

function launcherFor(flags) {
    if (typeof flags.reader === 'string') return readerLauncher(flags.reader);
    return claudeLauncher({ model: typeof flags.model === 'string' ? flags.model : DEFAULT_MODEL });
}

function timeoutOf(flags) {
    if (flags['timeout-ms'] === undefined) return CALL_TIMEOUT_MS;
    const ms = Number(flags['timeout-ms']);
    if (!(ms > 0)) fail('areas.mjs: --timeout-ms needs a positive number', EXIT_UNUSABLE);
    return ms;
}

async function runLookupRun(root, flags) {
    const { plan, packets } = writeLookupPackets(root, flags, 'lookup run');
    const scratch = makeScratch(root);
    let replies;
    try {
        replies = await answerAll(packets, launcherFor(flags), { cwd: scratch, env: childEnv(), timeoutMs: timeoutOf(flags) });
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
    const answers = Object.fromEntries(replies.filter((r) => r.text).map((r) => [r.feature, r.text]));
    fs.writeFileSync(path.join(path.resolve(flags.out), ANSWERS_NAME), `${JSON.stringify(answers, null, 1)}\n`);
    const failed = replies.filter((r) => !r.text);
    failed.forEach((r) => { console.error(`no answer for ${r.feature}: ${r.error}`); });
    const costs = replies.map((r) => r.cost).filter((c) => c !== undefined);
    if (costs.length) (flags.json ? console.error : console.log)(`cost: $${costs.reduce((a, b) => a + b, 0).toFixed(4)} over ${costs.length} calls`);
    printScore(plan, scoreAnswers(plan, answers), flags);
}

function readAnswers(file) {
    if (typeof file !== 'string') fail('areas.mjs: lookup score needs --answers <file.json>', EXIT_UNUSABLE);
    const answers = readJson(file);
    const ok = answers && typeof answers === 'object' && !Array.isArray(answers) && Object.values(answers).every((v) => typeof v === 'string');
    if (!ok) fail('areas.mjs: --answers needs {"<feature-id>": "<area id>"} with string values', EXIT_UNUSABLE);
    return answers;
}

function renderScore(result, plan) {
    const pct = (n) => `${Math.round(n * 100)}%`;
    const verdict = result.passed ? 'PASS' : 'FAIL';
    const head = `LOOKUP ${verdict}: ${result.total - result.misplaced.length - result.missing.length} of ${result.total} placed where the reader looked (${pct(result.score)}), needs ${pct(MIN_LOOKUP)}; chance is ${pct(result.chance)} (1 in ${plan.offered.length})`;
    const items = result.misplaced.map((m) => `  revise ${m.feature}: it is in ${m.real}, the reader chose ${m.chosen === '' ? '(empty)' : m.chosen}`);
    const missing = result.missing.map((id) => `  no answer for ${id}`);
    return [head, ...items, ...missing].join('\n');
}

function runLookupScore(root, flags) {
    const answers = readAnswers(flags.answers);
    const { snap, groups } = groupsFromProject(root);
    const plan = planLookup(snap, groups);
    printScore(plan, scoreAnswers(plan, answers), flags);
}

function printScore(plan, result, flags) {
    const body = { ...result, minLookup: MIN_LOOKUP, offered: plan.offered };
    console.log(flags.json ? JSON.stringify(body, null, 1) : renderScore(result, plan));
    if (result.missing.length) process.exit(EXIT_UNUSABLE);
    if (!result.passed) process.exit(EXIT_FAILED);
}

async function runLookup(parsed) {
    const [sub, where] = parsed.args;
    const root = where ? path.resolve(where) : parsed.root;
    if (sub === 'packets') runLookupPackets(root, parsed.flags);
    else if (sub === 'score') runLookupScore(root, parsed.flags);
    else if (sub === 'run') await runLookupRun(root, parsed.flags);
    else fail(USAGE, EXIT_UNUSABLE);
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2), { commands: COMMANDS, valueFlags: ['input', 'out', 'answers', 'model', 'reader', 'timeout-ms'] });
    const root = parsed.args[0] ? path.resolve(parsed.args[0]) : parsed.root;
    if (parsed.command === 'propose') runPropose(root, parsed.flags);
    else if (parsed.command === 'check') runCheck(root, parsed.flags);
    else if (parsed.command === 'required') runRequired(root, parsed.flags);
    else if (parsed.command === 'lookup') await runLookup(parsed);
    else fail(USAGE, EXIT_UNUSABLE);
}

await main();
