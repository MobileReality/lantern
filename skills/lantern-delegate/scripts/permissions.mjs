import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUSH_BRANCH_TYPES = ['feat', 'fix', 'docs', 'chore'];

export const REQUIRED_ALLOW = [
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git show:*)',
    'Bash(git rev-parse:*)',
    'Bash(git rev-list:*)',
    'Bash(git merge-base:*)',
    'Bash(git ls-files:*)',
    'Bash(git hash-object:*)',
    'Bash(git branch --show-current)',
    'Bash(git branch -m:*)',
    'Bash(git fetch origin:*)',
    'Bash(git reset --hard origin/*)',
    'Bash(git merge --no-edit origin/*)',
    'Bash(git add:*)',
    'Bash(git rm:*)',
    'Bash(git commit:*)',
    ...PUSH_BRANCH_TYPES.map((type) => `Bash(git push origin HEAD:refs/heads/${type}/*)`),
];

export const EDIT_TOOLS = ['Edit', 'Write'];

export const EDIT_TARGETS = [
    { pattern: '.lantern/map/**', writer: 'lantern-mapper, setup agent, delegate re-mapping (includes the %2Eclaude alias folders)', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/lang/**', writer: 'lantern-mapper, setup agent, delegate re-mapping (texts, areas.json, features.json; includes the %2Eclaude alias folders)', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/areas', writer: 'setup agent, delegate (Areas loop)', source: 'skills/lantern-delegate/protocol.md' },
    { pattern: '.lantern/features', writer: 'setup agent, delegate (a new feature id)', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/platforms', writer: 'setup agent', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/ignore', writer: 'setup agent', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/include', writer: 'setup agent', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/sections/**', writer: 'setup agent', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.lantern/plans/*.plan', writer: 'lantern-plan agent', source: 'skills/lantern-plan/SKILL.md' },
    { pattern: '.ai/tmp/reason.json', writer: 'delegate, lantern-sync (reasons per changed file)', source: 'skills/lantern-delegate/protocol.md' },
    { pattern: '.ai/tmp/order.json', writer: 'delegate (review order)', source: 'skills/lantern-delegate/protocol.md' },
    { pattern: '.ai/tmp/flow.json', writer: 'delegate, lantern-plan-stages (flow)', source: 'skills/lantern-delegate/protocol.md' },
    { pattern: '.ai/tmp/describe.json', writer: 'delegate (PR description)', source: 'skills/lantern-delegate/protocol.md' },
    { pattern: '.ai/tmp/pr-body.md', writer: 'delegate (PR body)', source: 'skills/lantern-delegate/protocol.md' },
    { pattern: '.ai/tmp/areas/answers.json', writer: 'setup agent (blind lookup answers)', source: 'skills/lantern-setup/SKILL.md' },
    { pattern: '.ai/runs/**', writer: 'delegate and lantern-local-loop (PLAN.md, HANDOFF.md)', source: 'skills/lantern-delegate/protocol.md' },
];

export function editAllow() {
    return EDIT_TARGETS.flatMap(({ pattern }) => EDIT_TOOLS.map((tool) => `${tool}(${pattern})`));
}

export function defaultSkillRoots(cwd = process.cwd(), home = homedir()) {
    return [join(cwd, '.claude', 'skills'), join(home, '.claude', 'skills')];
}

export function nodeAllow(skillRoots) {
    return skillRoots.map((root) => `Bash(node ${root}/*)`);
}

export const LINK_ALLOW = ['Bash(mkdir -p .claude)'];

export function linkAllow(skillRoots) {
    return skillRoots.map((root) => `Bash(ln -s ${root} .claude/skills)`);
}

export function skillLinkerAllow(skillLinker) {
    return skillLinker ? [`Bash(${skillLinker} --list)`, `Bash(${skillLinker} . --skill:*)`] : [];
}

export function skillLinkerDeny(skillLinker) {
    return skillLinker ? [`Bash(${skillLinker} * --unlink*)`, `Bash(${skillLinker} * -u*)`] : [];
}

export function requiredAllow(skillRoots = defaultSkillRoots(), skillLinker = undefined) {
    return [...REQUIRED_ALLOW, ...LINK_ALLOW, ...nodeAllow(skillRoots), ...linkAllow(skillRoots), ...skillLinkerAllow(skillLinker), ...editAllow()];
}

export const ORCHESTRATOR_ALLOW = ['Bash(git worktree list)', 'Bash(git worktree add:*)', 'Bash(git worktree remove:*)'];

export const DENY = [
    'Bash(git push --force*)',
    'Bash(git push -f*)',
    'Bash(git push * --force*)',
    'Bash(git push * -f*)',
    'Bash(git push * --delete*)',
    'Bash(git push origin HEAD:refs/heads/* *)',
    'Bash(git merge --no-edit origin/* *)',
    'Bash(git reset --hard origin/* *)',
    'Bash(node *../*)',
];

export const LIMITS =
    'A delegate cannot answer a prompt: no interactive login or OAuth (for example `npx convex dev`, `firebase login`, `gh auth login`), ' +
    'so it cannot start a backend or a dev server that needs one, and it cannot open a browser or a desktop app and look at it. ' +
    'If the task needs that, say so in the dispatch line and keep it out of Verify.';

export function settingsSnippet({ orchestrator = true, skillRoots = defaultSkillRoots(), skillLinker = undefined } = {}) {
    const allow = orchestrator ? [...requiredAllow(skillRoots, skillLinker), ...ORCHESTRATOR_ALLOW] : requiredAllow(skillRoots, skillLinker);
    return JSON.stringify({ permissions: { allow, deny: [...DENY, ...skillLinkerDeny(skillLinker)] } }, null, 2);
}

function readJson(file) {
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

export function settingsFiles(dirs, home = homedir()) {
    const files = [];
    for (const dir of dirs) files.push(join(dir, '.claude', 'settings.json'), join(dir, '.claude', 'settings.local.json'));
    files.push(join(home, '.claude', 'settings.json'));
    return [...new Set(files)];
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function brokenSettings(files) {
    const broken = [];
    for (const file of files) {
        if (!existsSync(file)) continue;
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(file, 'utf8'));
        } catch (e) {
            broken.push({ file, problem: `not valid JSON (${e.message})` });
            continue;
        }
        if (!isPlainObject(parsed)) {
            broken.push({ file, problem: 'the top level is not a JSON object' });
            continue;
        }
        const { permissions } = parsed;
        if (permissions === undefined) continue;
        if (!isPlainObject(permissions)) {
            broken.push({ file, problem: '"permissions" is not an object' });
            continue;
        }
        for (const key of ['allow', 'deny']) {
            if (permissions[key] !== undefined && !Array.isArray(permissions[key])) broken.push({ file, problem: `"permissions.${key}" is not an array` });
        }
    }
    return broken;
}

export function allowedRules(files) {
    const rules = [];
    for (const file of files) {
        const allow = readJson(file)?.permissions?.allow;
        if (Array.isArray(allow)) rules.push(...allow.filter((rule) => typeof rule === 'string'));
    }
    return rules;
}

function innerOf(rule) {
    const match = /^Bash\((.*)\)$/s.exec(rule);
    return match ? match[1] : null;
}

const EDIT_RULE = /^(Edit|Write)\((.*)\)$/s;

function editRuleParts(rule) {
    const match = EDIT_RULE.exec(rule);
    if (!match) return null;
    return { tool: match[1], pattern: match[2].replace(/^\.\//, '') };
}

function globToRegExp(pattern) {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '*' && pattern[i + 1] === '*') {
            if (pattern[i + 2] === '/') {
                source += '(?:.*/)?';
                i += 2;
            } else {
                source += '.*';
                i += 1;
            }
        } else if (char === '*') source += '[^/]*';
        else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${source}$`, 's');
}

export function editRuleMatches(rule, tool, path) {
    if (rule === tool || rule === `${tool}(*)` || rule === `${tool}(**)`) return true;
    const parts = editRuleParts(rule);
    if (!parts || parts.tool !== tool) return false;
    return globToRegExp(parts.pattern).test(path.replace(/^\.\//, ''));
}

export function ruleMatches(rule, command) {
    if (rule === 'Bash' || rule === 'Bash(*)') return true;
    const inner = innerOf(rule);
    if (inner === null) return false;
    const spaced = command.replace(/[ \t]+/g, ' ');
    if (inner.endsWith(':*')) {
        const prefix = inner.slice(0, -2);
        return spaced === prefix || spaced.startsWith(`${prefix} `);
    }
    if (!inner.includes('*')) return spaced === inner;
    const source = inner
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${source}$`, 's').test(spaced);
}

export function covers(allow, need) {
    if (allow === need) return true;
    const edit = editRuleParts(need);
    if (edit) return editRuleMatches(allow, edit.tool, edit.pattern.replaceAll('**', 'x/x').replaceAll('*', 'x'));
    const wanted = innerOf(need);
    if (wanted === null) return false;
    const sample = wanted.endsWith(':*') ? wanted.slice(0, -2) : wanted.replaceAll('*', 'x');
    return ruleMatches(allow, sample);
}

export function missingPermissions(files, needed = requiredAllow()) {
    const rules = allowedRules(files);
    return needed.filter((need) => !rules.some((rule) => covers(rule, need)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { resolveSkillLinker } = await import('./skill-linker.mjs');
    process.stdout.write(`${settingsSnippet({ skillLinker: resolveSkillLinker().path })}\n`);
}
