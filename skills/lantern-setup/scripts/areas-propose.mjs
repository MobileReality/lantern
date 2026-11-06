import { isFoundation } from './areas-snapshot.mjs';

export const TOP_PARTNERS = 3;
export const CANDIDATE_GROUP_COUNTS = [4, 5, 6, 7];
export const SYSTEM_AFFINITY_WEIGHT = 0.25;
export const MAX_GROUP_SIZE = 7;
export const SHARED_SYSTEMS_SHOWN = 4;
const SIZE_DECIMALS = 3;

const sum = (values) => values.reduce((a, b) => a + b, 0);
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pairKey = (a, b) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
const round = (x, places) => Number(x.toFixed(places));

function featureTable(snap) {
    const ids = snap.blocks.filter((b) => !isFoundation(b.id)).map((b) => b.id).sort(byId);
    const sizes = new Map(snap.blocks.map((b) => [b.id, b.files]));
    return { ids, sizes };
}

export function pairWeights(snap, ids, sizes) {
    const wanted = new Set(ids);
    const weights = new Map();
    for (const edge of snap.edges) {
        if (!wanted.has(edge.from) || !wanted.has(edge.to)) continue;
        const key = pairKey(edge.from, edge.to);
        const row = weights.get(key) ?? { a: edge.from < edge.to ? edge.from : edge.to, b: edge.from < edge.to ? edge.to : edge.from, lines: 0, filePairs: 0 };
        row.lines += edge.relation_lines;
        row.filePairs += edge.file_pairs ?? 0;
        weights.set(key, row);
    }
    return [...weights.values()]
        .map((row) => ({ ...row, perSize: round(row.lines / Math.sqrt((sizes.get(row.a) || 1) * (sizes.get(row.b) || 1)), SIZE_DECIMALS) }))
        .sort((x, y) => y.lines - x.lines || byId(x.a + x.b, y.a + y.b));
}

function systemsByFeature(snap, ids) {
    const wanted = new Set(ids);
    const used = new Map(ids.map((id) => [id, new Set()]));
    for (const system of snap.external_systems) {
        for (const block of Object.keys(system.used_by)) if (wanted.has(block)) used.get(block).add(system.system);
    }
    return used;
}

function partnersOf(id, weights) {
    return weights
        .filter((w) => w.a === id || w.b === id)
        .map((w) => ({ id: w.a === id ? w.b : w.a, lines: w.lines }))
        .sort((x, y) => y.lines - x.lines || byId(x.id, y.id))
        .slice(0, TOP_PARTNERS);
}

function featureRows(snap, ids, weights) {
    const blocks = new Map(snap.blocks.map((b) => [b.id, b]));
    const systems = systemsByFeature(snap, ids);
    return ids.map((id) => ({
        id,
        files: blocks.get(id).files,
        platforms: blocks.get(id).by_platform ?? {},
        systems: [...systems.get(id)].sort(byId),
        partners: partnersOf(id, weights),
    }));
}

function affinities(ids, weights, systems) {
    const maxLines = Math.max(1, ...weights.map((w) => w.lines));
    const lines = new Map(weights.map((w) => [pairKey(w.a, w.b), w.lines]));
    const jaccard = (a, b) => {
        const shared = [...systems.get(a)].filter((s) => systems.get(b).has(s)).length;
        const union = new Set([...systems.get(a), ...systems.get(b)]).size;
        return union ? shared / union : 0;
    };
    const table = new Map();
    for (const a of ids) for (const b of ids) if (a < b) table.set(pairKey(a, b), (lines.get(pairKey(a, b)) ?? 0) / maxLines + SYSTEM_AFFINITY_WEIGHT * jaccard(a, b));
    return table;
}

function clusterInto(ids, table, count) {
    let clusters = ids.map((id) => [id]);
    const link = (x, y) => sum(x.flatMap((a) => y.map((b) => table.get(pairKey(a, b))))) / (x.length * y.length);
    while (clusters.length > count) {
        let best = null;
        for (let i = 0; i < clusters.length; i += 1) {
            for (let j = i + 1; j < clusters.length; j += 1) {
                if (clusters[i].length + clusters[j].length > MAX_GROUP_SIZE) continue;
                const score = link(clusters[i], clusters[j]) / (clusters[i].length + clusters[j].length);
                if (!best || score > best.score) best = { i, j, score };
            }
        }
        if (!best) break;
        const merged = [...clusters[best.i], ...clusters[best.j]].sort(byId);
        clusters = clusters.filter((_, k) => k !== best.i && k !== best.j);
        clusters.push(merged);
    }
    return clusters.sort((x, y) => byId(x[0], y[0]));
}

function groupRow(members, index, weights, systems) {
    const inGroup = new Set(members);
    const touching = weights.filter((w) => inGroup.has(w.a) || inGroup.has(w.b));
    const inside = touching.filter((w) => inGroup.has(w.a) && inGroup.has(w.b));
    const insideLines = sum(inside.map((w) => w.lines));
    const touchingLines = sum(touching.map((w) => w.lines));
    const counts = new Map();
    for (const id of members) for (const s of systems.get(id)) counts.set(s, (counts.get(s) ?? 0) + 1);
    const shared = [...counts].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || byId(x[0], y[0])).slice(0, SHARED_SYSTEMS_SHOWN).map(([s]) => s);
    return {
        label: `group-${index + 1}`,
        features: members,
        insideLines,
        touchingLines,
        keepsInside: touchingLines ? round(insideLines / touchingLines, 2) : null,
        sharedSystems: shared,
    };
}

function candidateSets(ids, weights, systems) {
    const table = affinities(ids, weights, systems);
    const total = sum(weights.map((w) => w.lines));
    return CANDIDATE_GROUP_COUNTS.filter((count) => count < ids.length).map((count) => {
        const groups = clusterInto(ids, table, count).map((members, i) => groupRow(members, i, weights, systems));
        const inside = sum(groups.map((g) => g.insideLines));
        return { groups: count, insideShare: total ? round(inside / total, 2) : null, groupsList: groups };
    });
}

export function propose(snap) {
    const { ids, sizes } = featureTable(snap);
    const weights = pairWeights(snap, ids, sizes);
    const systems = systemsByFeature(snap, ids);
    return {
        features: featureRows(snap, ids, weights),
        weights,
        candidates: candidateSets(ids, weights, systems),
        foundation: snap.blocks.filter((b) => isFoundation(b.id)).map((b) => b.id),
    };
}

const pct = (share) => (share === null ? 'n/a' : `${Math.round(share * 100)}%`);

function featureLines(rows) {
    return rows.flatMap((f) => {
        const platforms = Object.entries(f.platforms).map(([p, n]) => `${p} ${n}`).join(', ') || 'none';
        const partners = f.partners.map((p) => `${p.id} ${p.lines}`).join(', ') || 'none';
        return [`  ${f.id}  ${f.files} file(s)`, `    platforms: ${platforms}`, `    partners:  ${partners}`, `    systems:   ${f.systems.join(', ') || 'none'}`];
    });
}

function weightLines(weights) {
    if (!weights.length) return ['  none'];
    return [`  ${'pair'.padEnd(48)} lines  file-pairs  per-size`, ...weights.map((w) => `  ${`${w.a} - ${w.b}`.padEnd(48)} ${String(w.lines).padStart(5)}  ${String(w.filePairs).padStart(10)}  ${w.perSize.toFixed(SIZE_DECIMALS)}`)];
}

function candidateLines(candidates) {
    if (!candidates.length) return ['  too few features for candidate groupings'];
    return candidates.flatMap((c) => [
        `  ${c.groups} groups, ${pct(c.insideShare)} of feature-to-feature lines stay inside`,
        ...c.groupsList.flatMap((g) => [`    ${g.label}  keeps ${pct(g.keepsInside)} of the lines that touch it inside; ${g.features.length} feature(s): ${g.features.join(', ')}`, ...(g.sharedSystems.length ? [`      shared outside systems: ${g.sharedSystems.join(', ')}`] : [])]),
    ]);
}

export function renderProposal(result) {
    return [
        `FEATURES (${result.features.length}; core:* blocks excluded${result.foundation.length ? `: ${result.foundation.join(', ')}` : ''})`,
        ...featureLines(result.features),
        '',
        'FEATURE-TO-FEATURE WEIGHTS (only lines are used; file pairs and per-size are printed for comparison)',
        ...weightLines(result.weights),
        '',
        'CANDIDATE GROUPS (unnamed; coupling is not product function, so overrule a group and name the areas yourself)',
        ...candidateLines(result.candidates),
    ].join('\n');
}
