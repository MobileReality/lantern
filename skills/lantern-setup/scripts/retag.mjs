#!/usr/bin/env node
import { fail, parseArgs } from './cli-args.mjs';
import { FEATURE_ID, FEATURES_FILE, loadFeatures, loadMap } from './lib.mjs';
import { retagAreaLeaf } from './retag-areas.mjs';
import { Edits, PLUMBING, retagExternals, retagFeatureDeclaration, retagSystemDeclaration, retagTags } from './retag-edit.mjs';
import { SYSTEM_ID, collectExternals, loadSystems } from './vocabulary.mjs';

const COMMANDS = ['rename-system', 'merge-system', 'drop-system', 'retag-feature', 'tag-file'];
const USAGE = `usage: retag.mjs [root] rename-system <old> <new> | merge-system <old> <kept> | drop-system <id>
                         | retag-feature <old> <new | --untag> | tag-file <path> <feature | --none>   [--dry-run]`;
const { root, command, args, flags } = parseArgs(process.argv.slice(2), { commands: COMMANDS });
const { records } = loadMap(root);
const edits = new Edits(root);

function knownSystems() {
    return new Set([...collectExternals(records).keys(), ...(loadSystems(root).systems ?? [])]);
}

function knownFeatures() {
    const { features } = loadFeatures(root);
    if (!features) fail(`no ${FEATURES_FILE}; retag only renames features that exist`);
    return { declared: new Set(features.keys()), used: new Set(records.map((r) => r.feature).filter(Boolean)), features };
}

function finish(summary) {
    const files = edits.changedFiles();
    if (!flags['dry-run']) edits.commit();
    console.log(`${summary}${flags['dry-run'] ? ' [dry run, nothing written]' : ''}`);
    for (const file of files) console.log(`  ${flags['dry-run'] ? 'would write' : 'wrote'} ${file}`);
}

function requireIds(count) {
    if (args.length !== count) fail(USAGE);
}

function renameOrMerge(merge) {
    requireIds(2);
    const [old, replacement] = args;
    const known = knownSystems();
    if (!SYSTEM_ID.test(replacement)) fail(`"${replacement}" must be lowercase kebab-case`);
    if (old === replacement) fail('old and new are the same id');
    if (!known.has(old)) {
        if (known.has(replacement)) return console.log(`${old} is not a system (any more) and ${replacement} is: already done, nothing changed`);
        fail(`unknown system "${old}" (known: ${[...known].sort().join(', ') || 'none'})`);
    }
    if (merge && !known.has(replacement)) fail(`"${replacement}" is not a known system; use rename-system ${old} ${replacement}`);
    if (!merge && known.has(replacement)) fail(`"${replacement}" is already a system; use merge-system ${old} ${replacement}`);
    const relations = retagExternals(edits, new Map([[old, replacement]]));
    retagSystemDeclaration(edits, old, replacement);
    finish(`${merge ? 'merge' : 'rename'}-system ${old} -> ${replacement}: ${relations} relation(s) changed`);
}

function dropSystem() {
    requireIds(1);
    const [id] = args;
    if (!knownSystems().has(id)) fail(`unknown system "${id}"`);
    const relations = retagExternals(edits, new Map([[id, null]]));
    retagSystemDeclaration(edits, id, null);
    finish(`drop-system ${id}: ${relations} relation(s) removed`);
}

function retagFeature() {
    requireIds(flags.untag ? 1 : 2);
    const [old, replacement = null] = args;
    if (!flags.untag && !FEATURE_ID.test(replacement ?? '')) fail(`"${replacement}" must be a lowercase kebab-case feature id (or pass --untag)`);
    const { declared, used } = knownFeatures();
    const known = (id) => declared.has(id) || used.has(id);
    if (old === replacement) fail('old and new are the same id');
    if (!known(old)) {
        if (replacement && known(replacement)) return console.log(`${old} is not a feature (any more) and ${replacement} is: already done, nothing changed`);
        fail(`unknown feature "${old}" (declared: ${[...declared].join(', ') || 'none'})`);
    }
    if (!declared.has(old)) fail(`"${old}" is tagged on records but not declared in ${FEATURES_FILE}; the map is invalid, repair it before retagging`);
    const tags = retagTags(edits, (record) => (record.feature === old ? replacement : undefined));
    retagFeatureDeclaration(edits, old, replacement, declared);
    const leaf = retagAreaLeaf(edits, old, replacement);
    finish(`retag-feature ${old} -> ${replacement ?? '(untagged)'}: ${tags} record(s) re-tagged${leaf ? ', area leaf updated' : ''}`);
}

function tagFile() {
    requireIds(flags.none ? 1 : 2);
    const [file, feature = null] = args;
    const record = records.find((r) => r.path === file);
    if (!record) fail(`"${file}" has no record in the map`);
    const { declared } = knownFeatures();
    if (!flags.none && !declared.has(feature)) fail(`feature "${feature}" is not declared in ${FEATURES_FILE}; tag-file never invents one`);
    const wanted = flags.none ? PLUMBING : feature;
    const tags = retagTags(edits, (r) => (r.path === record.path ? wanted : undefined));
    finish(`tag-file ${file} -> ${flags.none ? '(plumbing, no feature)' : feature}: ${tags ? 'tag changed' : 'already so'}`);
}

const RUNNERS = {
    'rename-system': () => renameOrMerge(false),
    'merge-system': () => renameOrMerge(true),
    'drop-system': dropSystem,
    'retag-feature': retagFeature,
    'tag-file': tagFile,
};
if (!RUNNERS[command]) fail(USAGE);
RUNNERS[command]();
