#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { enabledSkills, ORCHESTRATOR_SKILLS, REQUIRED_SKILLS, REVIEWER_SKILLS } from './bundled-skills.mjs';
import { claudeSkillRoots, configuredExtras, resolvedExtras } from './extension-skills.mjs';
import { EXTENSION_SLOT, EXTENSION_SLOTS, projectRootOf } from './extensions.mjs';
import { HOST_SKILL_NAMES } from './host-skill.mjs';

export const ROLE = EXTENSION_SLOT;

export { ORCHESTRATOR_SKILLS, REQUIRED_SKILLS, REVIEWER_SKILLS };

export const PLAN_SKILLS = ['lantern-plan', 'lantern-plan-handoff'];

function assertRole(role) {
    if (!EXTENSION_SLOTS.includes(role)) throw new Error(`"${role}" is not a role; use one of: ${EXTENSION_SLOTS.join(', ')}`);
}

export function requiredSkills(role, extras = [], { plan = false, host = null, off = [] } = {}) {
    assertRole(role);
    const conditional = role === ROLE.orchestrator ? [...(host ? [host] : []), ...(plan ? PLAN_SKILLS : [])] : [];
    return [...new Set([...enabledSkills(role, off), ...conditional, ...extras])];
}

export function roleRequirements(role, { cwd = process.cwd(), home = homedir(), plan = false, host = null, project = projectRootOf(cwd) } = {}) {
    assertRole(role);
    const config = configuredExtras(home, project);
    const [cwdRoot, homeRoot] = claudeSkillRoots(cwd, home);
    const resolved = resolvedExtras(role, config.slots[role], [...new Set([cwdRoot, join(project, '.claude', 'skills'), homeRoot])]);
    return {
        required: requiredSkills(role, resolved.present, { plan, host, off: config.off[role] }),
        extras: resolved.present,
        off: config.off[role],
        warnings: [...config.warnings, ...resolved.warnings],
    };
}

const USAGE = `usage: required-skills.mjs [--role ${EXTENSION_SLOTS.join('|')}] [--plan] [--host <${HOST_SKILL_NAMES.join('|')}>] [--home <dir>] [--project <dir>]`;

export function parseRoleArgs(argv) {
    const options = { role: ROLE.delegate, plan: false, host: null, home: homedir(), rest: [] };
    let project = null;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--role') options.role = argv[++i];
        else if (arg === '--plan') options.plan = true;
        else if (arg === '--host') options.host = argv[++i];
        else if (arg === '--home') options.home = argv[++i];
        else if (arg === '--project') project = argv[++i] ?? '';
        else options.rest.push(arg);
    }
    const valid = EXTENSION_SLOTS.includes(options.role) && options.home !== undefined && project !== '' && (options.host === null || HOST_SKILL_NAMES.includes(options.host));
    if (valid && project !== null) options.project = projectRootOf(project);
    return valid ? options : null;
}

function main(argv) {
    const options = parseRoleArgs(argv);
    if (!options || options.rest.length > 0) {
        console.error(USAGE);
        return 2;
    }
    const { required, warnings } = roleRequirements(options.role, options);
    for (const text of warnings) console.log(`warning: ${text}`);
    for (const name of required) console.log(name);
    return 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
