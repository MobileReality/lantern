#!/usr/bin/env node
//
// "In full" is a Read of .claude/skills/<name>/SKILL.md with no limit and no offset above 1, or a
// Bash cat of it not piped into head/tail/sed/grep/awk. head, tail, sed, grep, awk, a Read with a
// limit or offset are partial. A full read at any point beats an earlier partial one.

import { readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readIsFull, readSkill, segmentEvents } from './lint-skill-reads.mjs';
import { parseRoleArgs, roleRequirements } from './required-skills.mjs';
import { configuredSkillLinkerPath } from './skill-linker.mjs';

function collectEvents(text, linker) {
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
            const name = readSkill(block);
            if (name) events.push({ kind: 'read', name, full: readIsFull(block), line });
        }
    });
    return events;
}

function unreadFindings(events, names) {
    const fullReads = new Set(events.filter((e) => e.kind === 'read' && e.full).map((e) => e.name));
    const lastPartial = new Map();
    for (const e of events) if (e.kind === 'read' && !e.full) lastPartial.set(e.name, e.line);
    const findings = [];
    for (const name of names) {
        if (fullReads.has(name)) continue;
        if (lastPartial.has(name)) findings.push({ line: lastPartial.get(name), rule: 'skill-partly-read', skill: name });
        else findings.push({ line: 1, rule: 'skill-not-read', skill: name });
    }
    return findings;
}

export function skillReadFindings(text, names, linker) {
    return unreadFindings(collectEvents(text, linker), names);
}

export function checkText(text, { required, linker }) {
    const events = collectEvents(text, linker);
    const linked = new Set(events.filter((e) => e.kind === 'link').map((e) => e.name));

    const extraLinked = [...linked].filter((name) => !required.includes(name));
    const findings = unreadFindings(events, [...required, ...extraLinked]);
    return { required, findings };
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

export function checkPaths(targets, { agentId, required, linker }) {
    const findings = [];
    let transcripts = 0;
    for (const target of targets) {
        for (const file of transcriptFiles(target, agentId)) {
            transcripts++;
            for (const f of checkText(readFileSync(file, 'utf8'), { required, linker }).findings) findings.push({ file, ...f });
        }
    }
    return { transcripts, findingCount: findings.length, findings };
}

function main(argv) {
    let json = false;
    let agentId;
    const remaining = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--json') json = true;
        else if (argv[i] === '--agent-id') agentId = argv[++i];
        else remaining.push(argv[i]);
    }
    const options = parseRoleArgs(remaining);
    if (!options || options.rest.length === 0 || (agentId === undefined && argv.includes('--agent-id'))) {
        console.error('usage: check-skill-use.mjs [--json] [--agent-id <id>] [--role delegate|orchestrator|reviewer] [--plan] [--host <host skill>] [--home <dir>] [--project <dir>] <transcript.jsonl | directory> [...]');
        return 2;
    }
    const { required, warnings } = roleRequirements(options.role, options);
    let result;
    try {
        result = checkPaths(options.rest, { agentId, required, linker: configuredSkillLinkerPath({ home: options.home }) });
    } catch (err) {
        console.error(`check-skill-use: ${err.message}`);
        return 2;
    }
    if (json) console.log(JSON.stringify({ ...result, warnings }, null, 2));
    else {
        for (const text of warnings) console.log(`warning: ${text}`);
        for (const f of result.findings) console.log(`${f.file}:${f.line} ${f.rule} ${f.skill}`);
        console.log(`${result.findingCount} skill-use finding(s) in ${result.transcripts} transcript(s)`);
    }
    return result.findingCount > 0 ? 1 : 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
