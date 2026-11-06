import { isFoundation } from './areas-snapshot.mjs';
import { CHANNEL_WORDS, GENERIC_WORDS } from './vocabulary.mjs';

export const GATE_LIMITS = {
    areas: [4, 7],
    children: [1, 7],
    singleChildAreas: 2,
    minCohesionLift: 0.5,
    nameWords: [2, 4],
    nameChars: 32,
    purposeWords: [4, 20],
    stemLength: 5,
    randomDraws: 1000,
    randomSeed: 1,
};
export const STOP_WORDS = new Set(['and', 'of', 'the', 'for', 'to', 'in', 'a']);

const MIN_CONTENT_WORD = 3;
const NOT_ONE_SENTENCE = /[.!?]\s+\S/;

const sum = (values) => values.reduce((a, b) => a + b, 0);
const outside = (n, [low, high]) => n < low || n > high;
const range = ([low, high]) => `${low} to ${high}`;
const unique = (values) => [...new Set(values)];

export const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const content = (text) => words(text).filter((w) => w.length >= MIN_CONTENT_WORD && !STOP_WORDS.has(w));
const stems = (text) => new Set(content(text).map((w) => w.slice(0, GATE_LIMITS.stemLength)));

function seeded(seed) {
    let s = seed;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomGroupings(ids, sizes) {
    const rnd = seeded(GATE_LIMITS.randomSeed);
    return Array.from({ length: GATE_LIMITS.randomDraws }, () => {
        const order = [...ids];
        for (let i = order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rnd() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        let at = 0;
        return sizes.map((n) => {
            const start = at;
            at += n;
            return order.slice(start, at);
        });
    });
}

function context(snap, groups, purposes) {
    const ids = snap.blocks.filter((b) => !isFoundation(b.id)).map((b) => b.id).sort();
    const names = Object.keys(groups);
    const placed = names.flatMap((n) => groups[n]);
    const known = new Set([...ids, ...(snap.declared_features ?? [])]);
    return { snap, groups, purposes, ids, names, placed, known, times: (id) => placed.filter((p) => p === id).length };
}

function placedOnce(ctx, allowUnassigned) {
    const { ids, names, groups, placed, known, times } = ctx;
    const unassigned = ids.filter((id) => times(id) === 0);
    const missing = allowUnassigned ? [] : unassigned.map((id) => `${id} is in no area ("To assign"); put it under the area whose purpose fits it`);
    const twice = unique(placed.filter((id) => times(id) > 1)).map((id) => `${id} is in ${times(id)} areas (${names.filter((n) => groups[n].includes(id)).join(', ')}); keep it in exactly one`);
    const unknown = unique(placed.filter((id) => !known.has(id))).map((id) => `${id} (in ${names.find((n) => groups[n].includes(id))}) is not a feature with records; use a declared feature id or delete it`);
    const tail = allowUnassigned && unassigned.length ? `, ${unassigned.length} in "To assign" (allowed)` : '';
    return { name: 'placed-once', summary: `${ids.length} features${tail}`, reasons: [...missing, ...twice, ...unknown], hint: 'every feature with records is a leaf of exactly one area', unassigned };
}

function areaCount(ctx) {
    const { names } = ctx;
    const [low, high] = GATE_LIMITS.areas;
    const reasons = names.length < low ? [`${names.length} areas, at least ${low} are needed; split an area whose features serve two product functions`] : names.length > high ? [`${names.length} areas, at most ${high} are allowed; merge the closest areas`] : [];
    return { name: 'area-count', summary: `${names.length} areas, allowed ${range(GATE_LIMITS.areas)}`, reasons, hint: 'regroup so the top level has a count a screen can hold' };
}

function fanOut(ctx) {
    const { names, groups } = ctx;
    const singles = names.filter((n) => groups[n].length === 1);
    const reasons = [
        ...names.filter((n) => outside(groups[n].length, GATE_LIMITS.children)).map((n) => `${n} has ${groups[n].length} children, allowed ${range(GATE_LIMITS.children)}; ${groups[n].length ? 'split it into two areas' : 'add a feature or delete it'}`),
        ...(singles.length > GATE_LIMITS.singleChildAreas ? [`${singles.length} single-child areas (${singles.join(', ')}), at most ${GATE_LIMITS.singleChildAreas} are allowed; fold one into a related area`] : []),
    ];
    return { name: 'fan-out', summary: `children per area ${names.map((n) => groups[n].length).join(' ')}, single-child areas ${singles.length} of ${GATE_LIMITS.singleChildAreas} allowed`, reasons, hint: 'keep every area to a handful of features' };
}

function featureEdges(snap) {
    return snap.edges.filter((e) => !isFoundation(e.from) && !isFoundation(e.to));
}

function insideShare(edges, lists) {
    const of = new Map(lists.flatMap((list, i) => list.map((id) => [id, i])));
    const total = sum(edges.map((e) => e.relation_lines));
    if (!total) return null;
    return sum(edges.filter((e) => of.has(e.from) && of.get(e.from) === of.get(e.to)).map((e) => e.relation_lines)) / total;
}

function cohesion(ctx) {
    const { snap, groups, names, ids } = ctx;
    const edges = featureEdges(snap);
    const lists = names.map((n) => unique(groups[n].filter((id) => ids.includes(id))));
    const mine = insideShare(edges, lists);
    const floor = GATE_LIMITS.minCohesionLift;
    if (mine === null) return { name: 'cohesion', summary: 'no feature-to-feature relation lines, nothing to compare', reasons: [], hint: '' };
    const draws = randomGroupings(ids, lists.map((l) => l.length)).map((l) => insideShare(edges, l));
    const mean = sum(draws) / draws.length;
    const lift = mean ? mine / mean : Number.POSITIVE_INFINITY;
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    const summary = `inside share ${pct(mine)} of feature-to-feature lines, random groupings of the same sizes ${pct(mean)} (${GATE_LIMITS.randomDraws} draws), lift ${Number.isFinite(lift) ? lift.toFixed(2) : 'n/a'} (floor ${floor})`;
    const reasons = lift < floor ? [`areas split strongly coupled features more than chance (lift ${lift.toFixed(2)}, floor ${floor}); move the features that call each other into one area (see the partners in propose)`] : [];
    return { name: 'cohesion', summary, reasons, hint: 'regroup coupled features together' };
}

function bannedWords(ctx) {
    const { snap } = ctx;
    return new Set([...CHANNEL_WORDS, ...snap.platforms.flatMap((p) => words(p.id)), ...snap.external_systems.map((s) => words(s.system)[0]).filter(Boolean)]);
}

function nameWords(ctx) {
    const { names } = ctx;
    const banned = bannedWords(ctx);
    const layerWords = new Set([...GENERIC_WORDS, ...CHANNEL_WORDS]);
    const reasons = names.flatMap((n) => [
        ...content(n).filter((w) => banned.has(w)).map((w) => `${n}: '${w}' is a platform, channel or vendor word`),
        ...(layerWords.has(content(n)[0]) ? [`${n}: main word '${content(n)[0]}' is a technical layer or filler`] : []),
    ]);
    return { name: 'name-words', summary: `${names.length} names against ${banned.size} platform, channel and vendor words and ${GENERIC_WORDS.size} generic words`, reasons, hint: 'name the product function users recognise, not where it runs, who supplies it, or a technical layer' };
}

function idKind(ctx, name) {
    if (ctx.ids.includes(name) || ctx.known.has(name)) return 'feature';
    if (ctx.snap.platforms.some((p) => p.id === name)) return 'platform';
    if (ctx.snap.external_systems.some((s) => s.system === name)) return 'system';
    return null;
}

function nameShape(ctx) {
    const { names } = ctx;
    const keyOf = (n) => [...stems(n)].sort().join(' ');
    const reasons = names.flatMap((n) => {
        const kind = idKind(ctx, n);
        const same = names.filter((m) => m !== n && keyOf(m) === keyOf(n));
        return [
            ...(outside(words(n).length, GATE_LIMITS.nameWords) ? [`${n}: ${words(n).length} word(s), allowed ${range(GATE_LIMITS.nameWords)}`] : []),
            ...(n.length > GATE_LIMITS.nameChars ? [`${n}: ${n.length} characters, at most ${GATE_LIMITS.nameChars}`] : []),
            ...(kind ? [`${n}: equals a ${kind} id; name the product function the features serve`] : []),
            ...(same.length ? [`${n}: same as ${same.join(', ')} once normalised; merge them or rename one`] : []),
        ];
    });
    return { name: 'name-shape', summary: `${range(GATE_LIMITS.nameWords)} words, at most ${GATE_LIMITS.nameChars} characters, unique after normalisation`, reasons, hint: 'short, distinct, and not an existing id' };
}

function nameAnchor(ctx) {
    const { names, groups, purposes, snap } = ctx;
    const reasons = names.filter((n) => {
        const evidence = stems([purposes[n] ?? '', ...groups[n], ...groups[n].map((id) => snap.feature_texts?.[id] ?? '')].join(' '));
        return ![...stems(n)].some((s) => evidence.has(s));
    }).map((n) => `${n}: shares no word with its purpose or its features; use a word from the purpose or from a member feature`);
    return { name: 'name-anchor', summary: `a name shares a stem (${GATE_LIMITS.stemLength} letters) with its purpose or with a member feature id or text`, reasons, hint: 'the name should say what the members do' };
}

function purposeReasons(name, text) {
    if (!text) return [`${name}: purpose missing; write one sentence of ${range(GATE_LIMITS.purposeWords)} words in the areas text file`];
    const count = words(text).length;
    return [
        ...(outside(count, GATE_LIMITS.purposeWords) ? [`${name}: purpose has ${count} word(s), allowed ${range(GATE_LIMITS.purposeWords)}`] : []),
        ...(NOT_ONE_SENTENCE.test(text) ? [`${name}: purpose is more than one sentence; keep one`] : []),
    ];
}

function purpose(ctx) {
    const reasons = ctx.names.flatMap((n) => purposeReasons(n, ctx.purposes[n] ?? ''));
    return { name: 'purpose', summary: `one sentence of ${range(GATE_LIMITS.purposeWords)} words`, reasons, hint: 'each area has a one-sentence purpose' };
}

export function runGate(snap, groups, purposes, { allowUnassigned = false } = {}) {
    const ctx = context(snap, groups, purposes);
    const results = [placedOnce(ctx, allowUnassigned), areaCount(ctx), fanOut(ctx), cohesion(ctx), nameWords(ctx), nameShape(ctx), nameAnchor(ctx), purpose(ctx)];
    return { results, unassigned: results[0].unassigned, failed: results.filter((r) => r.reasons.length) };
}
