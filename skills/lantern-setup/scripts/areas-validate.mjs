import { AREAS_FILE, LIMITS, TAG, loadAreaTexts, loadAreas } from './areas-file.mjs';
import { areasLangFile, listLangs } from './texts.mjs';
import { CHANNEL_WORDS, GENERIC_WORDS, collectExternals, loadSystems, nameTokens, namesId } from './vocabulary.mjs';

const ERROR = 'error';
const WARNING = 'warning';

function finding(level, line, message) {
    return { level, message: `${AREAS_FILE}:${line}: ${TAG} ${message}` };
}

function placementFindings(areas, features) {
    const out = [];
    const placed = new Map();
    const declared = features ? [...features.keys()].join(', ') || 'none' : null;
    for (const area of areas) {
        for (const child of area.children) {
            const first = placed.get(child.id);
            if (first) out.push(finding(ERROR, child.line, `feature "${child.id}" is listed twice (first in area "${first.area}" at line ${first.line}); list it once, delete this line`));
            else if (!features?.has(child.id)) {
                const where = declared === null ? 'is not declared because .lantern/features does not exist' : `is not declared in .lantern/features (declared: ${declared})`;
                out.push(finding(ERROR, child.line, `unknown feature "${child.id}": it ${where}; use a declared feature id or delete this line`));
            } else placed.set(child.id, { area: area.id, line: child.line });
        }
    }
    return { out, placed };
}

function unplacedFindings(features, featureLines, usedFeatures, placed) {
    return [...(features?.keys() ?? [])]
        .filter((id) => usedFeatures.has(id) && !placed.has(id))
        .map((id) => ({ level: WARNING, message: `.lantern/features:${featureLines.get(id) ?? 1}: ${TAG} feature "${id}" has records but is in no area, so it shows in "To assign"; add it under an area in ${AREAS_FILE}` }));
}

function sameIdFindings(area, taken) {
    return taken.filter((t) => t.id === area.id).map((t) => finding(ERROR, area.line, `area "${area.id}" is also a ${t.kind} id; rename the area after the product function it groups`));
}

function wordFindings(area, others, strict) {
    const level = strict ? ERROR : WARNING;
    const tail = 'name the product function users recognise, not where it runs or who supplies it';
    const out = others.filter((o) => o.id !== area.id && namesId(area.id, o.id)).map((o) => finding(level, area.line, `area "${area.id}" contains the ${o.kind} id "${o.id}" as a whole word; ${tail}`));
    const word = nameTokens(area.id).find((t) => CHANNEL_WORDS.has(t) || GENERIC_WORDS.has(t));
    if (word) out.push(finding(level, area.line, `area "${area.id}" contains the channel or layer word "${word}"; ${tail}`));
    return out;
}

function areaIdFindings(areas, features, platforms, systemIds, strict) {
    const kinds = [
        ...[...(features?.keys() ?? [])].map((id) => ({ id, kind: 'feature' })),
        ...platforms.map((p) => ({ id: p.id, kind: 'platform' })),
        ...systemIds.map((id) => ({ id, kind: 'outside-system' })),
    ];
    const seen = new Map();
    return areas.flatMap((area) => {
        const out = [];
        if (seen.has(area.id)) out.push(finding(ERROR, area.line, `area "${area.id}" is declared twice (first at line ${seen.get(area.id)}); area ids are unique, merge the two or rename one`));
        else seen.set(area.id, area.line);
        out.push(...sameIdFindings(area, kinds), ...wordFindings(area, kinds.filter((k) => k.kind !== 'feature'), strict));
        if (nameTokens(area.id).length < 2) out.push(finding(WARNING, area.line, `area "${area.id}" is a single word; use two or more words that say the product function`));
        return out;
    });
}

function shapeFindings(areas) {
    const out = [];
    if (areas.length > LIMITS.maxAreas) out.push(finding(ERROR, areas[LIMITS.maxAreas].line, `${areas.length} areas, at most ${LIMITS.maxAreas} are allowed; merge areas from this line on`));
    else if (areas.length < LIMITS.minComfortAreas || areas.length > LIMITS.maxComfortAreas) out.push(finding(WARNING, areas[0]?.line ?? 1, `${areas.length} area(s); ${LIMITS.minComfortAreas} to ${LIMITS.maxComfortAreas} read best (a quiet seventh is fine)`));
    for (const area of areas) {
        const n = area.children.length;
        if (n === 0) out.push(finding(ERROR, area.line, `area "${area.id}" has no children; put feature ids under it, or delete the line`));
        else if (n > LIMITS.maxChildren) out.push(finding(ERROR, area.line, `area "${area.id}" has ${n} children, at most ${LIMITS.maxChildren} are allowed; split it into two areas`));
        else if (n === 1) out.push(finding(WARNING, area.line, `area "${area.id}" has one child; add a related feature, or fold it into another area`));
    }
    return out;
}

function textFindings(root, areas, primary) {
    const ids = new Set(areas.map((a) => a.id));
    const out = [];
    const codes = [...new Set([primary, ...listLangs(root)])];
    for (const code of codes) {
        const parsed = loadAreaTexts(root, code);
        const isPrimary = code === primary;
        if (parsed.error) {
            out.push({ level: isPrimary ? ERROR : WARNING, message: parsed.error });
            continue;
        }
        for (const key of Object.keys(parsed.text)) {
            if (!ids.has(key)) out.push({ level: WARNING, message: `${parsed.file}: ${TAG} orphan key "${key}" matches no area in ${AREAS_FILE}; delete it or add the area` });
        }
        if (!isPrimary) continue;
        for (const area of areas) {
            if (!parsed.text[area.id]) out.push(finding(WARNING, area.line, `area "${area.id}" has no ${primary} text; add one sentence for it to ${areasLangFile(primary)}`));
        }
    }
    return out;
}

function summarize(findings) {
    const errors = findings.filter((f) => f.level === ERROR).length;
    const warnings = findings.length - errors;
    return findings.length ? `areas: ${findings.length} finding(s) (${errors} error(s), ${warnings} warning(s))` : 'areas: OK';
}

export function checkAreas(root, input, strict) {
    const loaded = loadAreas(root);
    if (!loaded.exists) return { exists: false, errors: [], warnings: [], summary: [] };
    const { features, featureLines, records, platforms, primary } = input;
    const systemIds = [...new Set([...(loadSystems(root).systems ?? []), ...collectExternals(records).keys()])];
    const usedFeatures = new Set(records.map((r) => r.feature));
    const placement = placementFindings(loaded.areas, features);
    const findings = [
        ...loaded.errors.map((e) => ({ level: ERROR, message: e.message })),
        ...placement.out,
        ...unplacedFindings(features, featureLines, usedFeatures, placement.placed),
        ...areaIdFindings(loaded.areas, features, platforms ?? [], systemIds, strict),
        ...shapeFindings(loaded.areas),
        ...textFindings(root, loaded.areas, primary),
    ];
    return {
        exists: true,
        errors: findings.filter((f) => f.level === ERROR).map((f) => f.message),
        warnings: findings.filter((f) => f.level === WARNING).map((f) => f.message),
        summary: [summarize(findings)],
    };
}
