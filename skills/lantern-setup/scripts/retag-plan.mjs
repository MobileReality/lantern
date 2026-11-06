import { readLang } from './lib.mjs';
import { MAX_UNTAGGED_SHARE, MIN_GAP_RECORDS, MIN_UNTAGGED_GAP, NO_PLATFORM, PLUMBING_ROLES, divergenceByKind, externalStats, loadProject, platformOf, untaggedReviewPlatforms } from './macro-stats.mjs';
import { keyName, langFileFor, loadLangs, textOf } from './texts.mjs';
import { SYSTEMS_FILE, vendorProductPairs, vocabularyFindings } from './vocabulary.mjs';

const RETAG_CHUNK_RECORDS = 30;
const percent = (share) => `${Math.round(share * 100)}%`;
const FEATURE_KINDS = new Set(['feature-platform', 'feature-system']);

function flaggedFeatures(findings) {
    const flagged = new Map();
    for (const finding of findings.filter((f) => FEATURE_KINDS.has(f.kind))) {
        flagged.set(finding.id, [...(flagged.get(finding.id) ?? []), finding.kind === 'feature-platform' ? 'names a platform' : 'names an outside system']);
    }
    return flagged;
}

function featureRows(project, flagged, review) {
    const rows = new Map();
    for (const record of project.records) {
        if (record.feature === null) continue;
        const row = rows.get(record.feature) ?? { id: record.feature, records: 0, platforms: new Set() };
        row.records += 1;
        row.platforms.add(platformOf(project, record));
        rows.set(record.feature, row);
    }
    return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => {
        const notes = [...(flagged.get(row.id) ?? []).map((n) => `FLAG ${n}`), ...(review.has(row.id) ? [`REVIEW only on ${review.get(row.id)}`] : [])];
        return `  ${row.id.padEnd(26)} ${String(row.records).padStart(4)} record(s) on ${[...row.platforms].sort().join(', ')}${notes.length ? `   <- ${notes.join('; ')}` : ''}`;
    });
}

function reviewFeatures(project, flagged) {
    const review = new Map();
    for (const group of divergenceByKind(project)) {
        for (const offender of group.only) if (!flagged.has(offender.feature)) review.set(offender.feature, `${offender.platform} (${group.kind})`);
    }
    return review;
}

function systemLines(project, stats, findings) {
    const lines = [];
    for (const group of stats.nearDuplicates) lines.push(`  merge   ${group.ids.filter((id) => id !== group.keep).join(', ')} -> ${group.keep}`);
    const ids = [...new Set([...stats.ids, ...(project.systems ?? [])])];
    for (const { short, long } of vendorProductPairs(ids)) lines.push(`  maybe   ${short} / ${long}   (a vendor and its product? owner decides)`);
    for (const id of stats.libraryLike) lines.push(`  library ${id}   (single use, package-shaped: drop-system, or rename-system if it is a hosted service)`);
    for (const finding of findings.filter((f) => f.kind === 'ext-unlisted')) lines.push(`  unlisted ${finding.id}`);
    return lines;
}

function openSteps(project, stats, flagged, untagged) {
    const steps = [];
    if (stats.nearDuplicates.length) steps.push(`${stats.nearDuplicates.length} group(s) of near-duplicate outside systems: apply each with retag.mjs merge-system <other> <kept>`);
    if (stats.libraryLike.length) steps.push(`${stats.libraryLike.length} single-use package-shaped ext id(s): retag.mjs drop-system <id> for a library, rename-system <id> <system> for a hosted service`);
    if (!project.systems) steps.push(`${SYSTEMS_FILE} is missing: systems.mjs seed, then systems.mjs add <id> --text "<short>" for each id`);
    else if (stats.unlisted.length) steps.push(`${stats.unlisted.length} ext id(s) not in ${SYSTEMS_FILE}: systems.mjs add <id> --text "<short>", or retag.mjs merge-system <id> <listed>`);
    if (flagged.size) steps.push(`${flagged.size} feature(s) named after a platform or a system: retag.mjs retag-feature <old> <capability> for the whole feature, or plan.mjs . retag chunk <id> and tag-file per file`);
    const records = untagged.reduce((sum, entry) => sum + entry.records.length, 0);
    if (records) steps.push(`${records} untagged record(s) on ${untagged.length} platform(s) to review: plan.mjs . retag pending, then retag chunk <id>; tag-file <path> <feature> for a user-facing capability, tag-file <path> --none for deliberate plumbing`);
    return steps;
}

function untaggedLines(untagged) {
    if (!untagged.length) return [];
    return [
        `untagged records to review (flag: share over ${percent(MAX_UNTAGGED_SHARE)}, or ${Math.round(MIN_UNTAGGED_GAP * 100)}+ points above a sibling platform of its kind with ${MIN_GAP_RECORDS}+ reviewable records; roles left out as plumbing: ${[...PLUMBING_ROLES].sort().join(', ')}):`,
        ...untagged.map(({ row, over, sibling, records }) => {
            const reasons = [...(over ? [`share over ${percent(MAX_UNTAGGED_SHARE)}`] : []), ...(sibling ? [`sibling ${sibling.platform} (${sibling.kind}) is ${percent(sibling.featurelessShare)} untagged`] : [])];
            return `  ${row.platform.padEnd(16)} ${row.featureless}/${row.records} untagged (${percent(row.featurelessShare)}), ${records.length} to review   <- FLAG ${reasons.join('; ')}`;
        }),
    ];
}

function retagStatus(root) {
    const project = loadProject(root);
    const findings = vocabularyFindings(project);
    const stats = externalStats(project);
    const flagged = flaggedFeatures(findings);
    const review = reviewFeatures(project, flagged);
    const untagged = untaggedReviewPlatforms(project);
    const steps = openSteps(project, stats, flagged, untagged);
    const lines = [
        `features (${project.features?.size ?? 0} declared):`,
        ...featureRows(project, flagged, review),
        `outside systems (${stats.distinct} ext target(s), ${project.systems ? `${project.systems.size} listed` : 'no list'}):`,
        ...systemLines(project, stats, findings),
        ...untaggedLines(untagged),
        'NEXT:',
        ...(steps.length ? steps.map((step, i) => `  ${i + 1}. ${step}`) : ['  validate.mjs . --settled must exit 0']),
        ...(review.size ? ['REVIEW (judgement, not blocking): a feature only one platform of its kind uses is either that platform\'s own capability or the same capability under another name; retag-feature merges'] : []),
        steps.length ? `RETAG TODO: ${steps.length} step(s)` : 'RETAG DONE',
    ];
    return { lines, done: steps.length === 0 };
}

function splitChunks(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i += RETAG_CHUNK_RECORDS) out.push(rows.slice(i, i + RETAG_CHUNK_RECORDS));
    return out;
}

function pendingRecords(root) {
    const project = loadProject(root);
    const flagged = flaggedFeatures(vocabularyFindings(project));
    const rows = project.records.filter((r) => flagged.has(r.feature)).sort((a, b) => (a.feature + a.path < b.feature + b.path ? -1 : 1));
    const chunks = splitChunks(rows).map((records) => ({ kind: 'feature', records }));
    for (const { platform, records } of untaggedReviewPlatforms(project)) chunks.push(...splitChunks(records).map((part) => ({ kind: 'untagged', platform, records: part })));
    return { project, flagged, chunks };
}

function retagPending(root) {
    const { chunks } = pendingRecords(root);
    if (!chunks.length) return ['ALL DONE'];
    return chunks.map((chunk, i) => {
        const head = `retag chunk ${i + 1}: ${chunk.records.length} record(s), `;
        if (chunk.kind === 'untagged') return `${head}untagged on ${chunk.platform}`;
        return `${head}${chunk.records[0].feature}${chunk.records.at(-1).feature === chunk.records[0].feature ? '' : ` .. ${chunk.records.at(-1).feature}`}`;
    });
}

function relationText(record) {
    return record.relations.map((rel) => `${rel.arrow} ${rel.token}`).join(' ');
}

function retagChunk(root, id) {
    const { project, flagged, chunks } = pendingRecords(root);
    const chunk = chunks[Number(id) - 1];
    if (!chunk) return null;
    const langs = loadLangs(root);
    const primary = readLang(root);
    const allowed = [...(project.features?.keys() ?? [])].filter((f) => !flagged.has(f));
    const purposeOf = (r) => textOf(langs, primary, langFileFor(r.file, primary), keyName(r.path)) ?? r.purpose ?? '';
    const platformText = (r) => (project.platforms ? platformOf(project, r) : NO_PLATFORM);
    if (chunk.kind === 'untagged') {
        return [
            `# retag chunk ${id} of ${chunks.length}, untagged records on ${chunk.platform}: path | platform | role | purpose | relations`,
            '# decide from this text only (never read the source): a user-facing capability gets an existing feature (the same capability as a sibling platform keeps the same feature): retag.mjs tag-file <path> <feature>; anything else is deliberate plumbing: retag.mjs tag-file <path> --none',
            ...chunk.records.map((r) => `${r.path} | ${platformText(r)} | ${r.role} | ${purposeOf(r)} | ${relationText(r)}`),
            `# features you may use: ${allowed.join(', ') || '(none; name the capability with retag-feature first)'}`,
        ];
    }
    return [
        `# retag chunk ${id} of ${chunks.length}: path | platform | current feature | purpose | ext targets`,
        '# decide from this text only (never read the source): retag.mjs tag-file <path> <feature> | --none',
        ...chunk.records.map((r) => `${r.path} | ${platformText(r)} | ${r.feature} | ${purposeOf(r)} | ${r.relations.filter((rel) => rel.external).map((rel) => `ext:${rel.external}`).join(' ')}`),
        `# features you may use: ${allowed.join(', ') || '(none; name the capability with retag-feature first)'}`,
    ];
}

const RETAG_USAGE = 'usage: plan.mjs <root> retag [status | pending | chunk <id>]';

export function runRetag(root, sub = 'status', id) {
    let lines;
    if (sub === 'status') lines = retagStatus(root).lines;
    else if (sub === 'pending') lines = retagPending(root);
    else if (sub === 'chunk') lines = retagChunk(root, id);
    else {
        console.error(RETAG_USAGE);
        return 2;
    }
    if (!lines) {
        console.error(`no retag chunk ${id}`);
        return 2;
    }
    console.log(lines.join('\n'));
    return 0;
}
