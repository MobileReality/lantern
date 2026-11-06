import { spawnSync } from 'node:child_process';
import { LINE, say } from './plan-messages.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;

export function runPlanJson(planScript, args) {
    const run = spawnSync(process.execPath, [planScript, ...args, '--json'], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
    try {
        return { report: JSON.parse(run.stdout) };
    } catch {
        return { failure: `${run.stderr ?? ''}`.trim().split('\n')[0] || say(LINE.RUN_EXIT, { status: run.status }) };
    }
}
