import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const MAX_PARALLEL = 4;
export const CALL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const MAX_ERROR_CHARS = 300;
const SCRATCH_PREFIX = 'areas-reader-';

export const claudeArgs = (model) => ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'];

function installedClaude(env) {
    const home = env.HOME ?? os.homedir();
    const candidates = [
        path.join(home, '.local', 'bin', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        path.join(home, '.npm-global', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
        path.join(home, '.volta', 'bin', 'claude'),
        path.join(home, '.bun', 'bin', 'claude'),
    ];
    return candidates.find((c) => fs.existsSync(c));
}

export const resolveClaude = (env = process.env) => env.CLAUDE_BIN || installedClaude(env) || 'claude';

export function childEnv(env = process.env) {
    const clean = { ...env };
    delete clean.ELECTRON_RUN_AS_NODE;
    return clean;
}

export function makeScratch(root) {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), SCRATCH_PREFIX));
    const inside = !path.relative(fs.realpathSync(root), dir).startsWith('..');
    if (inside) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`the scratch directory ${dir} lies inside the project ${root}`);
    }
    return dir;
}

export function claudeLauncher({ model, env = process.env }) {
    return { command: resolveClaude(env), args: claudeArgs(model), shell: false, parse: parseClaudeReply };
}

export function readerLauncher(command) {
    return { command, args: [], shell: true, parse: (stdout) => ({ text: stdout.trim() }) };
}

function parseClaudeReply(stdout) {
    let reply;
    try {
        reply = JSON.parse(stdout.trim());
    } catch {
        return { error: 'claude returned an unreadable reply' };
    }
    if (reply?.is_error === true) return { error: String(reply.result ?? 'claude reported an error').slice(0, MAX_ERROR_CHARS) };
    const cost = Number.isFinite(reply?.total_cost_usd) ? reply.total_cost_usd : undefined;
    return { text: String(reply?.result ?? '').trim(), cost };
}

function killGroup(proc) {
    try {
        if (proc.pid > 1) process.kill(-proc.pid, 'SIGKILL');
        else proc.kill('SIGKILL');
    } catch {
        proc.kill('SIGKILL');
    }
}

export function askOnce(launcher, { packet, cwd, env, timeoutMs }) {
    return new Promise((resolve) => {
        let settled = false;
        let stdout = '';
        let stderr = '';
        const proc = spawn(launcher.command, launcher.args, { cwd, env, shell: launcher.shell, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ error: `timed out after ${Math.round(timeoutMs / 1000)} seconds` });
            killGroup(proc);
        }, timeoutMs);
        proc.stdout.on('data', (d) => {
            if (stdout.length < MAX_OUTPUT_CHARS) stdout += d.toString();
        });
        proc.stderr.on('data', (d) => {
            stderr = `${stderr}${d.toString()}`.slice(-MAX_ERROR_CHARS);
        });
        proc.on('error', (e) => finish({ error: e.message }));
        proc.on('close', (code) => {
            const parsed = launcher.parse(stdout);
            if (code !== 0) return finish({ error: parsed.error && stderr.trim() === '' ? parsed.error : stderr.trim().split('\n')[0] || `exited ${code}` });
            if (parsed.error) return finish(parsed);
            finish(parsed.text ? parsed : { error: 'empty answer' });
        });
        proc.stdin.on('error', () => {});
        proc.stdin.end(packet);
    });
}

export async function answerAll(packets, launcher, options) {
    const results = new Array(packets.length);
    let next = 0;
    const worker = async () => {
        while (next < packets.length) {
            const at = next++;
            results[at] = await askOnce(launcher, { ...options, packet: packets[at].text });
        }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, packets.length) }, worker));
    return packets.map((p, i) => ({ feature: p.feature, ...results[i] }));
}
