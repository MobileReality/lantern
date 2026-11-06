import fs from 'node:fs';
import path from 'node:path';
import { isFoundation } from './areas-snapshot.mjs';

export const MIN_LOOKUP = 0.75;
export const MANIFEST_NAME = 'manifest.json';
export const QUESTION = 'Which area would you look in for this feature? Answer with exactly one area id from the list and nothing else.';

const WRAPPERS = /^["'`\s]+|["'`\s.]+$/g;

export const normaliseAnswer = (answer) => String(answer).replace(WRAPPERS, '').toLowerCase();

function skipReason(id, areaOf, texts) {
    if (!areaOf.has(id)) return 'in To assign';
    if (!texts[id]) return 'no primary-language text';
    return null;
}

export function planLookup(snap, groups) {
    const offered = Object.keys(groups);
    const areaOf = new Map(Object.entries(groups).flatMap(([area, ids]) => ids.map((id) => [id, area])));
    const ids = snap.blocks.filter((b) => !isFoundation(b.id)).map((b) => b.id).sort();
    const texts = snap.feature_texts ?? {};
    const skipped = ids.map((id) => ({ id, reason: skipReason(id, areaOf, texts) })).filter((s) => s.reason);
    const answerable = ids.filter((id) => !skipped.some((s) => s.id === id));
    return { offered, answerable, skipped, areaOf, texts };
}

export function renderPacket(plan, purposes, id) {
    const areas = plan.offered.map((area) => `- ${area}: ${purposes[area] ?? ''}`);
    return ['Areas:', ...areas, '', 'Feature:', plan.texts[id], '', QUESTION, ''].join('\n');
}

export function buildPackets(plan, purposes) {
    return plan.answerable.map((id) => ({ file: `${id}.txt`, feature: id, text: renderPacket(plan, purposes, id) }));
}

function listedPackets(dir) {
    try {
        const listed = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')));
        return listed.filter((name) => name === path.basename(name) && name.endsWith('.txt'));
    } catch {
        return [];
    }
}

export function writePackets(dir, packets) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of listedPackets(dir)) fs.rmSync(path.join(dir, name), { force: true });
    for (const p of packets) fs.writeFileSync(path.join(dir, p.file), p.text);
    const manifest = Object.fromEntries(packets.map((p) => [p.file, p.feature]));
    fs.writeFileSync(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 1)}\n`);
}

export function scoreAnswers(plan, answers) {
    const missing = plan.answerable.filter((id) => !(id in answers));
    const unknown = Object.keys(answers).filter((id) => !plan.answerable.includes(id)).sort();
    const scored = plan.answerable.filter((id) => id in answers).map((id) => ({ feature: id, real: plan.areaOf.get(id), chosen: normaliseAnswer(answers[id]), raw: answers[id] }));
    const misplaced = scored.filter((s) => s.chosen !== s.real);
    const total = plan.answerable.length;
    const score = total ? (scored.length - misplaced.length) / total : 0;
    const chance = plan.offered.length ? 1 / plan.offered.length : 0;
    return { score, chance, total, missing, unknown, misplaced, passed: total > 0 && score >= MIN_LOOKUP && !missing.length };
}
