import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { message } from './messages.mjs';

export const IDENTITY_VARS = Object.freeze(['GIT_COMMIT_NAME', 'GIT_COMMIT_EMAIL']);

const ENV_FILES = ['.ai/.env', '.env'];
const MAIN_GIT_DIR = '.git';
const ENV_LINE = /^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/;

export function git(...args) {
    const command = `git ${args.join(' ')}`;
    try {
        return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (cause) {
        const said = String(cause.stderr ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('; ');
        const error = new Error(said || cause.message || message('git.exited', { command, status: cause.status ?? message('git.exitedAbnormally') }));
        error.command = command;
        throw error;
    }
}

export function mainCheckoutRoot() {
    try {
        const common = git('rev-parse', '--git-common-dir');
        if (common && common !== MAIN_GIT_DIR) return common.replace(/\/\.git\/?$/, '');
    } catch {
        return null;
    }
    return null;
}

function identityFiles() {
    const root = mainCheckoutRoot();
    return root ? [...ENV_FILES, ...ENV_FILES.map((file) => `${root}/${file}`)] : ENV_FILES;
}

function loadIdentityEnv() {
    const env = {};
    for (const file of identityFiles().filter((path) => existsSync(path))) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
            const found = ENV_LINE.exec(line);
            if (found && IDENTITY_VARS.includes(found[1]) && !env[found[1]]) env[found[1]] = found[2];
        }
    }
    return env;
}

export function resolveIdentityVar(name) {
    if (!IDENTITY_VARS.includes(name)) return undefined;
    return process.env[name] || loadIdentityEnv()[name] || undefined;
}
