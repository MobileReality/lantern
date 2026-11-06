import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { ExtensionsError, readSkillLinker } from './extensions.mjs';
import { message } from './messages.mjs';

function isExecutableFile(file) {
    try {
        if (!statSync(file).isFile()) return false;
        accessSync(file, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isDirectory(dir) {
    return statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function skillsRepoOf(file) {
    const dirs = [dirname(file)];
    try {
        dirs.push(dirname(realpathSync(file)));
    } catch {
        // the file vanished between the checks: the plain dirname still answers
    }
    return dirs.find((dir) => isDirectory(join(dir, 'core'))) ?? null;
}

function executablesIn(dir) {
    try {
        return readdirSync(dir)
            .sort()
            .map((name) => join(dir, name))
            .filter(isExecutableFile);
    } catch {
        return [];
    }
}

const PROBLEM_KEYS = {
    missing: 'skillLinker.missing',
    notFile: 'skillLinker.notFile',
    notExecutable: 'skillLinker.notExecutable',
    noCore: 'skillLinker.noCore',
    folderNoExecutable: 'skillLinker.folderNoExecutable',
    folderNoCore: 'skillLinker.folderNoCore',
    folderSeveral: 'skillLinker.folderSeveral',
};

function problemOf(kind, params) {
    return { problem: message(PROBLEM_KEYS[kind], params), kind, params };
}

function problemFor(configured) {
    const stat = statSync(configured, { throwIfNoEntry: false });
    if (!stat) return problemOf('missing', { path: configured });
    if (!stat.isFile()) return problemOf('notFile', { path: configured });
    if (!isExecutableFile(configured)) return problemOf('notExecutable', { path: configured });
    return problemOf('noCore', { path: configured });
}

function folderProblem(dir) {
    const executables = executablesIn(dir);
    if (!executables.length) return problemOf('folderNoExecutable', { path: dir });
    const linkers = executables.filter((file) => skillsRepoOf(file));
    if (!linkers.length) return problemOf('folderNoCore', { path: dir });
    const bare = linkers.filter((file) => !extname(file));
    if (linkers.length > 1 && bare.length === 1) return { path: bare[0] };
    if (linkers.length > 1) return problemOf('folderSeveral', { path: dir, names: linkers.map((file) => basename(file)).join(', ') });
    return { path: linkers[0] };
}

export function resolveLinkerPath(configured, source = 'config') {
    const folder = isDirectory(configured) ? folderProblem(configured) : null;
    const file = folder?.path ?? configured;
    const repo = isExecutableFile(file) ? skillsRepoOf(file) : null;
    if (repo) return { path: file, source, repo };
    const { problem, kind, params } = folder ?? problemFor(configured);
    return { problem, problemKind: kind, problemParams: params, error: message('skillLinker.prefixed', { source, problem }) };
}

export const SKILLS_REPO_ENV = 'SKILLS_REPO';
export const SKILL_LINKER_SOURCE = Object.freeze({ env: 'SKILL_LINKER', config: 'config', repo: 'repo' });

function linkerFromRepo(env) {
    if (!env[SKILLS_REPO_ENV]) return {};
    const repo = resolve(env[SKILLS_REPO_ENV]);
    if (!isDirectory(repo)) return {};
    const resolved = resolveLinkerPath(repo, SKILL_LINKER_SOURCE.repo);
    return resolved.path ? resolved : {};
}

export function resolveSkillLinker({ env = process.env, home = homedir() } = {}) {
    let source = SKILL_LINKER_SOURCE.env;
    let configured = env.SKILL_LINKER ? resolve(env.SKILL_LINKER) : null;
    if (!configured) {
        source = SKILL_LINKER_SOURCE.config;
        try {
            configured = readSkillLinker(home);
        } catch (cause) {
            if (!(cause instanceof ExtensionsError)) throw cause;
            return { error: cause.message, problem: cause.message };
        }
    }
    if (!configured) return linkerFromRepo(env);
    return resolveLinkerPath(configured, source);
}

export function configuredSkillLinkerPath(options) {
    return resolveSkillLinker(options).path ?? null;
}

export function isSkillLinkerWord(word, linkerPath) {
    return Boolean(linkerPath) && typeof word === 'string' && (word === linkerPath || basename(word) === basename(linkerPath));
}
