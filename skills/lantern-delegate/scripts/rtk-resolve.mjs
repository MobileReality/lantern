import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const LOOKUP_TIMEOUT_MS = 3000;
const WIN_EXTENSIONS = ['.exe', '.com'];
const DEFAULT_FIXED_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin', '/usr/bin'];

export function defaultContext(env = process.env) {
    return { platform: process.platform, env, home: homedir(), fixedDirs: fixedDirsFrom(env), isRunnable, runShell };
}

function fixedDirsFrom(env) {
    const override = env.LANTERN_RTK_FIXED_DIRS;
    if (override === undefined) return process.platform === 'win32' ? [] : DEFAULT_FIXED_DIRS;
    return override.split(path.delimiter).filter(Boolean);
}

function isRunnable(file) {
    try {
        if (!statSync(file).isFile()) return false;
        accessSync(file, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

export function runShell(file, args, env) {
    return new Promise((resolve) => {
        const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'ignore'], timeout: LOOKUP_TIMEOUT_MS, windowsHide: true });
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.on('error', () => resolve(null));
        child.on('close', (code) => resolve(code === 0 ? stdout : null));
    });
}

function pathApiFor(platform) {
    return platform === 'win32' ? path.win32 : path.posix;
}

function envValue(ctx, name) {
    if (ctx.platform !== 'win32') return ctx.env[name] || '';
    const key = Object.keys(ctx.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return (key && ctx.env[key]) || '';
}

export function knownLocations(ctx) {
    const p = pathApiFor(ctx.platform);
    if (ctx.platform === 'win32') {
        const profile = envValue(ctx, 'USERPROFILE') || ctx.home;
        const local = envValue(ctx, 'LOCALAPPDATA');
        return [p.join(profile, '.cargo', 'bin', 'rtk.exe'), local && p.join(local, 'Programs', 'rtk', 'rtk.exe'), p.join(profile, '.local', 'bin', 'rtk.exe')].filter(Boolean);
    }
    return [
        p.join(ctx.home, '.local', 'bin', 'rtk'),
        p.join(ctx.home, '.cargo', 'bin', 'rtk'),
        ...(ctx.fixedDirs ?? []).map((dir) => p.join(dir, 'rtk')),
    ];
}

export function pathCandidates(ctx) {
    const p = pathApiFor(ctx.platform);
    const delimiter = ctx.platform === 'win32' ? ';' : ':';
    const names = ctx.platform === 'win32' ? WIN_EXTENSIONS.map((ext) => `rtk${ext}`) : ['rtk'];
    return envValue(ctx, 'PATH')
        .split(delimiter)
        .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
        .filter((dir) => dir && p.isAbsolute(dir))
        .flatMap((dir) => names.map((name) => p.join(dir, name)));
}

function lookupEnv(ctx) {
    return { ...ctx.env, HISTFILE: '/dev/null', SHELL_SESSIONS_DISABLE: '1' };
}

function resolvable(ctx, file) {
    const p = pathApiFor(ctx.platform);
    if (!p.isAbsolute(file)) return false;
    if (ctx.platform === 'win32' && !WIN_EXTENSIONS.includes(p.extname(file).toLowerCase())) return false;
    return ctx.isRunnable(file);
}

async function loginShellLookup(ctx) {
    const env = lookupEnv(ctx);
    const out =
        ctx.platform === 'win32'
            ? await ctx.runShell('where', ['rtk'], env)
            : await ctx.runShell(envValue(ctx, 'SHELL') || (ctx.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), ['-ilc', 'command -v rtk'], env);
    const lines = (out ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    return (ctx.platform === 'win32' ? lines : lines.reverse()).find((l) => resolvable(ctx, l)) ?? null;
}

export async function resolveRtk(ctx = defaultContext(), { loginShell = true } = {}) {
    const direct = [...new Set([...knownLocations(ctx), ...pathCandidates(ctx)])].find((file) => ctx.isRunnable(file));
    if (direct) return direct;
    return loginShell ? loginShellLookup(ctx) : null;
}
