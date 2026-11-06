import { cmp } from '../../lantern-setup/scripts/shell.mjs';
import { TARGET_KIND } from './plan-format.mjs';
import { describeFile } from './plan-map.mjs';
import { ERROR, LINE, NOUN, plural, say } from './plan-messages.mjs';

export const MAX_DEPTH = 4;
export const DEFAULT_DEPTH = 2;

function filesUnder(map, prefix) {
    const dir = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return [...map.byPath.keys()].filter((p) => p.startsWith(dir));
}

function filesOfPathSeed(map, value) {
    if (map.byPath.has(value)) return [value];
    const under = filesUnder(map, value);
    return under.length ? under : null;
}

const SEED_FILES = {
    [TARGET_KIND.FEATURE]: (map, value) => (map.filesOfFeature.has(value) ? [...map.filesOfFeature.get(value)] : null),
    [TARGET_KIND.AREA]: (map, value) => (map.areas.featuresOf.has(value) ? map.areas.featuresOf.get(value).flatMap((f) => [...(map.filesOfFeature.get(f) ?? [])]) : null),
    [TARGET_KIND.FILE]: filesOfPathSeed,
};

const filesOfSeed = (map, kind, value) => SEED_FILES[kind](map, value);

export function resolveSeeds(map, { files = [], features = [], areas = [] }) {
    const seeds = new Set();
    const problems = [];
    const groups = [[TARGET_KIND.FILE, files], [TARGET_KIND.FEATURE, features], [TARGET_KIND.AREA, areas]];
    for (const [kind, values] of groups) {
        for (const value of values) {
            const found = filesOfSeed(map, kind, value);
            if (found === null) problems.push(say(ERROR.IMPACT_NOT_IN_MAP, { kind, value }));
            else found.forEach((p) => { seeds.add(p); });
        }
    }
    if (seeds.size === 0 && problems.length === 0) problems.push(say(ERROR.IMPACT_NEEDS_SEED));
    return { seeds, problems };
}

function walk(startPaths, next, depth) {
    const reached = new Map();
    let frontier = new Set(startPaths);
    const known = new Set(startPaths);
    for (let level = 1; level <= depth && frontier.size; level++) {
        const layer = new Set();
        for (const from of frontier) {
            for (const to of next.get(from) ?? []) {
                if (known.has(to)) continue;
                if (!reached.has(to)) reached.set(to, { depth: level, via: new Set() });
                reached.get(to).via.add(from);
                layer.add(to);
            }
        }
        layer.forEach((p) => { known.add(p); });
        frontier = layer;
    }
    return reached;
}

function listReached(map, reached) {
    return [...reached.entries()]
        .map(([filePath, { depth, via }]) => ({ ...describeFile(map, filePath), depth, via: [...via].sort(cmp) }))
        .sort((a, b) => a.depth - b.depth || b.via.length - a.via.length || cmp(a.path, b.path));
}

function rollup(entries, keyOf) {
    const counts = new Map();
    for (const [role, list] of entries) {
        for (const entry of list) {
            const key = keyOf(entry);
            if (!key) continue;
            if (!counts.has(key)) counts.set(key, { id: key, seeds: 0, dependents: 0, dependencies: 0 });
            counts.get(key)[role] += 1;
        }
    }
    return [...counts.values()].sort((a, b) => b.seeds + b.dependents + b.dependencies - (a.seeds + a.dependents + a.dependencies) || cmp(a.id, b.id));
}

function systemsOf(map, seeds) {
    const counts = new Map();
    for (const filePath of seeds) for (const system of map.systems.get(filePath) ?? []) counts.set(system, (counts.get(system) ?? 0) + 1);
    return [...counts].map(([id, files]) => ({ id, files })).sort((a, b) => b.files - a.files || cmp(a.id, b.id));
}

export function computeImpact(map, seedPaths, depth = DEFAULT_DEPTH) {
    const seeds = [...seedPaths].sort(cmp);
    const dependents = listReached(map, walk(seeds, map.dependents, depth));
    const dependencies = listReached(map, walk(seeds, map.dependencies, depth));
    const seedEntries = seeds.map((p) => describeFile(map, p));
    const groups = [['seeds', seedEntries], ['dependents', dependents], ['dependencies', dependencies]];
    return {
        depth,
        counts: { seeds: seeds.length, dependents: dependents.length, dependencies: dependencies.length },
        seeds: seedEntries,
        dependents,
        dependencies,
        features: rollup(groups, (entry) => entry.feature).map((f) => ({ ...f, area: map.areas.areaOf.get(f.id) ?? null })),
        areas: rollup(groups, (entry) => entry.area),
        systems: systemsOf(map, seeds),
    };
}

function fileLine(entry) {
    const tags = [entry.role, entry.feature, entry.area].filter(Boolean).join(' / ');
    const via = entry.via ? say(LINE.IMPACT_VIA, { links: entry.via.length, noun: plural(entry.via.length, NOUN.LINK_ONE, NOUN.LINK_MANY), depth: entry.depth }) : '';
    return say(LINE.IMPACT_FILE, { path: entry.path, tags: tags ? say(LINE.IMPACT_TAGS, { tags }) : '', via });
}

const rollupLine = (entry) => say(LINE.IMPACT_ROLLUP, { ...entry, area: entry.area ? say(LINE.IMPACT_AREA, { area: entry.area }) : '' });

const systemLine = (system) => say(LINE.IMPACT_SYSTEM, system);

export function formatImpact(result) {
    const { counts } = result;
    const lines = [say(LINE.IMPACT_HEAD, { ...counts, depth: result.depth, noun: plural(counts.dependencies, NOUN.DEPENDENCY_ONE, NOUN.DEPENDENCY_MANY) })];
    const direct = (list) => list.filter((entry) => entry.depth === 1);
    const further = (list) => list.filter((entry) => entry.depth > 1);
    const sections = [
        [NOUN.IMPACT_SEEDS, result.seeds, fileLine],
        [NOUN.IMPACT_DEPENDENTS, direct(result.dependents), fileLine],
        [NOUN.IMPACT_DEPENDENTS_FURTHER, further(result.dependents), fileLine],
        [NOUN.IMPACT_DEPENDENCIES, direct(result.dependencies), fileLine],
        [NOUN.IMPACT_DEPENDENCIES_FURTHER, further(result.dependencies), fileLine],
        [NOUN.IMPACT_BY_FEATURE, result.features, rollupLine],
        [NOUN.IMPACT_BY_AREA, result.areas, rollupLine],
        [NOUN.IMPACT_SYSTEMS, result.systems, systemLine],
    ];
    for (const [title, list, format] of sections) {
        if (list.length) lines.push(say(LINE.IMPACT_SECTION, { title: say(title) }), ...list.map(format));
    }
    lines.push(say(LINE.IMPACT_NEXT));
    return lines;
}
