import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { siblingSkill } from '../../lantern-setup/scripts/shell.mjs';
import { LINE, NOUN, say } from './plan-messages.mjs';

const SKILL_FILE = 'SKILL.md';

export const PLANNING_SKILLS = [
    { name: 'lantern-plan', purpose: say(NOUN.PURPOSE_ENTRY) },
    { name: 'lantern-plan-impact', purpose: say(NOUN.PURPOSE_IMPACT) },
    { name: 'lantern-plan-stages', purpose: say(NOUN.PURPOSE_STAGES) },
    { name: 'lantern-plan-review', purpose: say(NOUN.PURPOSE_REVIEW) },
    { name: 'lantern-plan-handoff', purpose: say(NOUN.PURPOSE_HANDOFF) },
];

export const STEP_SKILLS = [
    { step: 1, name: say(NOUN.STEP_GATE), read: ['lantern-plan'] },
    { step: 2, name: say(NOUN.STEP_IMPACT), read: ['lantern-plan-impact'] },
    { step: 3, name: say(NOUN.STEP_STAGES), read: ['lantern-plan-stages'] },
    { step: 4, name: say(NOUN.STEP_WRITE), read: ['lantern-plan-stages'] },
    { step: 5, name: say(NOUN.STEP_REVIEW), read: ['lantern-plan-review'] },
    { step: 6, name: say(NOUN.STEP_APPROVE), read: ['lantern-plan-review'] },
    { step: 7, name: say(NOUN.STEP_HANDOFF), read: ['lantern-plan-handoff'] },
];

export const PLANNING_SKILL_NAMES = PLANNING_SKILLS.map((skill) => skill.name);

export function registryRoots(cwd = process.cwd(), home = os.homedir()) {
    const sibling = path.dirname(siblingSkill(import.meta.url, 'lantern-plan'));
    return [path.join(cwd, '.claude', 'skills'), path.join(cwd, '.agents', 'skills'), path.join(home, '.claude', 'skills'), sibling];
}

export function checkPlanningSkills(roots = registryRoots()) {
    return PLANNING_SKILLS.map(({ name, purpose }) => {
        const root = roots.find((candidate) => fs.existsSync(path.join(candidate, name, SKILL_FILE)));
        return { name, purpose, found: root ? path.join(root, name) : null };
    });
}

export function formatSkillCheck(results) {
    const lines = results.map((r) => say(r.found ? LINE.SKILL_OK : LINE.SKILL_MISSING, r));
    const missing = results.filter((r) => !r.found).map((r) => r.name);
    if (missing.length) return [...lines, say(LINE.SKILLS_MISSING, { count: missing.length, names: missing.join(', ') })];
    return [...lines, say(LINE.SKILLS_ALL_OK), ...STEP_SKILLS.map((s) => say(LINE.STEP_ROW, { step: s.step, name: s.name, read: s.read.join(', ') }))];
}
