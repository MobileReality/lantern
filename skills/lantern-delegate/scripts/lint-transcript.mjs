#!/usr/bin/env node
//
// lint-transcript.mjs — check the Bash commands a delegate really typed against protocol.md's
// "Commands the guard accepts" (chains, heredoc, expansions, git -C, cd joined to a command).
//
//   node lint-transcript.mjs [--json] [--agent-id <id>] <transcript.jsonl | directory> [...]
//
// Reads Claude Code session transcripts (lines whose message.content[] hold tool_use blocks named
// Bash), or every .jsonl under a directory. With --agent-id only agent-<id>.jsonl is read, so a
// subagents/ folder shared with reviewers and explorers (which the guard does not bind) is not
// counted. Prints one line per violation: file:line, rule, the command shortened, then a summary of
// distinct offending commands. Exit 1 when there is any, 0 otherwise. Quotes are parsed: a `;` or
// `&&` inside a quoted argument is not a violation. It never edits anything.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { configuredSkillLinkerPath, isSkillLinkerWord } from './skill-linker.mjs';

export const RULES = ['and-chain', 'or-chain', 'semicolon', 'pipe', 'background', 'newline', 'heredoc', 'substitution', 'line-continuation', 'escaped-space', 'git-dash-c', 'cd-chain', 'skill-linker-baseline'];

const SKILL_LINKER_SAFE = new Set(['--skill', '--linked', '--list', '--help', '-h']);

const EXPANSION_START = /[A-Za-z0-9_{(@?!*$]/;

export function lintCommand(rawCommand, linker) {
    const command = rawCommand.trimEnd();
    const found = new Set();
    const words = [];
    const segmentStarts = [];
    let word = '';
    let inWord = false;
    let chained = false;
    const endWord = () => {
        if (inWord) words.push(word);
        word = '';
        inWord = false;
    };
    const chain = (rule) => {
        found.add(rule);
        chained = true;
        endWord();
        segmentStarts.push(words.length);
    };
    let quote = null;
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        const next = command[i + 1];
        if (quote === "'") {
            if (c === "'") quote = null;
            else word += c;
            continue;
        }
        if (quote === '"') {
            if (c === '"') quote = null;
            else if (c === '\\' && next !== undefined) {
                word += next;
                i++;
            } else {
                if ((c === '$' && next !== undefined && EXPANSION_START.test(next)) || c === '`') found.add('substitution');
                word += c;
            }
            continue;
        }
        if (c === '#' && !inWord) {
            while (i + 1 < command.length && command[i + 1] !== '\n') i++;
        } else if (c === "'" || c === '"') {
            quote = c;
            inWord = true;
        } else if (c === '\\') {
            if (next === '\n') found.add('line-continuation');
            else if (next === ' ') found.add('escaped-space');
            if (next !== undefined) {
                word += next;
                inWord = true;
                i++;
            }
        } else if (c === '&' && next === '&') {
            chain('and-chain');
            i++;
        } else if (c === '&') {
            const redirect = command[i - 1] === '>' || command[i - 1] === '<' || next === '>';
            if (!redirect) chain('background');
            else {
                word += c;
                inWord = true;
            }
        } else if (c === '|' && next === '|') {
            chain('or-chain');
            i++;
        } else if (c === '|') chain('pipe');
        else if (c === ';') chain('semicolon');
        else if (c === '\n') chain('newline');
        else if (c === '<' && next === '<') {
            found.add('heredoc');
            i++;
        } else if ((c === '<' || c === '>') && next === '(') {
            found.add('substitution');
            i++;
        } else if ((c === '$' && next !== undefined && EXPANSION_START.test(next)) || c === '`') {
            found.add('substitution');
            word += c;
            inWord = true;
        } else if (c === ' ' || c === '\t') endWord();
        else {
            word += c;
            inWord = true;
        }
    }
    endWord();
    const starts = [0, ...segmentStarts, words.length];
    for (let s = 0; s < starts.length - 1; s++) {
        const segment = words.slice(starts[s], starts[s + 1]);
        if (segment.length === 0 || !isSkillLinkerWord(segment[0], linker)) continue;
        if (!segment.some((w) => SKILL_LINKER_SAFE.has(w))) found.add('skill-linker-baseline');
    }
    for (let i = 0; i < words.length; i++) {
        if (words[i] !== 'git') continue;
        for (let j = i + 1; j < words.length && words[j].startsWith('-'); j++) {
            if (words[j] === '-C') found.add('git-dash-c');
            if (words[j] === '-c') j++;
        }
    }
    if (chained && /^\s*cd\s/.test(command)) found.add('cd-chain');
    return RULES.filter((r) => found.has(r));
}

export function extractCommands(text) {
    const out = [];
    text.split('\n').forEach((raw, idx) => {
        if (!raw.includes('"Bash"')) return;
        let entry;
        try {
            entry = JSON.parse(raw);
        } catch {
            return;
        }
        const content = entry?.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
            if (block?.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string') {
                out.push({ line: idx + 1, command: block.input.command });
            }
        }
    });
    return out;
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

const shorten = (command) => {
    const flat = command.replace(/\s+/g, ' ').trim();
    return flat.length > 100 ? `${flat.slice(0, 97)}...` : flat;
};

export function lintPaths(targets, { agentId, linker } = {}) {
    const violations = [];
    let commands = 0;
    let violatingCommands = 0;
    for (const target of targets) {
        for (const file of transcriptFiles(target, agentId)) {
            for (const { line, command } of extractCommands(readFileSync(file, 'utf8'))) {
                commands++;
                const rules = lintCommand(command, linker);
                if (rules.length > 0) violatingCommands++;
                for (const rule of rules) violations.push({ file, line, rule, command: shorten(command) });
            }
        }
    }
    return { commands, violatingCommands, violations };
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
    if (targets.length === 0 || agentId === undefined && argv.includes('--agent-id')) {
        console.error('usage: lint-transcript.mjs [--json] [--agent-id <id>] <transcript.jsonl | directory> [...]');
        return 2;
    }
    let result;
    try {
        result = lintPaths(targets, { agentId, linker: configuredSkillLinkerPath() });
    } catch (err) {
        console.error(`lint-transcript: ${err.message}`);
        return 2;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
        for (const v of result.violations) console.log(`${v.file}:${v.line} ${v.rule} ${v.command}`);
        console.log(`${result.violatingCommands} command(s) with violations out of ${result.commands}`);
    }
    return result.violatingCommands > 0 ? 1 : 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
