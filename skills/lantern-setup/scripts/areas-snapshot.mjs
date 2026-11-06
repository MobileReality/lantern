import { loadFeatures, loadMap, readLang } from './lib.mjs';
import { platformOf } from './macro-stats.mjs';
import { loadPlatforms } from './platforms.mjs';
import { loadLang, primaryFeatureText } from './texts.mjs';
import { loadSystems } from './vocabulary.mjs';

export const FOUNDATION_PREFIX = 'core:';
const TEST_ROLE = 'test';

export const isFoundation = (id) => id.startsWith(FOUNDATION_PREFIX);

function bump(map, key, n = 1) {
    map.set(key, (map.get(key) ?? 0) + n);
}

function blockOf(project, record) {
    return record.feature ?? `${FOUNDATION_PREFIX}${platformOf(project, record)}`;
}

function blocksOf(records, project) {
    const blocks = new Map();
    for (const record of records) {
        const id = blockOf(project, record);
        const block = blocks.get(id) ?? { id, files: 0, by_platform: new Map() };
        block.files += 1;
        bump(block.by_platform, platformOf(project, record));
        blocks.set(id, block);
    }
    return [...blocks.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((b) => ({ ...b, by_platform: Object.fromEntries([...b.by_platform].sort(([x], [y]) => (x < y ? -1 : 1))) }));
}

function edgesAndSystems(records, project) {
    const shipped = records.filter((r) => r.role !== TEST_ROLE);
    const blockByPath = new Map(shipped.map((r) => [r.path, blockOf(project, r)]));
    const edges = new Map();
    const pairs = new Map();
    const systems = new Map();
    for (const record of shipped) {
        const from = blockOf(project, record);
        for (const relation of record.relations) {
            if (relation.external !== null) {
                const used = systems.get(relation.external) ?? new Map();
                bump(used, from);
                systems.set(relation.external, used);
                continue;
            }
            const to = blockByPath.get(relation.path);
            if (!to || to === from) continue;
            const key = `${from}\n${to}`;
            bump(edges, key);
            const seen = pairs.get(key) ?? new Set();
            seen.add(`${record.path}\n${relation.path}`);
            pairs.set(key, seen);
        }
    }
    const edgeList = [...edges].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, lines]) => {
        const [from, to] = key.split('\n');
        return { from, to, relation_lines: lines, file_pairs: pairs.get(key).size };
    });
    const systemList = [...systems].sort(([a], [b]) => (a < b ? -1 : 1)).map(([system, used]) => ({ system, used_by: Object.fromEntries([...used].sort(([x], [y]) => (x < y ? -1 : 1))) }));
    return { edges: edgeList, external_systems: systemList };
}

export function snapshotFromMap(root) {
    const { records } = loadMap(root);
    const { features } = loadFeatures(root);
    const { platforms } = loadPlatforms(root);
    const { systems } = loadSystems(root);
    const project = { platforms };
    const primary = readLang(root);
    const langs = new Map([[primary, loadLang(root, primary)]]);
    const blocks = blocksOf(records, project);
    const used = new Set(blocks.filter((b) => !isFoundation(b.id)).map((b) => b.id));
    const feature_texts = Object.fromEntries([...used].sort().map((id) => [id, primaryFeatureText(langs, primary, id, features?.get(id)) ?? '']));
    const { edges, external_systems } = edgesAndSystems(records, project);
    const listedOnly = [...(systems ?? [])].filter((id) => !external_systems.some((s) => s.system === id)).sort();
    return {
        records: records.length,
        blocks,
        edges,
        external_systems: [...external_systems, ...listedOnly.map((system) => ({ system, used_by: {} }))],
        platforms: (platforms ?? []).map((p) => ({ id: p.id })),
        feature_texts,
        declared_features: [...(features?.keys() ?? [])].sort(),
    };
}
