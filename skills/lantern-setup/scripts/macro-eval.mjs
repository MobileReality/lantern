#!/usr/bin/env node
import path from 'node:path';
import { crossPlatformFindings, GATEWAY_ISOLATED, INFRA_ISOLATED } from './cross-platform.mjs';
import { MAX_UNTAGGED_SHARE, MIN_RECORDS_FOR_SHARE, MIN_UNTAGGED_GAP, divergenceByKind, externalStats, featureUsage, loadProject, untaggedByPlatform, untaggedGaps, untaggedOverThreshold } from './macro-stats.mjs';

const MAX_FEATURES = 12;
const MAX_COLLISIONS = 0;
const MAX_NEAR_DUPLICATES = 0;
const MAX_LIBRARY_LIKE = 0;
const MAX_UNLISTED = 0;
const MAX_SINGLE_USE_SHARE = 0.5;
const MIN_SYSTEMS_FOR_SHARE = 6;
const MAX_DIVERGENCE = 0.5;
const MIN_FEATURES_FOR_DIVERGENCE = 3;
const OFFENDERS_SHOWN = 5;

const percent = (share) => `${Math.round(share * 100)}%`;
const check = (name, ok, value, rule) => ({ name, status: ok ? 'PASS' : 'WARN', value, rule });

function featureChecks(usage, stats) {
    return [
        check('feature-count', usage.used > 0 && usage.used <= MAX_FEATURES, `${usage.used} used`, usage.used ? `<= ${MAX_FEATURES}` : 'at least 1 (no #feature tags)'),
        check('feature-collisions', stats.collisions.length <= MAX_COLLISIONS, `${stats.collisions.length}`, `<= ${MAX_COLLISIONS} feature named after a platform or a system`),
    ];
}

function systemChecks(stats) {
    const sampled = stats.distinct >= MIN_SYSTEMS_FOR_SHARE;
    const singleShare = stats.distinct ? stats.singleUse.length / stats.distinct : 0;
    return [
        check('system-near-duplicates', stats.nearDuplicates.length <= MAX_NEAR_DUPLICATES, `${stats.nearDuplicates.length} group(s)`, `<= ${MAX_NEAR_DUPLICATES}`),
        check('system-library-like', stats.libraryLike.length <= MAX_LIBRARY_LIKE, `${stats.libraryLike.length}`, `<= ${MAX_LIBRARY_LIKE} single-use package-shaped ext id`),
        check('system-single-use', !sampled || singleShare <= MAX_SINGLE_USE_SHARE, `${stats.singleUse.length}/${stats.distinct} (${percent(singleShare)})`, sampled ? `<= ${percent(MAX_SINGLE_USE_SHARE)}` : `not judged under ${MIN_SYSTEMS_FOR_SHARE} systems`),
        check('system-listed', stats.listed === null || stats.unlisted.length <= MAX_UNLISTED, stats.listed === null ? 'no .lantern/systems' : `${stats.unlisted.length} unlisted`, stats.listed === null ? 'not checked' : `<= ${MAX_UNLISTED}`),
    ];
}

function untaggedCheck(rows) {
    const judged = rows.filter((row) => row.records >= MIN_RECORDS_FOR_SHARE);
    const over = untaggedOverThreshold(rows);
    const value = over.length ? over.map((row) => `${row.platform} ${percent(row.share)}`).join(', ') : judged.length ? 'none over' : `no platform has ${MIN_RECORDS_FOR_SHARE} records`;
    return check('untagged-share', over.length === 0, value, `<= ${percent(MAX_UNTAGGED_SHARE)} per platform with at least ${MIN_RECORDS_FOR_SHARE} records`);
}

function untaggedDivergenceCheck(rows) {
    const gaps = untaggedGaps(rows);
    const judged = rows.filter((row) => row.kind !== null && row.records >= MIN_RECORDS_FOR_SHARE);
    const comparable = judged.some((row) => judged.some((other) => other.kind === row.kind && other.platform !== row.platform));
    const rule = `gap < ${percent(MIN_UNTAGGED_GAP)} between platforms of one kind, each with at least ${MIN_RECORDS_FOR_SHARE} records`;
    if (!comparable) return check('untagged-divergence', true, 'n/a', 'no two platforms of one kind with enough records');
    const value = gaps.length ? gaps.map(({ high, low, gap }) => `${high.platform} ${percent(high.share)} vs ${low.platform} ${percent(low.share)} (gap ${Math.round(gap * 100)} points)`).join('; ') : 'no gap';
    return check('untagged-divergence', gaps.length === 0, value, rule);
}

function divergenceChecks(groups) {
    if (!groups.length) return [check('feature-divergence', true, 'n/a', 'no two platforms of one kind carry feature tags')];
    return groups.map((group) => {
        const judged = group.used >= MIN_FEATURES_FOR_DIVERGENCE;
        return check(`feature-divergence[${group.kind}]`, !judged || group.share <= MAX_DIVERGENCE, `${percent(group.share)} of ${group.used} feature(s) on one platform only`, judged ? `<= ${percent(MAX_DIVERGENCE)}` : `not judged under ${MIN_FEATURES_FOR_DIVERGENCE} features`);
    });
}

function crossPlatformChecks(project) {
    const findings = crossPlatformFindings(project);
    const ofKind = (kind) => findings.filter((finding) => finding.kind === kind);
    const gateways = ofKind(GATEWAY_ISOLATED);
    const infra = ofKind(INFRA_ISOLATED);
    return [
        check('cross-platform-gateway', gateways.length === 0, gateways.length ? gateways.map((f) => `${f.platform} ${f.gateways} gateway file(s)`).join(', ') : 'none isolated', 'a platform with gateway files relates to another platform when its peers do'),
        check('cross-platform-infra', infra.length === 0, infra.length ? infra.map((f) => f.platform).join(', ') : 'none isolated', 'an infra platform relates to at least one other platform'),
    ];
}

function evaluate(root) {
    const project = loadProject(root);
    const usage = featureUsage(project);
    const stats = externalStats(project);
    const untagged = untaggedByPlatform(project);
    const groups = divergenceByKind(project);
    const checks = [...featureChecks(usage, stats), ...systemChecks(stats), untaggedCheck(untagged), untaggedDivergenceCheck(untagged), ...divergenceChecks(groups), ...crossPlatformChecks(project)];
    return { project, usage, stats, untagged, groups, checks };
}

function tableLines({ project, usage, stats, untagged, groups }) {
    const lines = [
        `records     ${project.records.length}${project.platforms ? ` on ${project.platforms.length} platform(s)` : ' (no .lantern/platforms)'}`,
        `features    ${usage.used} used${usage.declared === null ? ' (no .lantern/features)' : `, ${usage.declared} declared`}`,
        `systems     ${stats.distinct} distinct ext target(s)${stats.listed === null ? ' (no .lantern/systems)' : `, ${stats.listed} listed`}`,
        '',
        'untagged share per platform',
        ...untagged.map((row) => `  ${row.platform.padEnd(16)} ${(row.kind ?? '-').padEnd(8)} ${String(row.untagged).padStart(4)}/${String(row.records).padEnd(4)} ${percent(row.share)}`),
    ];
    for (const group of groups) {
        lines.push('', `feature divergence, ${group.kind} platforms (${group.platforms.join(', ')}): ${percent(group.share)} of ${group.used} feature(s) used by one platform only`);
        for (const offender of group.only.slice(0, OFFENDERS_SHOWN)) lines.push(`  ${offender.feature.padEnd(24)} ${offender.platform} (${offender.records} record(s))`);
    }
    for (const dup of stats.nearDuplicates) lines.push('', `near-duplicate systems: ${dup.ids.join(', ')}`);
    return lines;
}

function checkLines(checks) {
    return checks.map((c) => `${c.status} ${c.name.padEnd(28)} ${c.value} (${c.rule})`);
}

function main() {
    const args = process.argv.slice(2);
    const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');
    const result = evaluate(root);
    const warned = result.checks.filter((c) => c.status === 'WARN');
    if (args.includes('--json')) console.log(JSON.stringify({ checks: result.checks, usage: result.usage, untagged: result.untagged, divergence: result.groups, systems: result.stats }, null, 1));
    else console.log([`macro-eval ${root}`, ...tableLines(result), '', ...checkLines(result.checks), '', `${warned.length ? 'WARN' : 'PASS'}: ${warned.length} of ${result.checks.length} check(s) warn`].join('\n'));
    if (args.includes('--fail') && warned.length) process.exit(1);
}

main();
