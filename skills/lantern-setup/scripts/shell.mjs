import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GIT_BUFFER = 256 * 1024 * 1024;
const SKILL_MARKER = 'SKILL.md';

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function runGit(root, args, { input } = {}) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: GIT_BUFFER, input });
    return { ok: !result.error && result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error ?? null, status: result.status };
}

function scriptPaths(selfUrl) {
    const scripts = new Set([path.resolve(fileURLToPath(selfUrl))]);
    if (process.argv[1]) {
        scripts.add(path.resolve(process.argv[1]));
        try {
            scripts.add(fs.realpathSync(process.argv[1]));
        } catch {}
    }
    return [...scripts];
}

export function siblingSkill(selfUrl, name, probe = SKILL_MARKER) {
    const candidates = scriptPaths(selfUrl).map((script) => path.join(path.dirname(path.dirname(path.dirname(script))), name));
    return candidates.find((candidate) => fs.existsSync(path.join(candidate, probe))) ?? candidates[0];
}
