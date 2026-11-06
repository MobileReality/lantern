export const BUNDLED_SKILLS = [
    'lantern-setup',
    'lantern-sync',
    'lantern-delegate',
    'lantern-delegate-complex',
    'lantern-commit',
    'lantern-local-loop',
    'lantern-no-comments',
    'lantern-code-reviewer',
    'lantern-jira',
    'lantern-bitbucket',
    'lantern-github',
];

export const REQUIRED_SKILLS = ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'];

export const ORCHESTRATOR_SKILLS = ['lantern-sync'];

export const REVIEWER_SKILLS = ['lantern-no-comments', 'lantern-code-reviewer'];

export const ROLE_SKILLS = Object.freeze({ delegate: REQUIRED_SKILLS, orchestrator: ORCHESTRATOR_SKILLS, reviewer: REVIEWER_SKILLS });

export const SWITCHABLE_SKILLS = Object.freeze({ delegate: REQUIRED_SKILLS, orchestrator: [], reviewer: REVIEWER_SKILLS });

function assertRole(role) {
    if (!ROLE_SKILLS[role]) throw new Error(`"${role}" is not a role; use one of: ${Object.keys(ROLE_SKILLS).join(', ')}`);
}

export function switchableSkills(role) {
    assertRole(role);
    return SWITCHABLE_SKILLS[role];
}

export function enabledSkills(role, off = []) {
    const switchedOff = switchableSkills(role).filter((name) => off.includes(name));
    return ROLE_SKILLS[role].filter((name) => !switchedOff.includes(name));
}

export function alwaysOnSkills(role) {
    assertRole(role);
    const own = ROLE_SKILLS[role];
    const others = Object.values(ROLE_SKILLS).filter((names) => names !== own).flat();
    return BUNDLED_SKILLS.filter((name) => own.includes(name) || !others.includes(name));
}

export function offEverywhere(off = {}) {
    const roles = Object.keys(SWITCHABLE_SKILLS);
    return BUNDLED_SKILLS.filter((name) => {
        const listing = roles.filter((role) => SWITCHABLE_SKILLS[role].includes(name));
        return listing.length > 0 && listing.every((role) => (off[role] ?? []).includes(name));
    });
}
