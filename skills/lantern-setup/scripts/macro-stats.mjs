import { loadFeatures, loadMap } from './lib.mjs';
import { loadPlatforms, resolvePlatform } from './platforms.mjs';
import { collectExternals, loadSystems, nearDuplicateGroups, useCounts, vocabularyFindings } from './vocabulary.mjs';

export const NO_PLATFORM = 'all';
export const MAX_UNTAGGED_SHARE = 0.6;
export const MIN_RECORDS_FOR_SHARE = 10;
export const MIN_UNTAGGED_GAP = 0.3;
export const MIN_GAP_RECORDS = 10;
export const PLUMBING_ROLES = new Set(['config', 'schema', 'style', 'entry', 'route', 'migration', 'infra', 'script', 'test', 'skill']);

export function loadProject(root) {
    const { records } = loadMap(root);
    const { features, lines: featureLines } = loadFeatures(root);
    const { platforms } = loadPlatforms(root);
    const { systems, lines: systemLines } = loadSystems(root);
    return { records, features, featureLines, platforms, systems, systemLines };
}

export function platformOf(project, record) {
    return project.platforms ? resolvePlatform(project.platforms, record.path) : NO_PLATFORM;
}

function kindOf(project, platformId) {
    return project.platforms?.find((p) => p.id === platformId)?.kind ?? null;
}

export function untaggedByPlatform(project) {
    const rows = new Map();
    for (const record of project.records) {
        const id = platformOf(project, record);
        const row = rows.get(id) ?? { platform: id, kind: kindOf(project, id), records: 0, untagged: 0, featureless: 0 };
        row.records += 1;
        if (record.feature === null) row.featureless += 1;
        if (record.feature === null && !record.plumbing) row.untagged += 1;
        rows.set(id, row);
    }
    return [...rows.values()].map((row) => ({ ...row, share: row.records ? row.untagged / row.records : 0, featurelessShare: row.records ? row.featureless / row.records : 0 })).sort((a, b) => (a.platform < b.platform ? -1 : 1));
}

export function untaggedOverThreshold(rows, key = 'share') {
    return rows.filter((row) => row.records >= MIN_RECORDS_FOR_SHARE && row[key] > MAX_UNTAGGED_SHARE);
}

export function untaggedGaps(rows, key = 'share') {
    const judged = rows.filter((row) => row.kind !== null && row.records >= MIN_RECORDS_FOR_SHARE);
    const gaps = [];
    for (const high of judged) {
        for (const low of judged) {
            if (high.kind === low.kind && high.platform !== low.platform && high[key] - low[key] >= MIN_UNTAGGED_GAP) gaps.push({ kind: high.kind, high, low, gap: high[key] - low[key] });
        }
    }
    return gaps.sort((a, b) => b.gap - a.gap || (a.high.platform + a.low.platform < b.high.platform + b.low.platform ? -1 : 1));
}

export function isReviewable(record) {
    return record.feature === null && !record.plumbing && !PLUMBING_ROLES.has(record.role);
}

const RAW = 'featurelessShare';

export function untaggedReviewPlatforms(project) {
    const rows = untaggedByPlatform(project);
    const gaps = untaggedGaps(rows, RAW);
    const flagged = new Map();
    for (const row of untaggedOverThreshold(rows, RAW)) flagged.set(row.platform, { row, over: true, sibling: null });
    for (const { high, low } of gaps) {
        const known = flagged.get(high.platform);
        if (known?.sibling && known.sibling[RAW] <= low[RAW]) continue;
        flagged.set(high.platform, { row: high, over: known?.over ?? false, sibling: low });
    }
    const out = [];
    for (const [platform, reason] of flagged) {
        const records = project.records.filter((r) => platformOf(project, r) === platform && isReviewable(r)).sort((a, b) => (a.path < b.path ? -1 : 1));
        if (records.length && (reason.over || reason.row.featureless >= MIN_GAP_RECORDS)) out.push({ platform, ...reason, records });
    }
    return out.sort((a, b) => (a.platform < b.platform ? -1 : 1));
}

function featureCountsByPlatform(project) {
    const byPlatform = new Map();
    for (const record of project.records) {
        if (record.feature === null) continue;
        const id = platformOf(project, record);
        const counts = byPlatform.get(id) ?? new Map();
        counts.set(record.feature, (counts.get(record.feature) ?? 0) + 1);
        byPlatform.set(id, counts);
    }
    return byPlatform;
}

function groupDivergence(kind, members, byPlatform) {
    const owners = new Map();
    for (const id of members) {
        for (const [feature, count] of byPlatform.get(id)) owners.set(feature, [...(owners.get(feature) ?? []), { platform: id, records: count }]);
    }
    const only = [...owners].filter(([, list]) => list.length === 1).map(([feature, [owner]]) => ({ feature, ...owner }));
    only.sort((a, b) => b.records - a.records || (a.feature < b.feature ? -1 : 1));
    return { kind, platforms: members, used: owners.size, only, share: owners.size ? only.length / owners.size : 0 };
}

export function divergenceByKind(project) {
    if (!project.platforms) return [];
    const byPlatform = featureCountsByPlatform(project);
    const kinds = new Map();
    for (const platform of project.platforms) {
        if (!byPlatform.has(platform.id)) continue;
        kinds.set(platform.kind, [...(kinds.get(platform.kind) ?? []), platform.id]);
    }
    return [...kinds].filter(([, members]) => members.length > 1).map(([kind, members]) => groupDivergence(kind, members, byPlatform));
}

export function externalStats(project) {
    const used = collectExternals(project.records);
    const counts = useCounts(used);
    const ids = [...used.keys()];
    const findings = vocabularyFindings(project);
    const ofKind = (kind) => findings.filter((f) => f.kind === kind);
    return {
        ids,
        distinct: ids.length,
        listed: project.systems ? ids.filter((id) => project.systems.has(id)).length : null,
        unlisted: ofKind('ext-unlisted').map((f) => f.id),
        singleUse: ids.filter((id) => counts.get(id) === 1),
        nearDuplicates: nearDuplicateGroups([...ids, ...(project.systems ?? [])], counts),
        libraryLike: ofKind('ext-library').map((f) => f.id),
        collisions: findings.filter((f) => f.kind.startsWith('feature-')),
    };
}

export function featureUsage(project) {
    const used = new Set(project.records.map((r) => r.feature).filter(Boolean));
    return { declared: project.features?.size ?? null, used: used.size };
}
