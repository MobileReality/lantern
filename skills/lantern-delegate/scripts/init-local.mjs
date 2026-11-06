#!/usr/bin/env node
//
// init-local.mjs — make a brand-new folder dispatchable: git init -b main, a minimal .gitignore,
// one commit "chore: initial commit".
//
//   node init-local.mjs [dir]
//
// Only the orchestrator's explicit preflight step runs this (directly, or as preflight.mjs --init).
// A folder that already is a git work tree with a commit is left alone. A work tree with no commit
// gets the commit only. Refuses the home directory and a folder with more than 5000 files left
// after the ignore list. Never writes .lantern/ and never lists it in the .gitignore.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IGNORE_LINES = ['node_modules/', '.env', '.env.*', '.ai/.env', '.claude/', 'dist/', '.DS_Store'];
export const MAX_FILES = 5000;
export const INITIAL_COMMIT = 'chore: initial commit';

const gitEnv = () => {
    const env = { ...process.env };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
    return env;
};

function git(dir, args, extra = {}) {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv(), maxBuffer: 256 * 1024 * 1024, ...extra });
}

export function isWorkTree(dir) {
    try {
        return git(dir, ['rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
    } catch {
        return false;
    }
}

export function hasCommit(dir) {
    try {
        git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
        return true;
    } catch {
        return false;
    }
}

export function isHomeDirectory(dir) {
    return realpathSync(dir) === realpathSync(homedir());
}

function missingIgnoreLines(dir) {
    const path = join(dir, '.gitignore');
    const have = existsSync(path) ? new Set(readFileSync(path, 'utf8').split('\n').map((l) => l.trim())) : new Set();
    return IGNORE_LINES.filter((line) => !have.has(line));
}

export function countFilesAfterIgnore(dir) {
    const scratch = mkdtempSync(join(tmpdir(), 'init-local-'));
    try {
        const excludes = join(scratch, 'excludes');
        writeFileSync(excludes, `${IGNORE_LINES.join('\n')}\n`);
        const gitDir = join(scratch, 'git');
        execFileSync('git', ['init', '-q', '--bare', gitDir], { env: gitEnv(), stdio: 'ignore' });
        const listed = execFileSync(
            'git',
            [`--git-dir=${gitDir}`, `--work-tree=${dir}`, '-c', `core.excludesFile=${excludes}`, 'ls-files', '--others', '--exclude-standard', '-z'],
            { encoding: 'utf8', env: gitEnv(), maxBuffer: 256 * 1024 * 1024 },
        );
        return listed.split('\0').filter(Boolean).length;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

function writeIgnore(dir) {
    const missing = missingIgnoreLines(dir);
    if (!missing.length) return;
    const path = join(dir, '.gitignore');
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(path, `${existing}${separator}${missing.join('\n')}\n`);
}

export function initLocal(dirInput) {
    const dir = resolve(dirInput);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, reason: `${dir} is not a directory.` };
    if (isWorkTree(dir) && hasCommit(dir)) return { ok: true, changed: false, message: `${dir} is already a git repository.` };
    if (isHomeDirectory(dir)) {
        return { ok: false, reason: `${dir} is the home directory: not turning it into a repository. Open a project folder instead.` };
    }
    const alreadyRepo = isWorkTree(dir);
    const files = countFilesAfterIgnore(dir);
    if (files > MAX_FILES) {
        return {
            ok: false,
            reason: `${dir} holds ${files} files after ignoring (limit ${MAX_FILES}): refusing to commit that blindly. Ask the user which folder is the project.`,
        };
    }
    if (!alreadyRepo) git(dir, ['init', '-q', '-b', 'main']);
    writeIgnore(dir);
    git(dir, ['add', '-A']);
    try {
        git(dir, ['commit', '-q', '--allow-empty', '-m', INITIAL_COMMIT], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        const detail = `${e.stderr ?? ''}${e.stdout ?? ''}`.trim() || e.message;
        return { ok: false, reason: `the initial commit failed (is git user.name / user.email set?): ${detail}` };
    }
    return {
        ok: true,
        changed: true,
        message: `${alreadyRepo ? 'Committed' : 'Initialised a git repository on main with'} "${INITIAL_COMMIT}" (${files} files) in ${dir}.`,
    };
}

function main() {
    const result = initLocal(process.argv[2] ?? process.cwd());
    if (!result.ok) {
        console.error(result.reason);
        process.exit(1);
    }
    console.log(result.message);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
