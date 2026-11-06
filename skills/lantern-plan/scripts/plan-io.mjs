import fs from 'node:fs';
import path from 'node:path';
import { PLAN_DIR, PLAN_EXT, SLUG } from './plan-format.mjs';
import { ERROR, say } from './plan-messages.mjs';
import { parsePlan } from './plan-parse.mjs';
import { serializePlan } from './plan-write.mjs';

export class PlanFileError extends Error {}

export function planRel(slug) {
    return `${PLAN_DIR}/${slug}${PLAN_EXT}`;
}

export function resolvePlanPath(root, ref) {
    if (ref.endsWith(PLAN_EXT) || ref.includes('/')) return path.resolve(root, ref);
    if (!SLUG.test(ref)) throw new PlanFileError(say(ERROR.IO_NOT_A_SLUG, { ref }));
    return path.join(root, planRel(ref));
}

export function listPlanSlugs(root) {
    const dir = path.join(root, PLAN_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => name.endsWith(PLAN_EXT)).map((name) => name.slice(0, -PLAN_EXT.length)).sort();
}

export function readPlanFile(file, label = file) {
    if (!fs.existsSync(file)) throw new PlanFileError(say(ERROR.IO_NO_PLAN, { file }));
    return parsePlan(fs.readFileSync(file, 'utf8'), label);
}

export function loadPlan(root, ref) {
    const file = resolvePlanPath(root, ref);
    const parsed = readPlanFile(file);
    if (parsed.errors.length) throw new PlanFileError(say(ERROR.IO_DOES_NOT_PARSE, { label: path.relative(root, file) || file, errors: parsed.errors.join('\n  ') }));
    return { file, plan: parsed.plan, warnings: parsed.warnings };
}

export function savePlan(file, plan) {
    const text = serializePlan(plan);
    const reparsed = parsePlan(text, file);
    if (reparsed.errors.length) throw new PlanFileError(say(ERROR.IO_REFUSE_WRITE, { file, errors: reparsed.errors.join('\n  ') }));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}
