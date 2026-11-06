#!/usr/bin/env node
import { fail, parseArgs } from './cli-args.mjs';
import { loadMap, readLang } from './lib.mjs';
import {
    MAX_SYSTEM_TEXT, SYSTEMS_FILE, SYSTEM_ID, collectExternals, loadSystemTexts, loadSystems, nearDuplicateGroups,
    nearestListed, saveSystemTexts, saveSystems, useCounts, vendorProductPairs, vocabularyFindings,
} from './vocabulary.mjs';

const COMMANDS = ['list', 'check', 'add', 'suggest', 'seed'];
const USAGE = 'usage: systems.mjs [root] list | check | seed | suggest | add <id> --text "<short>" [--allow-similar]';
const { root, command, args, flags } = parseArgs(process.argv.slice(2), { commands: COMMANDS, valueFlags: ['text'] });

function mapInputs() {
    const { records } = loadMap(root);
    const { systems, lines, errors } = loadSystems(root);
    return { records, systems, systemLines: lines, listErrors: errors };
}

function runList() {
    const { systems, errors } = loadSystems(root);
    if (!systems) return console.log(`no ${SYSTEMS_FILE}`);
    const texts = loadSystemTexts(root, readLang(root)).text;
    for (const id of [...systems].sort()) console.log(texts[id] ? `${id} | ${texts[id]}` : id);
    for (const error of errors) console.log(`problem: ${error}`);
}

function runCheck() {
    const { records, systems, systemLines, listErrors } = mapInputs();
    if (!systems && !listErrors.length) return console.log(`no ${SYSTEMS_FILE}; nothing to check`);
    const findings = vocabularyFindings({ records, systems, systemLines }).filter((f) => f.kind.startsWith('ext-'));
    const problems = [...listErrors, ...findings.filter((f) => f.kind === 'ext-unlisted').map((f) => f.message)];
    for (const finding of findings.filter((f) => f.kind !== 'ext-unlisted')) console.log(`warning: ${finding.message}`);
    for (const problem of problems) console.log(`problem: ${problem}`);
    console.log(problems.length ? `FAIL: ${problems.length} problem(s)` : 'OK');
    if (problems.length) process.exit(1);
}

function runSuggest() {
    const { records, systems } = mapInputs();
    const used = collectExternals(records);
    const counts = useCounts(used);
    const ids = [...new Set([...used.keys(), ...(systems ?? [])])];
    const lines = nearDuplicateGroups(ids, counts).map((g) => `merge   ${g.ids.filter((id) => id !== g.keep).join(', ')} -> ${g.keep}   (one name once api/sdk/plural are dropped; retag.mjs merge-system <other> ${g.keep})`);
    for (const { short, long } of vendorProductPairs(ids)) lines.push(`maybe   ${short} / ${long}   (one name is part of the other, a vendor and its product? only the owner confirms; retag.mjs merge-system <other> <kept>)`);
    for (const finding of vocabularyFindings({ records, systems }).filter((f) => f.kind === 'ext-library')) lines.push(`library ${finding.id}   (used once, looks like a package; probably not a system: retag.mjs drop-system ${finding.id})`);
    console.log(lines.length ? lines.join('\n') : 'NONE');
}

function runSeed() {
    const { records, systems } = mapInputs();
    if (systems) fail(`${SYSTEMS_FILE} already exists; seed only creates it. Use add for a new system.`, 1);
    const ids = [...collectExternals(records).keys()];
    const bad = ids.filter((id) => !SYSTEM_ID.test(id));
    if (bad.length) fail(`cannot seed: ext id(s) ${bad.join(', ')} are not lowercase kebab-case; rename them first (retag.mjs rename-system <old> <new>)`, 1);
    saveSystems(root, ids);
    console.log(`seeded ${SYSTEMS_FILE} with ${ids.length} system(s); give each a short text with add <id> --text "<short>"`);
}

function validateAdd() {
    const [id] = args;
    if (!id || args.length > 1) fail(USAGE);
    if (!SYSTEM_ID.test(id)) fail(`"${id}" must be lowercase kebab-case, one outside system (a hosted service, a third-party API, a database or queue; never a library or module)`);
    const text = typeof flags.text === 'string' ? flags.text.trim() : '';
    if (text.length > MAX_SYSTEM_TEXT || /[\r\n]/.test(text)) fail(`--text must be one line under ${MAX_SYSTEM_TEXT} characters`);
    return { id, text };
}

function runAdd() {
    const { id, text } = validateAdd();
    const { systems, errors } = loadSystems(root);
    if (errors.length) fail(`${SYSTEMS_FILE} is malformed; fix it first:\n  ${errors.join('\n  ')}`, 1);
    const listed = [...(systems ?? [])];
    const code = readLang(root);
    const texts = loadSystemTexts(root, code);
    if (texts.error) fail(texts.error, 1);
    if (!listed.includes(id)) {
        if (!text) fail(`a new system needs --text "<short>"`);
        const near = nearestListed(id, listed);
        if (near && !flags['allow-similar']) fail(`"${id}" looks like the listed system "${near}"; reuse "${near}". Only if the owner confirmed they differ, pass --allow-similar.`, 1);
        saveSystems(root, [...listed, id]);
    } else if (!text) return console.log(`${id} is already listed`);
    if (text) saveSystemTexts(root, code, { ...texts.text, [id]: text });
    console.log(listed.includes(id) ? `${id}: text updated` : `${id}: added to ${SYSTEMS_FILE}`);
}

const RUNNERS = { list: runList, check: runCheck, suggest: runSuggest, seed: runSeed, add: runAdd };
if (!RUNNERS[command]) fail(USAGE);
RUNNERS[command]();
