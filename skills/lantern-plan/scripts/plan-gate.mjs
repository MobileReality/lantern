import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MAP_DIR } from '../../lantern-setup/scripts/lib.mjs';
import { siblingSkill } from '../../lantern-setup/scripts/shell.mjs';
import { LINE, say } from './plan-messages.mjs';
import { formatSkillCheck } from './planning-skills.mjs';

const VALIDATE = path.join(siblingSkill(import.meta.url, 'lantern-setup'), 'scripts', 'validate.mjs');
const SHOWN_PROBLEMS = 6;
const COVERAGE = /coverage (\d+)\/\d+/;
const MAX_BUFFER = 64 * 1024 * 1024;

function mapGate(root) {
    const hint = say(LINE.GATE_MAP_HINT);
    if (!fs.existsSync(path.join(root, MAP_DIR))) return { ok: false, lines: [say(LINE.GATE_NO_MAP, { root, mapDir: MAP_DIR, hint })] };
    if (!fs.existsSync(VALIDATE)) return { ok: false, lines: [say(LINE.GATE_NO_SETUP, { validate: VALIDATE })] };
    const run = spawnSync(process.execPath, [VALIDATE, root, '--settled'], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
    if (run.status === 0) return { ok: true, lines: [say(LINE.GATE_MAP_OK, { coverage: (run.stdout.match(COVERAGE) ?? [])[0] ?? say(LINE.GATE_SETTLED) })] };
    const problems = `${run.stdout}${run.stderr}`.split('\n').filter((line) => line.startsWith('  ')).map((line) => line.trim());
    const shown = problems.slice(0, SHOWN_PROBLEMS).map((text) => say(LINE.GATE_ROW, { text }));
    const more = problems.length > SHOWN_PROBLEMS ? [say(LINE.GATE_MORE, { count: problems.length - SHOWN_PROBLEMS })] : [];
    return { ok: false, lines: [say(LINE.GATE_MAP_FAIL, { status: run.status, hint }), ...shown, ...more] };
}

export function runGate(root, skillResults) {
    const map = mapGate(root);
    const skillsOk = skillResults.every((r) => r.found);
    const ok = map.ok && skillsOk;
    return { ok, map: map.ok, skills: skillsOk, lines: [...map.lines, ...formatSkillCheck(skillResults), say(ok ? LINE.GATE_OPEN : LINE.GATE_CLOSED)] };
}
