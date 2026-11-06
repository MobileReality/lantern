import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { message } from './messages.mjs';

export const HOST_SKILL = Object.freeze({
    bitbucket: { skill: 'lantern-bitbucket', script: 'bitbucket.mjs' },
    github: { skill: 'lantern-github', script: 'github.mjs' },
});

export const HOST_SKILL_NAMES = Object.values(HOST_SKILL).map(({ skill }) => skill);

const SKILL_FOLDERS = ['.claude/skills', '.agents/skills'];
const SKILL_TIMEOUT_MS = 120_000;
const THIS_SKILLS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function skillRoots({ cwd = process.cwd(), home = homedir() } = {}) {
    const searched = [cwd, home].flatMap((base) => SKILL_FOLDERS.map((folder) => join(base, folder)));
    return [...new Set([THIS_SKILLS_FOLDER, ...searched])];
}

export function hostScript(host, roots = skillRoots()) {
    const { skill, script } = HOST_SKILL[host];
    return roots.map((root) => join(root, skill, 'scripts', script)).find((file) => existsSync(file)) ?? null;
}

export function runHostSkill(host, args, { cwd = process.cwd(), env = process.env, roots = skillRoots({ cwd }) } = {}) {
    const script = hostScript(host, roots);
    if (!script) return { status: 1, stdout: '', stderr: message('hostSkill.missing', { skill: HOST_SKILL[host].skill, roots: roots.join(', ') }) };
    const result = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8', timeout: SKILL_TIMEOUT_MS });
    const stderr = result.stderr || (result.error ? message('hostSkill.failed', { skill: HOST_SKILL[host].skill, reason: result.error.message }) : '');
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr };
}
