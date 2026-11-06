#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ARGS_PROBLEM, ArgsError, parseArgs } from '../../lantern-setup/scripts/cli-args.mjs';
import { MAP_DIR } from '../../lantern-setup/scripts/lib.mjs';
import { flowFromJson } from '../../lantern-setup/scripts/prflow.mjs';
import { planState, sectionStates } from './plan-approval.mjs';
import { checkPlan } from './plan-check.mjs';
import { ADD_KINDS, PlanEditError, addToPlan, approveSection, markVerified, newPlan } from './plan-edit.mjs';
import { PLAN_DIR, PLAN_LEVEL, PLAN_STATE, SECTION_STATE, SLUG, TAG, tagLine } from './plan-format.mjs';
import { runGate } from './plan-gate.mjs';
import { handoffLines, handoffOf } from './plan-handoff.mjs';
import { DEFAULT_DEPTH, MAX_DEPTH, computeImpact, formatImpact, resolveSeeds } from './plan-impact.mjs';
import { PlanFileError, listPlanSlugs, loadPlan, planRel, readPlanFile, resolvePlanPath, savePlan } from './plan-io.mjs';
import { loadLinks } from './plan-links.mjs';
import { loadPlanMap } from './plan-map.mjs';
import { ERROR, EXIT, LINE, say } from './plan-messages.mjs';
import { deriveStatus, formatStatus } from './plan-status.mjs';
import { sectionLines } from './plan-write.mjs';
import { checkPlanningSkills, formatSkillCheck, registryRoots } from './planning-skills.mjs';

const VALUE_FLAGS = ['root', 'title', 'goal', 'file', 'feature', 'area', 'depth', 'touch', 'accept', 'by', 'date', 'flow-file'];
const REPEAT_FLAGS = ['goal', 'file', 'feature', 'area', 'touch'];
const BOOL_FLAGS = ['json', 'all', 'replace'];
const SECTION_WIDTH = 8;

class UsageError extends Error {}

const usage = () => say(LINE.USAGE, { maxDepth: MAX_DEPTH, addKinds: ADD_KINDS.join(', ') });

const usageError = (code, params = {}) => new UsageError(say(code, { ...params, usage: usage() }));

const ARGS_MESSAGES = {
    [ARGS_PROBLEM.MISSING_VALUE]: ERROR.ARG_MISSING_VALUE,
    [ARGS_PROBLEM.UNKNOWN_FLAG]: ERROR.ARG_UNKNOWN_FLAG,
};

const EXIT_OF = [
    [UsageError, EXIT.USAGE],
    [PlanFileError, EXIT.FAILED],
    [PlanEditError, EXIT.FAILED],
];

const today = () => new Date().toISOString().slice(0, 10);

const exitFor = (ok) => (ok ? EXIT.OK : EXIT.FAILED);

function requireArgs(positional, count, code) {
    if (positional.length < count) throw usageError(code);
}

function requireBy(flags) {
    if (!flags.by) throw usageError(ERROR.NEEDS_BY);
    return flags.by;
}

function loadMapFor(root) {
    if (!fs.existsSync(path.join(root, MAP_DIR))) throw new PlanFileError(say(ERROR.NO_MAP, { root, mapDir: MAP_DIR }));
    return loadPlanMap(root);
}

const droppedLines = (warnings) => warnings.map((text) => say(LINE.DROPPED, { text }));

function cmdNew({ root, positional, flags }) {
    requireArgs(positional, 1, ERROR.NEEDS_SLUG);
    const [slug] = positional;
    if (!SLUG.test(slug)) throw new UsageError(say(ERROR.NOT_A_SLUG, { slug }));
    if (!flags.title || !flags.goal) throw usageError(ERROR.NEEDS_TITLE_GOAL);
    const file = resolvePlanPath(root, slug);
    if (fs.existsSync(file)) throw new PlanFileError(say(ERROR.PLAN_EXISTS, { rel: planRel(slug) }));
    savePlan(file, newPlan({ slug, title: flags.title, goals: flags.goal, today: today() }));
    return { report: { file: planRel(slug) }, human: [say(LINE.WROTE, { rel: planRel(slug) }), say(LINE.NEW_NEXT, { slug })] };
}

function cmdImpact({ root, flags }) {
    const map = loadMapFor(root);
    const depth = flags.depth === undefined ? DEFAULT_DEPTH : Number(flags.depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) throw new UsageError(say(ERROR.DEPTH_RANGE, { max: MAX_DEPTH }));
    const { seeds, problems } = resolveSeeds(map, { files: flags.file, features: flags.feature, areas: flags.area });
    if (problems.length) throw new UsageError(problems.join('\n'));
    const report = computeImpact(map, seeds, depth);
    return { report, human: formatImpact(report) };
}

function readFlowFile(root, file) {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
    } catch (error) {
        throw new PlanEditError(say(ERROR.EDIT_FLOW_FILE, { file, reason: error.message }));
    }
    const { stories, errors } = flowFromJson(value, { has: () => true });
    if (errors.length) throw new PlanEditError(say(ERROR.EDIT_FLOW_INVALID, { errors: errors.join('\n  ') }));
    return stories;
}

function cmdAdd({ root, positional, flags }) {
    requireArgs(positional, 2, ERROR.NEEDS_ADD);
    const [slug, kind, ...args] = positional;
    const { file, plan, warnings } = loadPlan(root, slug);
    addToPlan(plan, kind, args, flags['flow-file'] ? { ...flags, flowStories: readFlowFile(root, flags['flow-file']) } : flags);
    savePlan(file, plan);
    return { report: { file: planRel(slug), kind }, human: [...droppedLines(warnings), say(LINE.UPDATED, { rel: planRel(slug), kind }), say(LINE.ADD_NEXT, { slug })] };
}

function checkOne(root, map, ref) {
    const file = resolvePlanPath(root, ref);
    const parsed = readPlanFile(file);
    const label = path.relative(root, file) || file;
    if (parsed.errors.length) return { plan: label, ok: false, errors: parsed.errors, warnings: parsed.warnings };
    const result = checkPlan(root, map, parsed.plan);
    const errors = result.errors.map((text) => say(LINE.LOCATED, { where: label, text }));
    return { plan: label, ok: errors.length === 0, errors, warnings: [...parsed.warnings, ...result.warnings.map((text) => say(LINE.LOCATED, { where: label, text }))] };
}

function checkRefs(root, positional, flags) {
    const refs = flags.all ? listPlanSlugs(root) : positional;
    if (refs.length) return refs;
    throw flags.all ? new UsageError(say(ERROR.NO_PLANS, { dir: PLAN_DIR })) : usageError(ERROR.NEEDS_CHECK);
}

function cmdCheck({ root, positional, flags }) {
    const refs = checkRefs(root, positional, flags);
    const map = loadMapFor(root);
    const results = refs.map((ref) => checkOne(root, map, ref));
    const ok = results.every((r) => r.ok);
    const human = results.flatMap((r) => [
        say(r.ok ? LINE.CHECK_OK : LINE.CHECK_FAIL, { plan: r.plan, count: r.errors.length }),
        ...r.errors.map((text) => say(LINE.INDENT, { text })),
        ...r.warnings.map((text) => say(LINE.WARNING_ROW, { text })),
    ]);
    return { report: { ok, results }, human, exit: exitFor(ok) };
}

const QUEUE_ENDINGS = [
    [(plan, next) => next !== undefined, (plan, next) => say(LINE.QUEUE_NEXT, { section: next.section, slug: plan.slug })],
    [(plan) => plan.approved, () => say(LINE.QUEUE_ALL_DONE)],
    [() => true, (plan) => say(LINE.QUEUE_APPROVE_PLAN, { slug: plan.slug, level: PLAN_LEVEL })],
];

function reviewQueue(plan) {
    const states = sectionStates(plan);
    const next = states.find((s) => s.state !== SECTION_STATE.APPROVED);
    const rows = states.map((s) => say(LINE.QUEUE_ROW, { section: s.section.padEnd(SECTION_WIDTH), state: s.state, approver: s.by ? say(LINE.QUEUE_APPROVER, s) : '' }));
    const [, ending] = QUEUE_ENDINGS.find(([applies]) => applies(plan, next));
    return { states, next: next?.section ?? null, lines: [say(LINE.QUEUE_HEAD, { slug: plan.slug, state: planState(plan) }), ...rows, ending(plan, next)] };
}

function cmdShow({ root, positional }) {
    requireArgs(positional, 1, ERROR.NEEDS_SHOW);
    const [slug, section] = positional;
    const { plan } = loadPlan(root, slug);
    const queue = reviewQueue(plan);
    if (!section) return { report: { state: planState(plan), sections: queue.states, next: queue.next }, human: queue.lines };
    const state = queue.states.find((s) => s.section === section);
    if (!state) throw new UsageError(say(ERROR.NO_SECTION, { section, sections: queue.states.map((s) => s.section).join(', ') }));
    const lines = sectionLines(plan, section);
    const withAnswers = plan.stages.find((s) => s.id === section);
    const answers = withAnswers ? withAnswers.questions.filter((q) => q.answer).map((q) => tagLine(TAG.ANSWER, q.id, q.answer.by, q.answer.text)) : [];
    return { report: { section, state: state.state, lines, answers }, human: [say(LINE.SECTION_HEAD, { section, state: state.state }), ...(lines.length ? lines : [say(LINE.NONE_NAMED_ROW)]), ...answers] };
}

function cmdApprove({ root, positional, flags }) {
    requireArgs(positional, 2, ERROR.NEEDS_APPROVE);
    const [slug, section] = positional;
    const { file, plan, warnings } = loadPlan(root, slug);
    approveSection(plan, section, requireBy(flags), flags.date ?? today());
    savePlan(file, plan);
    const queue = reviewQueue(plan);
    return { report: { section, state: planState(plan), next: queue.next }, human: [...droppedLines(warnings), say(LINE.APPROVED, { section, rel: planRel(slug) }), ...queue.lines.slice(-1)] };
}

function cmdVerified({ root, positional, flags }) {
    requireArgs(positional, 2, ERROR.NEEDS_VERIFIED);
    const [slug, item] = positional;
    const { file, plan, warnings } = loadPlan(root, slug);
    markVerified(plan, item, requireBy(flags), flags.date ?? today());
    savePlan(file, plan);
    return { report: { item }, human: [...droppedLines(warnings), say(LINE.VERIFIED, { item, rel: planRel(slug) })] };
}

function cmdStatus({ root, positional }) {
    requireArgs(positional, 1, ERROR.NEEDS_STATUS);
    const { plan } = loadPlan(root, positional[0]);
    const status = deriveStatus(plan, loadLinks(root, plan.slug));
    return { report: status, human: formatStatus(status) };
}

function cmdHandoff({ root, positional }) {
    requireArgs(positional, 1, ERROR.NEEDS_HANDOFF);
    const map = loadMapFor(root);
    const { plan } = loadPlan(root, positional[0]);
    const checked = checkPlan(root, map, plan);
    const status = deriveStatus(plan, loadLinks(root, plan.slug));
    const result = handoffOf(plan, status, checked);
    return { report: result, human: handoffLines(result), exit: exitFor(result.ok) };
}

function cmdList({ root }) {
    const rows = listPlanSlugs(root).map((slug) => {
        const parsed = readPlanFile(resolvePlanPath(root, slug));
        return { slug, title: parsed.plan.title, state: parsed.errors.length ? PLAN_STATE.BROKEN : planState(parsed.plan) };
    });
    return { report: rows, human: rows.length ? rows.map((r) => say(LINE.LIST_ROW, r)) : [say(LINE.NO_PLANS_ROW, { dir: PLAN_DIR })] };
}

function cmdGate({ root }) {
    const result = runGate(root, checkPlanningSkills(registryRoots(root)));
    return { report: result, human: result.lines, exit: exitFor(result.ok) };
}

function cmdSkills({ root }) {
    const results = checkPlanningSkills(registryRoots(root));
    return { report: results, human: formatSkillCheck(results), exit: exitFor(results.every((r) => r.found)) };
}

const COMMANDS = {
    gate: cmdGate,
    skills: cmdSkills,
    new: cmdNew,
    impact: cmdImpact,
    add: cmdAdd,
    check: cmdCheck,
    show: cmdShow,
    approve: cmdApprove,
    verified: cmdVerified,
    status: cmdStatus,
    handoff: cmdHandoff,
    list: cmdList,
};

function parseCli(argv) {
    try {
        return parseArgs(argv, { commands: Object.keys(COMMANDS), valueFlags: VALUE_FLAGS, repeatFlags: REPEAT_FLAGS, boolFlags: BOOL_FLAGS, rootArg: false });
    } catch (error) {
        if (!(error instanceof ArgsError)) throw error;
        throw usageError(ARGS_MESSAGES[error.problem], { flag: error.flag });
    }
}

function main() {
    const { command, args, flags } = parseCli(process.argv.slice(2));
    if (!Object.hasOwn(COMMANDS, command)) throw new UsageError(usage());
    const result = COMMANDS[command]({ root: path.resolve(flags.root ?? '.'), positional: args, flags });
    process.stdout.write(flags.json ? `${JSON.stringify(result.report, null, 2)}\n` : `${result.human.join('\n')}\n`);
    process.exit(result.exit ?? EXIT.OK);
}

try {
    main();
} catch (error) {
    const code = EXIT_OF.find(([type]) => error instanceof type)?.[1];
    if (code === undefined) throw error;
    process.stderr.write(`${say(LINE.FAILURE, { text: error.message })}\n`);
    process.exit(code);
}
