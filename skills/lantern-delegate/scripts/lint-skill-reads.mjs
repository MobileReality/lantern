#!/usr/bin/env node
//
// lint-skill-reads.mjs — check that every skill a delegate linked with the skill linker was then read from
// disk (.claude/skills/<name>/SKILL.md), as protocol.md's "Link the conventions you need" requires.
//
//   node lint-skill-reads.mjs [--json] [--agent-id <id>] <transcript.jsonl | directory> [...]
//
// Same transcript format as lint-transcript.mjs. A LATER tool call or later segment that
// reads the skill's SKILL.md satisfies it: a Read whose file_path ends in skills/<name>/SKILL.md, or
// a Bash segment running cat/head/tail/sed/less/bat/grep/awk on .claude/skills/<name>/SKILL.md.
// One later read clears every pending link of that skill. A `for v in a b c; do ...; done` over a
// literal list is expanded: $v and ${v} in the body stand for each item. A list with $, backticks or
// glob characters is not resolved. Nested loops are not resolved either.
// Prints `file:line skill-not-read <name>` per violation and a summary; exit 1 on any, 0 otherwise.
// It never edits anything.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { configuredSkillLinkerPath, isSkillLinkerWord } from './skill-linker.mjs';
import { splitPipeline } from './split-command.mjs';

const READERS = new Set(['cat', 'head', 'tail', 'less', 'bat', 'grep', 'awk', 'sed']);
const SKILL_PATH = /(?:^|\/)\.claude\/skills\/([\w.-]+)\/SKILL\.md$/;

const LAUNCHERS = new Set(['bash', 'sh', 'zsh', 'node']);
const LITERAL_ITEM = /^[^$`*?[\]{}()~]+$/;

function isSkillLinker(words, linker) {
    let i = 0;
    while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i++;
    if (LAUNCHERS.has(words[i])) i++;
    return isSkillLinkerWord(words[i], linker);
}

function segmentEventsOf(words, linker) {
    if (words[0] === 'do') words = words.slice(1);
    const events = [];
    if (isSkillLinker(words, linker)) {
        for (let i = 1; i < words.length; i++) {
            if (words[i] === '--skill' && words[i + 1] !== undefined) events.push({ kind: 'link', name: words[++i] });
            else if (words[i].startsWith('--skill=')) events.push({ kind: 'link', name: words[i].slice(8) });
        }
    } else if (READERS.has(words[0])) {
        for (const w of words.slice(1)) {
            const m = SKILL_PATH.exec(w);
            if (m) events.push({ kind: 'read', name: m[1], full: words[0] === 'cat' });
        }
    }
    return events;
}

function forHeader(words) {
    if (words[0] !== 'for' || words[2] !== 'in' || !/^[A-Za-z_]\w*$/.test(words[1] ?? '')) return null;
    let rest = words.slice(3);
    let body = null;
    const doAt = rest.indexOf('do');
    if (doAt >= 0) {
        body = rest.slice(doAt + 1);
        rest = rest.slice(0, doAt);
    }
    return { variable: words[1], items: rest, literal: rest.length > 0 && rest.every((w) => LITERAL_ITEM.test(w)), body };
}

function expand(words, variable, item) {
    return words.map((w) => w.split(`\${${variable}}`).join(item).split(`$${variable}`).join(item));
}

const TRUNCATING_CONSUMERS = new Set(['head', 'tail', 'sed', 'grep', 'awk']);

function eventsOfSegment(words, nextSegment, linker) {
    const events = segmentEventsOf(words, linker);
    const truncated = nextSegment?.afterPipe && TRUNCATING_CONSUMERS.has(nextSegment.words[0]);
    return truncated ? events.map((ev) => (ev.kind === 'read' ? { ...ev, full: false } : ev)) : events;
}

export function segmentEvents(command, linker) {
    const segments = splitPipeline(command);
    const events = [];
    for (let i = 0; i < segments.length; i++) {
        const header = forHeader(segments[i].words);
        if (!header) {
            events.push(...eventsOfSegment(segments[i].words, segments[i + 1], linker));
            continue;
        }
        const body = [];
        if (header.body !== null && header.body.length) body.push({ words: header.body, next: segments[i + 1] });
        let j = i + 1;
        let closed = false;
        let nested = false;
        for (; j < segments.length; j++) {
            let words = segments[j].words;
            if (words[0] === 'do' && j === i + 1 && header.body === null) words = words.slice(1);
            if (words[0] === 'done') {
                closed = true;
                break;
            }
            if (words[0] === 'for') nested = true;
            if (words.length) body.push({ words, next: segments[j + 1] });
        }
        if (!closed || !header.literal || nested) {
            if (header.body) events.push(...eventsOfSegment(header.body, segments[i + 1], linker));
            continue;
        }
        for (const item of header.items) {
            for (const { words, next } of body) {
                events.push(...eventsOfSegment(expand(words, header.variable, item), next, linker));
            }
        }
        i = j;
    }
    return events;
}

export function readSkill(block) {
    if (block.name === 'Read' && typeof block.input?.file_path === 'string') {
        const m = /\/(?:\.claude\/)?skills\/([\w.-]+)\/SKILL\.md$/.exec(block.input.file_path);
        return m ? m[1] : null;
    }
    return null;
}

export function readIsFull(block) {
    const { limit, offset } = block.input ?? {};
    return limit === undefined && (offset === undefined || offset <= 1);
}

export function lintText(text, linker) {
    const events = [];
    text.split('\n').forEach((raw, idx) => {
        if (!raw.includes('tool_use')) return;
        let entry;
        try {
            entry = JSON.parse(raw);
        } catch {
            return;
        }
        const content = entry?.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
            if (block?.type !== 'tool_use') continue;
            const line = idx + 1;
            if (block.name === 'Bash' && typeof block.input?.command === 'string') {
                for (const ev of segmentEvents(block.input.command, linker)) events.push({ ...ev, line });
            }
            const read = readSkill(block);
            if (read) events.push({ kind: 'read', name: read, line });
        }
    });
    const pending = new Map();
    let links = 0;
    for (const ev of events) {
        if (ev.kind === 'link') {
            links++;
            pending.set(ev.name, [...(pending.get(ev.name) ?? []), ev]);
        } else pending.delete(ev.name);
    }
    const violations = [...pending.values()].flat().map((ev) => ({ line: ev.line, name: ev.name }));
    violations.sort((a, b) => a.line - b.line);
    return { links, violations };
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

export function lintPaths(targets, { agentId, linker } = {}) {
    const violations = [];
    let links = 0;
    for (const target of targets) {
        for (const file of transcriptFiles(target, agentId)) {
            const result = lintText(readFileSync(file, 'utf8'), linker);
            links += result.links;
            for (const v of result.violations) violations.push({ file, line: v.line, rule: 'skill-not-read', skill: v.name });
        }
    }
    return { links, unreadLinks: violations.length, violations };
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
        console.error('usage: lint-skill-reads.mjs [--json] [--agent-id <id>] <transcript.jsonl | directory> [...]');
        return 2;
    }
    let result;
    try {
        result = lintPaths(targets, { agentId, linker: configuredSkillLinkerPath() });
    } catch (err) {
        console.error(`lint-skill-reads: ${err.message}`);
        return 2;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
        for (const v of result.violations) console.log(`${v.file}:${v.line} ${v.rule} ${v.skill}`);
        console.log(`${result.unreadLinks} linked skill(s) never read out of ${result.links}`);
    }
    return result.unreadLinks > 0 ? 1 : 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
