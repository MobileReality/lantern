#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirOf, enumerate } from './lib.mjs';

const USAGE = 'usage: refs.mjs <root> <markdown file>... [--json]';
const SKILL_FILE = 'SKILL.md';
const LINK = /\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;
const TOKEN = /[A-Za-z0-9_$.{}/-]+/g;
const VARIABLE = /^\$\{?([A-Z][A-Z0-9_]*)\}?\/(.+)$/;
const BACKTICKED = /`([^`\n]+)`/g;
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;
const BEFORE_SKILL_NAME = /(?:\b(?:skills?|loads?|invokes?)\b[^`\n]{0,40}(?:`[^`\n]+`[^`\n]{0,8})*|Skill\()$/i;
const AFTER_SKILL_NAME = /^\)?\s+(?:skill|agent type)\b/i;

function frontmatterName(text) {
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const name = head && /^name:\s*["']?([^\s"']+)["']?\s*$/m.exec(head[1]);
    return name ? name[1] : null;
}

const skillIndexes = new WeakMap();

function indexSkills(root, files) {
    if (!skillIndexes.has(files)) skillIndexes.set(files, readSkillIndex(root, files));
    return skillIndexes.get(files);
}

function readSkillIndex(root, files) {
    const dirs = new Set();
    const byName = new Map();
    for (const file of files) {
        if (path.posix.basename(file) !== SKILL_FILE) continue;
        const dir = dirOf(file);
        dirs.add(dir);
        const name = frontmatterName(fs.readFileSync(path.join(root, file), 'utf8')) ?? path.posix.basename(dir);
        if (!byName.has(name)) byName.set(name, dir);
    }
    return { dirs, byName };
}

function ownSkillDir(file, dirs) {
    for (let dir = dirOf(file); ; dir = dirOf(dir)) {
        if (dirs.has(dir)) return dir;
        if (!dir) return null;
    }
}

function joinPosix(...parts) {
    const joined = path.posix.normalize(parts.filter(Boolean).join('/'));
    return joined === '.' || joined.startsWith('../') ? null : joined;
}

function decoded(target) {
    try {
        return decodeURIComponent(target);
    } catch {
        return target;
    }
}

function cleanToken(token) {
    return token.replace(/[.,:;-]+$/, '');
}

export function findReferences(root, file, universe = null) {
    const files = universe ?? new Set(enumerate(root).map((f) => f.path));
    const { dirs, byName } = indexSkills(root, files);
    const own = ownSkillDir(file, dirs);
    const here = dirOf(file);
    const found = new Map();
    const add = (target, via, line, extra = {}) => {
        if (!target || target === file || !files.has(target)) return;
        const entry = found.get(target) ?? { path: target, via: [], lines: [], ...extra };
        if (!entry.via.includes(via)) entry.via.push(via);
        if (!entry.lines.includes(line)) entry.lines.push(line);
        found.set(target, entry);
    };

    const resolvePath = (token) => {
        const bases = token.includes('/') ? [here, own, '', own ? dirOf(own) : null] : [here, own];
        const roots = bases.filter((base, i, all) => base !== null && all.indexOf(base) === i);
        for (const base of roots) {
            const candidate = joinPosix(base, token);
            if (candidate && files.has(candidate)) return candidate;
        }
        const [first, ...rest] = token.split('/');
        if (rest.length && byName.has(first)) {
            const candidate = joinPosix(byName.get(first), ...rest);
            if (candidate && files.has(candidate)) return candidate;
        }
        return null;
    };

    const variableTargets = (rest) => {
        const homes = [...(own === null ? [] : [own]), ...[...dirs].filter((dir) => dir !== own)];
        return homes.map((dir) => joinPosix(dir, rest)).filter((candidate) => candidate && files.has(candidate));
    };

    const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
        const line = index + 1;
        for (const match of text.matchAll(LINK)) {
            const target = decoded((match[1] ?? match[2]).replace(/[#?].*$/, ''));
            if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
            add(target.startsWith('/') ? target.slice(1) : joinPosix(here, target), 'link', line);
        }
        for (const match of text.matchAll(TOKEN)) {
            const token = cleanToken(match[0]);
            if (!token.includes('/') && !/\.[A-Za-z0-9]{1,6}$/.test(token)) continue;
            const variable = VARIABLE.exec(token);
            if (variable) {
                const [primary, ...others] = variableTargets(variable[2]);
                if (primary) add(primary, `variable $${variable[1]}`, line, others.length ? { alternatives: others } : {});
                continue;
            }
            if (token.includes('$') || token.includes('{')) continue;
            add(resolvePath(token), 'path', line);
        }
        for (const match of text.matchAll(BACKTICKED)) {
            const name = match[1];
            if (!SKILL_NAME.test(name) || !byName.has(name)) continue;
            const before = text.slice(0, match.index);
            const after = text.slice(match.index + match[0].length);
            if (BEFORE_SKILL_NAME.test(before) || AFTER_SKILL_NAME.test(after)) add(joinPosix(byName.get(name), SKILL_FILE), 'skill', line);
        }
    });
    return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function render(results) {
    const out = [];
    for (const { file, references } of results) {
        out.push(file);
        if (!references.length) out.push('  (no candidates)');
        for (const ref of references) {
            const alternatives = ref.alternatives ? `  ambiguous, also: ${ref.alternatives.join(', ')}` : '';
            out.push(`  ${ref.path}  ${ref.via.join(', ')}  line ${ref.lines.join(',')}${alternatives}`);
        }
    }
    return out.join('\n');
}

function main() {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const [root, ...targets] = args.filter((a) => !a.startsWith('--'));
    if (!root || !targets.length) {
        console.error(USAGE);
        process.exit(2);
    }
    const universe = new Set(enumerate(root).map((f) => f.path));
    const results = [];
    for (const target of targets) {
        const file = path.posix.normalize(target.split(path.sep).join('/'));
        if (!universe.has(file)) {
            console.error(`refs: ${file} is not in the enumerated set of ${root}`);
            process.exit(2);
        }
        results.push({ file, references: findReferences(path.resolve(root), file, universe) });
    }
    console.log(json ? JSON.stringify(results, null, 2) : render(results));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
