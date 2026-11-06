#!/usr/bin/env node
//
// lint-reviewer.mjs — check that every code review a delegate dispatched went to the read-only reviewer
// agent that matches the delegate, as protocol.md requires, and that the agent type was not missing.
//
//   node lint-reviewer.mjs [--json] [--agent-id <id>] <transcript.jsonl | directory> [...]
//
// Same transcript format as lint-transcript.mjs. An `Agent` tool_use is a review when its prompt
// mentions `lantern-code-reviewer` or the word "review", or its description contains "review". A Sonnet
// delegate (`lantern-delegate-<level>`) and an Opus one (`lantern-delegate-complex-opus-<level>`) review
// through `reviewer`, a Fable one (`lantern-delegate-complex-fable-<level>`) through `reviewer-complex`.
// The delegate's type is read from the agent-<id>.meta.json beside the transcript, else from the model of
// its calls. Prints
// `file:line review-not-by-reviewer <subagent_type>` when the type is not the matching one,
// `file:line reviewer-missing` when the matching tool_result says the type was not found,
// `file:line model-override-on-spawn <type> <model>` when a reviewer was spawned with a `model`, which
// would override the model its type pins, and
// `file:line delegate-type-on-wrong-model <type> <model>` when a delegate type ran on another model family.
// Every kind of delegate writes the map itself (the map's model policy accepts Sonnet, Opus and Fable), so
// nothing here looks at who edits `.lantern/`. Exit 1 on any, 0 otherwise. It never edits anything.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { delegateKind, modelKind, REVIEWER_AGENT_TYPE, REVIEWER_AGENT_TYPES, reviewerFor, typeKind } from './delegate-kinds.mjs';

const NOT_FOUND = /not found\.\s*Available agents/i;

export function isReview(input) {
    const description = typeof input?.description === 'string' ? input.description : '';
    const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
    return /\breview/i.test(description) || /lantern-code-reviewer|\b(code )?review\b/i.test(prompt);
}

function resultText(block) {
    const c = block.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
    return '';
}

function parseEntries(text) {
    const entries = [];
    text.split('\n').forEach((raw, idx) => {
        if (!raw.trim()) return;
        try {
            entries.push({ line: idx + 1, entry: JSON.parse(raw) });
        } catch {}
    });
    return entries;
}

function firstModel(entries) {
    for (const { entry } of entries) {
        const model = entry?.type === 'assistant' ? entry.message?.model : null;
        if (typeof model === 'string' && !model.startsWith('<')) return model;
    }
    return null;
}

export function agentTypeOf(file) {
    const meta = join(dirname(file), `${basename(file, '.jsonl')}.meta.json`);
    if (!existsSync(meta)) return null;
    try {
        return JSON.parse(readFileSync(meta, 'utf8')).agentType ?? null;
    } catch {
        return null;
    }
}

export function lintText(text, { agentType = null } = {}) {
    const entries = parseEntries(text);
    const model = firstModel(entries);
    const kind = delegateKind({ agentType, model });
    const spawned = new Map();
    const violations = [];
    let reviews = 0;
    const ranOn = modelKind(model);
    if (typeKind(agentType) && ranOn && typeKind(agentType) !== ranOn) violations.push({ line: 1, rule: 'delegate-type-on-wrong-model', subagentType: agentType, detail: model });
    for (const { line, entry } of entries) {
        const content = entry?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
            if (block?.type === 'tool_use' && block.name === 'Agent') {
                const type = typeof block.input?.subagent_type === 'string' && block.input.subagent_type ? block.input.subagent_type : 'general-purpose';
                if (REVIEWER_AGENT_TYPES.includes(type) && block.input?.model) violations.push({ line, rule: 'model-override-on-spawn', subagentType: type, detail: String(block.input.model) });
                if (isReview(block.input)) {
                    reviews++;
                    spawned.set(block.id, line);
                    const expected = reviewerFor(kind);
                    if (type !== expected) violations.push({ line, rule: 'review-not-by-reviewer', subagentType: type, ...(expected === REVIEWER_AGENT_TYPE ? {} : { detail: `expected ${expected}` }) });
                }
            } else if (block?.type === 'tool_result' && spawned.has(block.tool_use_id) && NOT_FOUND.test(resultText(block))) {
                violations.push({ line: spawned.get(block.tool_use_id), rule: 'reviewer-missing' });
            }
        }
    }
    violations.sort((a, b) => a.line - b.line);
    return { reviews, kind, violations };
}

function transcriptFiles(target, agentId) {
    if (!statSync(target).isDirectory()) return [target];
    const files = [];
    for (const name of readdirSync(target).sort()) {
        const full = join(target, name);
        if (statSync(full).isDirectory()) files.push(...transcriptFiles(full, agentId));
        else if (name.endsWith('.jsonl') && (!agentId || basename(name) === `agent-${agentId}.jsonl`)) files.push(full);
    }
    return files;
}

export function lintPaths(targets, { agentId } = {}) {
    const violations = [];
    let reviews = 0;
    for (const target of targets) {
        for (const file of transcriptFiles(target, agentId)) {
            const result = lintText(readFileSync(file, 'utf8'), { agentType: agentTypeOf(file) });
            reviews += result.reviews;
            for (const v of result.violations) violations.push({ file, ...v });
        }
    }
    return { reviews, badReviews: violations.length, violations };
}

function main(argv) {
    let json = false;
    let agentId;
    const targets = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--json') json = true;
        else if (argv[i] === '--agent-id') agentId = argv[++i];
        else targets.push(argv[i]);
    }
    if (targets.length === 0 || (agentId === undefined && argv.includes('--agent-id'))) {
        console.error('usage: lint-reviewer.mjs [--json] [--agent-id <id>] <transcript.jsonl | directory> [...]');
        return 2;
    }
    let result;
    try {
        result = lintPaths(targets, { agentId });
    } catch (err) {
        console.error(`lint-reviewer: ${err.message}`);
        return 2;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
        for (const v of result.violations) console.log(`${v.file}:${v.line} ${v.rule}${v.subagentType ? ` ${v.subagentType}` : ''}${v.detail ? ` ${v.detail}` : ''}`);
        console.log(`${result.badReviews} review problem(s) out of ${result.reviews} review(s)`);
    }
    return result.badReviews > 0 ? 1 : 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
