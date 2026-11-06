#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { AREAS_FILE } from './areas-file.mjs';
import { areasRequirement, requirementMessage } from './areas-required.mjs';
import { checkAreas } from './areas-validate.mjs';
import { checkCrossPlatform } from './cross-platform.mjs';
import { MAX_FEATURES, MAX_FEATURES_WITH_AREAS, REFERENCE_ARROW, SKILL_ROLE, containsSymbol, enumerate, hashContent, loadFeatures, loadMap, loadRoles, mapFileFor, readLang } from './lib.mjs';
import { checkPlatforms } from './platforms.mjs';
import { listPrs, summarize as summarizePrs } from './prs.mjs';
import { checkSections } from './sections.mjs';
import { checkTexts } from './texts.mjs';
import { checkVocabulary } from './vocabulary.mjs';

const HASH = /^[0-9a-f]{12}$/;
const MARKDOWN_PATH = /\.mdx?$/i;
const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--')) ?? '.';
const settled = args.includes('--settled');
const partial = args.includes('--partial');
const strict = args.includes('--strict');
const requireAreas = args.includes('--require-areas');

const roles = loadRoles();
const enumerated = new Set(enumerate(root).map((f) => f.path));
const { records, errors } = loadMap(root);
const { features, lines: featureLines, errors: featureErrors } = loadFeatures(root);
errors.push(...featureErrors);
const warnings = [];
const featureLimit = fs.existsSync(path.join(root, AREAS_FILE)) ? MAX_FEATURES_WITH_AREAS : MAX_FEATURES;
if (features && features.size > featureLimit) warnings.push(`${features.size} features declared; keep the list under ~${featureLimit}`);
const inProgress = [];
const others = [];
const byPath = new Map();
const contents = new Map();

function read(rel) {
    if (!contents.has(rel)) {
        try {
            contents.set(rel, fs.readFileSync(path.join(root, rel)));
        } catch {
            contents.set(rel, null);
        }
    }
    return contents.get(rel);
}

for (const record of records) {
    const at = record.where;
    if (byPath.has(record.path)) errors.push(`${at}: duplicate record for ${record.path} (first at ${byPath.get(record.path).where})`);
    else byPath.set(record.path, record);
    if (record.file !== mapFileFor(record.path)) errors.push(`${at}: ${record.path} belongs in ${mapFileFor(record.path)}`);
    if (!roles.has(record.role)) errors.push(`${at}: role "${record.role}" is not in the vocabulary`);
    if (record.role === SKILL_ROLE && !MARKDOWN_PATH.test(record.path)) errors.push(`${at}: role ${SKILL_ROLE} is for markdown files; ${record.path} is not one`);
    if (record.role === 'other') others.push(record.path);
    if (record.marker !== '.') inProgress.push(`${record.marker}${record.owner ? `@${record.owner}` : ''} ${record.path}`);

    if (record.plumbing && record.feature !== null) errors.push(`${record.plumbingWhere}: ${record.path} is marked #plumbing and has a #feature; keep one`);
    if (record.feature !== null) {
        if (!features) errors.push(`${record.featureWhere}: feature "${record.feature}" but .lantern/features does not exist`);
        else if (!features.has(record.feature)) errors.push(`${record.featureWhere}: unknown feature "${record.feature}" (declared: ${[...features.keys()].join(', ') || 'none'})`);
    }

    const content = read(record.path);
    if (record.marker === '+') {
        if (record.hash !== '-' && !HASH.test(record.hash)) errors.push(`${at}: hash must be 12 hex chars or "-"`);
        continue;
    }
    if (!HASH.test(record.hash)) errors.push(`${at}: hash must be 12 hex chars`);
    if (record.marker === '-') continue;
    if (content === null) {
        errors.push(`${at}: ${record.path} does not exist (deleted? drop the record or mark it -)`);
        continue;
    }
    if (!enumerated.has(record.path)) errors.push(`${at}: ${record.path} is outside the enumerated set (ignored, binary or generated)`);
    if (record.marker === '.' && hashContent(content) !== record.hash) {
        errors.push(`${at}: stale — ${record.path} changed since it was mapped (hash ${record.hash}, now ${hashContent(content)})`);
    }
}

for (const file of enumerated) {
    if (!partial && !byPath.has(file)) errors.push(`unmapped: ${file} has no record (expected in ${mapFileFor(file)})`);
}

for (const record of records) {
    for (const target of record.seeAlso ?? []) {
        if (target === record.path) errors.push(`${record.seeAlsoWhere}: see-also points at its own file`);
        else if (!byPath.has(target) && !(partial && enumerated.has(target))) errors.push(`${record.seeAlsoWhere}: see-also ${target} is not a mapped file`);
    }
    for (const relation of record.relations) {
        const refersTo = relation.arrow === REFERENCE_ARROW;
        if (refersTo && record.role !== SKILL_ROLE) errors.push(`${relation.where}: "${REFERENCE_ARROW}" relations belong to role ${SKILL_ROLE} files; ${record.path} is ${record.role}, use > < =`);
        if (!refersTo && record.role === SKILL_ROLE) errors.push(`${relation.where}: a ${SKILL_ROLE} file refers to its targets, write "${REFERENCE_ARROW} ${relation.token}"`);
        if (relation.external !== null) {
            if (!relation.external) errors.push(`${relation.where}: empty ext: target`);
            continue;
        }
        if (relation.path === record.path) {
            errors.push(`${relation.where}: relation points at its own file`);
            continue;
        }
        const target = byPath.get(relation.path);
        if (!enumerated.has(relation.path) && !target) {
            errors.push(`${relation.where}: dangling — ${relation.path} is not a mapped file`);
            continue;
        }
        if (relation.symbol) {
            const content = read(relation.path);
            if (content !== null && !containsSymbol(content.toString('utf8'), relation.symbol)) {
                errors.push(`${relation.where}: symbol "${relation.symbol}" not found in ${relation.path}`);
            }
        }
    }
}

const texts = checkTexts(root, records, features, readLang(root));
errors.push(...texts.errors);
warnings.push(...texts.warnings);

const platforms = checkPlatforms(root, [...byPath.keys()], enumerated, readLang(root));
errors.push(...platforms.errors);
warnings.push(...platforms.warnings);

const vocabulary = checkVocabulary(root, { records, features, featureLines, platforms: platforms.platforms }, strict);
errors.push(...vocabulary.errors);
warnings.push(...vocabulary.warnings);

const crossPlatform = partial ? { warnings: [], summary: [] } : checkCrossPlatform({ records, platforms: platforms.platforms });
warnings.push(...crossPlatform.warnings);

const areas = checkAreas(root, { records, features, featureLines, platforms: platforms.platforms, primary: readLang(root) }, strict);
errors.push(...areas.errors);
warnings.push(...areas.warnings);

const sections = checkSections(root, byPath, read, readLang(root), platforms.platforms?.map((p) => p.id) ?? null);
errors.push(...sections.errors);
warnings.push(...sections.warnings);

const prs = listPrs(root);
const prProblems = summarizePrs(prs);
errors.push(...prProblems.errors);
warnings.push(...prProblems.warnings);

if (requireAreas) {
    const requirement = areasRequirement(root);
    if (requirement.required && !requirement.satisfied) errors.push(requirementMessage(requirement));
}

if (settled) {
    for (const entry of inProgress) errors.push(`in progress (not allowed with --settled): ${entry}`);
}

const mapped = [...enumerated].filter((f) => byPath.has(f)).length;
const pct = enumerated.size ? ((100 * mapped) / enumerated.size).toFixed(1) : '100.0';
console.log(`coverage ${mapped}/${enumerated.size} (${pct}%), ${records.length} records`);
for (const line of texts.summary) console.log(line);
for (const line of platforms.summary) console.log(line);
for (const line of vocabulary.summary) console.log(line);
for (const line of crossPlatform.summary) console.log(line);
for (const line of areas.summary) console.log(line);
for (const line of sections.summary) console.log(line);
if (prs.dismissed) console.log(`prs dismissed ${prs.dismissed.ids.length}`);
if (prs.length) console.log(`prs ${prs.length} record(s), ${prProblems.errors.length ? `FAIL ${prProblems.errors.length}` : 'OK'}`);
const usedFeatures = new Set(records.map((r) => r.feature));
const unused = features ? [...features.keys()].filter((f) => !usedFeatures.has(f)) : [];
if (unused.length && !partial) warnings.push(`declared but unused feature(s): ${unused.join(', ')}`);
if (warnings.length) console.log(`warning: ${warnings.length}\n  ${warnings.join('\n  ')}`);
if (inProgress.length) console.log(`in progress: ${inProgress.length}\n  ${inProgress.join('\n  ')}`);
if (others.length) console.log(`role other (needs a human look): ${others.length}\n  ${others.join('\n  ')}`);
if (errors.length) {
    console.log(`FAIL: ${errors.length} problem(s)`);
    for (const error of errors) console.log(`  ${error}`);
    process.exit(1);
}
console.log('OK');
