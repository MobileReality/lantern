import fs from 'node:fs';
import path from 'node:path';
import { TAG, TARGET_KIND, tagLine } from './plan-format.mjs';
import { git } from './plan-git.mjs';
import { areaOfPath } from './plan-map.mjs';
import { ERROR, WARNING, located, say } from './plan-messages.mjs';
import { allItems } from './plan-model.mjs';
import { shapeProblems } from './plan-shape.mjs';

const VERDICT = Object.freeze({ ERROR: 'error', WARNING: 'warning' });

function wasInHistory(root, filePath) {
    const out = git(root, ['log', '--all', '-1', '--format=%h', '--', filePath]);
    return out !== null && out.trim() !== '';
}

const MISSING_FILE_VERDICTS = [
    [(root, filePath) => fs.existsSync(path.join(root, filePath)), VERDICT.ERROR, ERROR.FILE_NOT_IN_MAP],
    [wasInHistory, VERDICT.WARNING, WARNING.FILE_DELETED],
    [() => true, VERDICT.ERROR, ERROR.FILE_NEVER_MAPPED],
];

function missingFile(root, filePath) {
    const [, severity, code] = MISSING_FILE_VERDICTS.find(([applies]) => applies(root, filePath));
    return { [severity]: say(code, { path: filePath }) };
}

const NEW_FILE_VERDICTS = [
    [(map, target) => map.byPath.has(target), WARNING.NEW_IN_MAP],
    [(map, target, root) => fs.existsSync(path.join(root, target)), WARNING.NEW_ON_DISK],
];

function newFile(root, map, target) {
    const verdict = NEW_FILE_VERDICTS.find(([applies]) => applies(map, target, root));
    return verdict ? { warning: say(verdict[1], { path: target }) } : {};
}

const TARGET_CHECKS = {
    [TARGET_KIND.FEATURE](root, map, target) {
        if (map.features === null) return { error: say(ERROR.NO_FEATURES) };
        return map.features.has(target) ? {} : { error: say(ERROR.FEATURE_UNKNOWN, { target, known: [...map.features].join(', ') }) };
    },
    [TARGET_KIND.AREA](root, map, target) {
        if (!map.areas.exists) return { error: say(ERROR.NO_AREAS) };
        return map.areas.featuresOf.has(target) ? {} : { error: say(ERROR.AREA_UNKNOWN, { target, known: [...map.areas.featuresOf.keys()].join(', ') }) };
    },
    [TARGET_KIND.FILE]: (root, map, target) => (map.byPath.has(target) ? {} : missingFile(root, target)),
    [TARGET_KIND.NEW]: newFile,
};

const targetProblem = (root, map, kind, target) => TARGET_CHECKS[kind](root, map, target);

const touchWhere = (owner, touch) => `${owner} ${tagLine(TAG.TOUCH, touch.kind, touch.target)}`;

function flowFiles(question) {
    return [...new Set(question.flow.flatMap((story) => [...story.steps, ...story.below]).flatMap((step) => step.files ?? []))];
}

function questionTargets(plan, question) {
    const described = new Set(plan.impact.filter((entry) => entry.kind === TARGET_KIND.NEW).map((entry) => entry.target));
    const files = flowFiles(question).map((target) => ({ kind: described.has(target) ? TARGET_KIND.NEW : TARGET_KIND.FILE, target, where: `${question.id} ${tagLine(TAG.FILE, target)}` }));
    return [...question.touches.map((touch) => ({ ...touch, where: touchWhere(question.id, touch) })), ...files];
}

function namedTargets(plan) {
    return [
        ...plan.impact.map((entry) => ({ ...entry, where: tagLine(TAG.IMPACT, entry.kind, entry.target) })),
        ...plan.stages.flatMap((stage) => [
            ...stage.touches.map((touch) => ({ ...touch, where: touchWhere(stage.id, touch) })),
            ...stage.items.flatMap((item) => item.touches.map((touch) => ({ ...touch, where: touchWhere(item.id, touch) }))),
            ...stage.questions.flatMap((question) => questionTargets(plan, question)),
        ]),
    ];
}

function mapProblems(root, map, plan) {
    const verdicts = new Map();
    const found = { error: [], warning: [] };
    for (const entry of namedTargets(plan)) {
        const key = `${entry.kind} ${entry.target}`;
        if (!verdicts.has(key)) verdicts.set(key, targetProblem(root, map, entry.kind, entry.target));
        for (const severity of Object.values(VERDICT)) if (verdicts.get(key)[severity]) found[severity].push(located(entry.where, verdicts.get(key)[severity]));
    }
    return { errors: found[VERDICT.ERROR], warnings: found[VERDICT.WARNING] };
}

const COVERAGE_BY_KIND = {
    [TARGET_KIND.NEW]: () => true,
    [TARGET_KIND.AREA]: () => false,
    [TARGET_KIND.FEATURE]: (map, listed, target) => listed(TARGET_KIND.AREA, map.areas.areaOf.get(target)),
    [TARGET_KIND.FILE]: (map, listed, target) => listed(TARGET_KIND.FEATURE, map.byPath.get(target)?.feature) || listed(TARGET_KIND.AREA, areaOfPath(map, target)),
};

function coveredByImpact(map, plan, touch) {
    const listed = (kind, target) => plan.impact.some((e) => e.kind === kind && e.target === target);
    return listed(touch.kind, touch.target) || COVERAGE_BY_KIND[touch.kind](map, listed, touch.target);
}

function coverageWarnings(map, plan) {
    const owners = [...plan.stages.map((s) => ({ id: s.id, touches: s.touches })), ...allItems(plan).map((i) => ({ id: i.id, touches: i.touches }))];
    return owners.flatMap(({ id, touches }) =>
        touches
            .filter((t) => map.byPath.has(t.target) || t.kind !== TARGET_KIND.FILE)
            .filter((t) => !coveredByImpact(map, plan, t))
            .map((t) => say(WARNING.NOT_COVERED, { id, kind: t.kind, target: t.target })),
    );
}

function purposeProblems(plan) {
    const described = new Set(plan.impact.filter((entry) => entry.kind === TARGET_KIND.NEW).map((entry) => entry.target));
    const touched = namedTargets(plan).filter((entry) => entry.kind === TARGET_KIND.NEW && !described.has(entry.target));
    return [...new Set(touched.map((entry) => entry.target))].map((target) => say(ERROR.NEW_NO_PURPOSE, { path: target }));
}

export function checkPlan(root, map, plan) {
    const shape = shapeProblems(plan);
    const against = mapProblems(root, map, plan);
    return { errors: [...shape.errors, ...against.errors, ...purposeProblems(plan)], warnings: [...shape.warnings, ...against.warnings, ...coverageWarnings(map, plan)] };
}
