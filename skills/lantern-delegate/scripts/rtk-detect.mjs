import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findRtkHooks } from './rtk-hook.mjs';
import { defaultContext, resolveRtk } from './rtk-resolve.mjs';

const VERSION_TIMEOUT_MS = 3000;
const PROBE_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const VERSION_LINE = /^rtk(?:-oss)?\s+v?(\d+\.\d+\.\d+\S*)/i;
const MISSING_SUBCOMMAND = /unrecogni[sz]ed|unknown (sub)?command|invalid (sub)?command|no such (sub)?command|not a valid (sub)?command/i;

export const RTK_EDITIONS = { full: 'full', oss: 'oss', unknown: 'unknown' };
export const RTK_REASONS = { notInstalled: 'not-installed', notRtk: 'not-rtk', probeFailed: 'probe-failed' };

// UNVERIFIED: inferred from RTK's editions.md, never run against a real RTK.
const FULL_ONLY_SUBCOMMAND = 'pipeline';

export function rtkDetectionDisabled(env = process.env) {
    return env.LANTERN_RTK_DETECT === 'off';
}

export function runProbe(file, args, { env, timeoutMs }) {
    return new Promise((resolve) => {
        const child = execFile(file, args, { env, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: Boolean(error?.killed) });
        });
        child.stdin?.end();
    });
}

function emptyStatus(hookFiles) {
    return { found: false, path: null, version: null, edition: null, hookFound: hookFiles.length > 0, hookFiles, reason: null };
}

function lacksSubcommand(result) {
    return !result.timedOut && result.code !== 0 && MISSING_SUBCOMMAND.test(`${result.stderr}\n${result.stdout}`);
}

async function inferEdition(run, file) {
    const result = await run(file, [FULL_ONLY_SUBCOMMAND, '--help'], PROBE_TIMEOUT_MS);
    if (result.code === 0) return RTK_EDITIONS.full;
    return lacksSubcommand(result) ? RTK_EDITIONS.oss : RTK_EDITIONS.unknown;
}

async function probeRtk(file, probe, sandbox) {
    const env = { ...sandbox.env, RTK_DB_PATH: join(sandbox.dir, 'history.db') };
    const run = (target, args, timeoutMs) => probe(target, args, { env, timeoutMs });
    const version = await run(file, ['--version'], VERSION_TIMEOUT_MS);
    if (version.timedOut) return { reason: RTK_REASONS.probeFailed };
    const match = version.code === 0 ? VERSION_LINE.exec(version.stdout.trim().split(/\r?\n/)[0] ?? '') : null;
    if (!match) return { reason: RTK_REASONS.notRtk };
    const gain = await run(file, ['gain'], PROBE_TIMEOUT_MS);
    if (lacksSubcommand(gain)) return { reason: RTK_REASONS.notRtk };
    if (gain.code !== 0) return { reason: RTK_REASONS.probeFailed };
    return { version: match[1], edition: await inferEdition(run, file) };
}

export async function detectRtk({ projectDirs = [], ctx = defaultContext(), probe = runProbe, loginShell = true } = {}) {
    const status = emptyStatus(findRtkHooks(projectDirs, ctx.home));
    const file = await resolveRtk(ctx, { loginShell });
    if (!file) return { ...status, reason: RTK_REASONS.notInstalled };
    const dir = await mkdtemp(join(tmpdir(), 'lantern-rtk-'));
    try {
        const probed = await probeRtk(file, probe, { dir, env: ctx.env });
        if (probed.reason) return { ...status, path: file, reason: probed.reason };
        return { ...status, found: true, path: file, version: probed.version, edition: probed.edition };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export function describeRtk(status) {
    if (status.found) return { level: 'ok', check: 'rtk', detail: `${status.path} ${status.version} ${status.edition}` };
    if (status.reason === RTK_REASONS.notRtk) return { level: 'note', check: 'rtk', detail: `${status.path} is not RTK (Rust Token Killer), ignored (optional)` };
    if (status.reason === RTK_REASONS.probeFailed) return { level: 'note', check: 'rtk', detail: `${status.path} did not answer the RTK check, ignored (optional)` };
    return { level: 'note', check: 'rtk', detail: 'not installed (optional)' };
}

export function describeRtkHook(status) {
    if (!status.hookFound) return null;
    return {
        level: 'warn',
        check: 'rtk-hook',
        detail:
            `an \`rtk hook claude\` entry is set in ${status.hookFiles.join(', ')}. Claude Code refuses the git commands that hook rewrites inside a worktree-isolated delegate, ` +
            'so delegates would fail on git. Lantern changes nothing: add git to the `exclude_commands` of your RTK config, or run `rtk init -g --uninstall` yourself.',
    };
}
