#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePath, hasControlCharacter } from './lib.mjs';
import { PLAN_REF, PLAN_TAG, isIsoDate } from './plan-ref.mjs';
import { DESCRIBE_TAG, parseDescribeLines } from './prdescribe.mjs';
import { FLOW_TAGS, parseFlowLines } from './prflow.mjs';

export const PR_HEADER = 'lantern-pr 1';
export const PR_DIR = '.lantern/prs';
export const BRANCH_HEADER = 'lantern-branch 1';
export const BRANCH_DIR = '.lantern/local';
export const BRANCH_EXT = '.branch';
export const DISMISSED_FILE = 'dismissed';
export const DISMISSED_HEADER = 'lantern-prs-dismissed 1';
const REQUIRED = ['title', 'url', 'branch', 'base', 'opened', 'head'];
const BRANCH_REQUIRED = ['branch', 'base', 'opened', 'head'];
const OPTIONAL = ['summary'];
export const REASON_MAX_CHARS = 160;
const KINDS = ['+', '~', '-'];
const ID_LINE = /^# (\S+)$/;
const FILE_NAME = /^(\d+)\.pr$/;
const HEAD = /^[0-9a-f]{40}$/;
const BRANCH_FILE_NAME = /^[\w.-]+\.branch$/;

export const branchFileName = (branch) => `${branch.replace(/\//g, '__').replace(/[^\w.-]+/g, '_')}${BRANCH_EXT}`;

const PR_SPEC = { header: PR_HEADER, required: REQUIRED, hasId: true, nameProblem: (name) => (FILE_NAME.test(name) ? null : 'file name must be <digits>.pr') };
const BRANCH_SPEC = { header: BRANCH_HEADER, required: BRANCH_REQUIRED, hasId: false, nameProblem: (name) => (BRANCH_FILE_NAME.test(name) ? null : `file name must be <branch>${BRANCH_EXT}`) };

function pathProblem(p) {
    if (/\s/.test(p)) return 'contains whitespace (encode a space as %20)';
    if (p.includes('#')) return 'contains a literal # (encode it as %23)';
    if (/%(?!20|23|25)/.test(p)) return 'has a % that is not %20, %23 or %25 (encode a literal % as %25)';
    if (p.startsWith('/') || p.split('/').some((part) => part === '..' || part === '.' || part === '')) return 'must be a relative path from the project root';
    return null;
}

export function reasonProblem(reason) {
    if (reason === '') return 'reason is empty';
    if (hasControlCharacter(reason)) return 'reason contains a control character (one line, no tabs)';
    if ([...reason].length > REASON_MAX_CHARS) return `reason is ${[...reason].length} characters, the cap is ${REASON_MAX_CHARS}`;
    return null;
}

const PLAN_TAG_LINE = new RegExp(`^#${PLAN_TAG}(?:[ \\t]|$)`);

function parsePlanEntries(entries, errors) {
    const plans = [];
    for (const { line, where } of entries) {
        const ref = PLAN_REF.exec(line);
        if (!ref) {
            errors.push(`${where}: #plan must be "#plan <plan slug> <item id>", got "#${PLAN_TAG} ${line.replace(PLAN_TAG_LINE, '').trim()}"`);
            continue;
        }
        const [, slug, item] = ref;
        if (plans.some((p) => p.slug === slug && p.item === item)) {
            errors.push(`${where}: duplicate #plan ${slug} ${item}`);
            continue;
        }
        plans.push({ slug, item });
    }
    return plans;
}

export function parsePr(text, file) {
    return parseRecord(text, file, PR_SPEC);
}

export function parseBranchRecord(text, file) {
    const record = parseRecord(text, file, BRANCH_SPEC);
    if (record.branch && path.basename(file) !== branchFileName(record.branch)) record.errors.push(`${file}: file name must be ${branchFileName(record.branch)} for branch ${record.branch}`);
    return record;
}

function parseRecord(text, file, spec) {
    const errors = [];
    const warnings = [];
    const meta = new Map();
    const files = [];
    const reasonEntries = [];
    const planEntries = [];
    const orders = [];
    const flowLines = [];
    const describeLines = [];
    const seen = new Map();
    const lines = text.split(/\r?\n/);
    const name = path.basename(file);
    const expectedId = spec.hasId ? (FILE_NAME.exec(name)?.[1] ?? null) : null;
    const nameProblem = spec.nameProblem(name);
    if (nameProblem) errors.push(`${file}: ${nameProblem}`);

    if (lines[0]?.trim() !== spec.header) errors.push(`${file}:1: first line must be "${spec.header}"`);

    let id = null;
    let sawHashLine = false;
    lines.forEach((raw, index) => {
        if (index === 0) return;
        const where = `${file}:${index + 1}`;
        const line = raw.trimEnd();
        if (line.trim() === '') return;
        if (line.startsWith('#')) {
            if (spec.hasId && !sawHashLine) {
                sawHashLine = true;
                const idLine = ID_LINE.exec(line);
                if (!idLine) {
                    errors.push(`${where}: first # line must be "# <id>", got "${line}"`);
                    return;
                }
                id = idLine[1];
                if (!/^\d+$/.test(id)) errors.push(`${where}: id "${id}" must be digits`);
                else if (expectedId !== null && id !== expectedId) errors.push(`${where}: id ${id} does not match file name ${name}`);
                return;
            }
            const key = /^#([a-z]+)(?: (.*))?$/.exec(line);
            if (key?.[1] === 'reason' || key?.[1] === 'why') {
                reasonEntries.push({ raw: (key[2] ?? '').trim(), where });
                return;
            }
            if (key?.[1] === 'order') {
                orders.push({ raw: (key[2] ?? '').trim(), where });
                return;
            }
            if (PLAN_TAG_LINE.test(line)) {
                planEntries.push({ line, where });
                return;
            }
            const describeLine = /^#([a-z]+)(?:[ \t]+(.*))?$/.exec(line);
            if (describeLine?.[1] === DESCRIBE_TAG) {
                describeLines.push({ raw: (describeLine[2] ?? '').trim(), where });
                return;
            }
            const flowLine = /^#([a-z]+)(?:[ \t]+(.*))?$/.exec(line);
            if (flowLine && FLOW_TAGS.includes(flowLine[1])) {
                flowLines.push({ tag: flowLine[1], raw: (flowLine[2] ?? '').trim(), where });
                return;
            }
            if (!key || ![...spec.required, ...OPTIONAL].includes(key[1])) return;
            if (meta.has(key[1])) errors.push(`${where}: #${key[1]} appears more than once`);
            else meta.set(key[1], { value: (key[2] ?? '').trim(), where });
            return;
        }
        const match = /^(\S) (.+)$/.exec(line);
        if (!match || !KINDS.includes(match[1])) {
            errors.push(`${where}: file line must be "<kind> <path>" with kind + ~ or -, got "${line}"`);
            return;
        }
        const [, kind, filePath] = match;
        const problem = pathProblem(filePath);
        if (problem) {
            errors.push(`${where}: path ${problem}: ${filePath}`);
            return;
        }
        if (seen.has(filePath)) {
            errors.push(`${where}: duplicate path ${filePath} (first at line ${seen.get(filePath)})`);
            return;
        }
        seen.set(filePath, index + 1);
        files.push({ kind, path: filePath, where });
    });

    const reasons = new Map();
    const listed = new Set(files.map((f) => decodePath(f.path)));
    for (const { raw, where } of reasonEntries) {
        const cut = raw.search(/\s/);
        const reasonPath = cut === -1 ? raw : raw.slice(0, cut);
        const reason = cut === -1 ? '' : raw.slice(cut).trim();
        if (reasonPath === '') {
            errors.push(`${where}: #reason must be "#reason <path> <reason>"`);
            continue;
        }
        const problem = pathProblem(reasonPath) ?? reasonProblem(reason);
        if (problem) {
            errors.push(`${where}: #reason ${problem}`);
            continue;
        }
        const decoded = decodePath(reasonPath);
        if (!listed.has(decoded)) {
            errors.push(`${where}: #reason names ${reasonPath}, which is not a file line of this record`);
            continue;
        }
        if (reasons.has(decoded)) {
            errors.push(`${where}: duplicate #reason for ${reasonPath}`);
            continue;
        }
        reasons.set(decoded, reason);
    }

    const order = [];
    const ordered = new Set();
    for (const { raw, where } of orders) {
        const problem = raw === '' ? 'must be "#order <path>"' : /\s/.test(raw) ? 'takes one path and nothing after it (encode a space as %20)' : pathProblem(raw);
        if (problem) {
            errors.push(`${where}: #order ${problem}`);
            continue;
        }
        const decoded = decodePath(raw);
        if (!listed.has(decoded)) {
            errors.push(`${where}: #order names ${raw}, which is not a file line of this record`);
            continue;
        }
        if (ordered.has(decoded)) {
            errors.push(`${where}: duplicate #order for ${raw}`);
            continue;
        }
        ordered.add(decoded);
        order.push(decoded);
    }

    const plans = parsePlanEntries(planEntries, errors);
    const flow = parseFlowLines(flowLines, listed);
    errors.push(...flow.errors);
    const describe = parseDescribeLines(describeLines);
    errors.push(...describe.errors);

    if (spec.hasId && id === null && !sawHashLine) errors.push(`${file}: missing id line "# <id>"`);
    for (const key of spec.required) {
        const entry = meta.get(key);
        if (!entry) errors.push(`${file}: missing #${key}`);
        else if (entry.value === '') errors.push(`${entry.where}: #${key} is empty`);
    }
    const opened = meta.get('opened');
    if (opened && opened.value !== '' && !isIsoDate(opened.value)) errors.push(`${opened.where}: #opened must be an ISO date (YYYY-MM-DD), got "${opened.value}"`);
    const head = meta.get('head');
    if (head && head.value !== '' && !HEAD.test(head.value)) errors.push(`${head.where}: #head must be a full 40-hex commit sha, got "${head.value}"`);

    const rank = (kind) => KINDS.indexOf(kind);
    for (let i = 1; i < files.length; i++) {
        const a = files[i - 1];
        const b = files[i];
        if (rank(b.kind) < rank(a.kind) || (b.kind === a.kind && b.path < a.path)) {
            warnings.push(`${b.where}: out of order — "${b.kind} ${b.path}" after "${a.kind} ${a.path}" (groups + ~ -, each sorted by path)`);
            break;
        }
    }

    const value = (key) => meta.get(key)?.value ?? null;
    return {
        file,
        kind: spec.hasId ? 'pr' : 'branch',
        id,
        title: value('title'),
        url: value('url'),
        branch: value('branch'),
        base: value('base'),
        opened: value('opened'),
        head: value('head'),
        summary: value('summary'),
        files: files.map(({ kind, path: p }) => {
            const decoded = decodePath(p);
            const reason = reasons.get(decoded);
            return reason === undefined ? { kind, path: decoded } : { kind, path: decoded, reason };
        }),
        order,
        plans,
        flow: flow.errors.length ? [] : flow.stories,
        description: describe.description,
        errors,
        warnings,
    };
}

export function inReviewOrder(files, order) {
    const position = new Map(order.map((file, index) => [file, index]));
    const ranked = files.filter((f) => position.has(f.path)).sort((a, b) => position.get(a.path) - position.get(b.path));
    return [...ranked, ...files.filter((f) => !position.has(f.path))];
}

export function parseDismissed(text, file = `${PR_DIR}/${DISMISSED_FILE}`) {
    const errors = [];
    const warnings = [];
    const ids = [];
    const seen = new Map();
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== DISMISSED_HEADER) errors.push(`${file}:1: first line must be "${DISMISSED_HEADER}"`);
    let sorted = true;
    lines.forEach((raw, index) => {
        if (index === 0) return;
        const where = `${file}:${index + 1}`;
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) return;
        if (!/^\d+$/.test(line)) {
            errors.push(`${where}: expected a pull request id (digits), got "${line}"`);
            return;
        }
        if (seen.has(line)) {
            errors.push(`${where}: duplicate id ${line} (first at line ${seen.get(line)})`);
            return;
        }
        seen.set(line, index + 1);
        if (sorted && ids.length && BigInt(line) < BigInt(ids[ids.length - 1])) {
            sorted = false;
            warnings.push(`${where}: out of order — ${line} after ${ids[ids.length - 1]} (ids sorted ascending numerically)`);
        }
        ids.push(line);
    });
    return { file, ids, errors, warnings };
}

export function serializeDismissed(ids) {
    const sorted = [...new Set(ids.map(String))].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
    return `${[DISMISSED_HEADER, ...sorted].join('\n')}\n`;
}

export function readDismissed(root) {
    const abs = path.join(path.resolve(root), PR_DIR, DISMISSED_FILE);
    if (!fs.existsSync(abs)) return null;
    return parseDismissed(fs.readFileSync(abs, 'utf8'));
}

export function listPrs(root) {
    const dir = path.join(path.resolve(root), PR_DIR);
    if (!fs.existsSync(dir)) return [];
    const prs = [];
    const stray = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = `${PR_DIR}/${entry.name}`;
        if (entry.isFile() && entry.name === DISMISSED_FILE) continue;
        if (entry.isFile() && entry.name.endsWith('.pr')) prs.push(parsePr(fs.readFileSync(path.join(dir, entry.name), 'utf8'), rel));
        else stray.push(rel);
    }
    prs.sort((a, b) => Number(a.id ?? Infinity) - Number(b.id ?? Infinity) || a.file.localeCompare(b.file));
    prs.strays = stray;
    prs.dismissed = readDismissed(root);
    return prs;
}

export function listBranchRecords(root) {
    const dir = path.join(path.resolve(root), BRANCH_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(BRANCH_EXT))
        .map((entry) => parseBranchRecord(fs.readFileSync(path.join(dir, entry.name), 'utf8'), `${BRANCH_DIR}/${entry.name}`))
        .sort((a, b) => a.file.localeCompare(b.file));
}

export function summarize(prs) {
    const dismissed = prs.dismissed ?? null;
    const dismissedIds = new Set((dismissed?.ids ?? []).map((id) => String(BigInt(id))));
    const errors = [...prs.flatMap((pr) => pr.errors), ...(dismissed?.errors ?? [])];
    const kept = prs.filter((pr) => pr.id !== null && /^\d+$/.test(pr.id) && dismissedIds.has(String(BigInt(pr.id)))).map((pr) => `${pr.file}: record kept for a dismissed PR (ignored by readers; dismiss deletes it)`);
    const warnings = [...prs.flatMap((pr) => pr.warnings), ...(dismissed?.warnings ?? []), ...kept, ...(prs.strays ?? []).map((s) => `${s}: not a .pr record, ignored`)];
    return { errors, warnings };
}

function isEntryPoint() {
    try {
        return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isEntryPoint()) {
    const root = process.argv[2] ?? '.';
    const prs = listPrs(root);
    if (!prs.length) console.log(`no pull-request records in ${PR_DIR}`);
    if (prs.dismissed) console.log(`dismissed ${prs.dismissed.ids.length}`);
    for (const pr of prs) {
        const count = (kind) => pr.files.filter((f) => f.kind === kind).length;
        const status = pr.errors.length ? `FAIL ${pr.errors.length}` : 'OK';
        const ordered = pr.order.length ? ` order ${pr.order.length}/${pr.files.length}` : '';
        const flowed = pr.flow.length ? ` flow ${pr.flow.length}` : '';
        console.log(`#${pr.id ?? path.basename(pr.file)} ${pr.opened ?? '?'} ${pr.branch ?? '?'} -> ${pr.base ?? '?'} +${count('+')} ~${count('~')} -${count('-')}${ordered}${flowed} ${status} ${pr.title ?? ''}`.trimEnd());
    }
    const { errors, warnings } = summarize(prs);
    if (warnings.length) console.log(`warning: ${warnings.length}\n  ${warnings.join('\n  ')}`);
    if (errors.length) {
        console.log(`FAIL: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
        process.exit(1);
    }
    console.log('OK');
}
