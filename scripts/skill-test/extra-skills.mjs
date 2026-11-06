import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkText } from '../../skills/lantern-delegate/scripts/check-skill-use.mjs';
import { requiredSkills, ROLE } from '../../skills/lantern-delegate/scripts/required-skills.mjs';
import { EXTENSIONS_FOLDER, EXTENSIONS_FILE, readExtensions } from '../../skills/lantern-delegate/scripts/extensions.mjs';
import { REPO_ROOT } from '../e2e-delegate/workspace.mjs';

const SKILL_DIR = path.join(REPO_ROOT, 'skills', 'lantern-delegate');
const OK = (reason) => ({ ok: true, reason });
const FAIL = (reason) => ({ ok: false, reason });
const EXTRA = 'my-extra';

function homeWith(config) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lantern-extras-home-'));
  if (config !== null) {
    fs.mkdirSync(path.join(home, EXTENSIONS_FOLDER), { recursive: true });
    fs.writeFileSync(path.join(home, EXTENSIONS_FOLDER, EXTENSIONS_FILE), JSON.stringify(config));
  }
  return home;
}

function docProblems() {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const protocol = fs.readFileSync(path.join(SKILL_DIR, 'protocol.md'), 'utf8');
  const problems = [];
  if (/Extra skills:/.test(skill) || /Extra skills:/.test(protocol)) problems.push('a skill file still has an `Extra skills:` brief line');
  if (!protocol.includes('scripts/required-skills.mjs')) problems.push('protocol.md does not have the delegate run required-skills.mjs');
  if (!/required-skills\.mjs --role orchestrator/.test(skill)) problems.push('SKILL.md does not have the orchestrator run required-skills.mjs --role orchestrator');
  if (!skill.includes('readExtensions')) problems.push('SKILL.md does not source the orchestrator skills from readExtensions');
  if (!/^## Conventions\nSkill linker: </m.test(skill)) problems.push('SKILL.md brief template has no `## Conventions` block carrying the `Skill linker:` line');
  if (/Skill linker/.test(protocol)) problems.push('protocol.md mentions Skill linker');
  const reviewerAgent = fs.readFileSync(path.join(SKILL_DIR, 'agents', 'reviewer.md'), 'utf8');
  if (!/required-skills\.mjs --role reviewer/.test(reviewerAgent)) problems.push('agents/reviewer.md does not have the reviewer run required-skills.mjs --role reviewer');
  if (!/check-skill-use\.mjs --role reviewer/.test(skill)) problems.push('SKILL.md does not run check-skill-use.mjs --role reviewer on the reviewer transcript');
  return problems;
}

function listProblems(role, slot, label) {
  const home = homeWith({ [role]: slot });
  const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lantern-extras-cwd-'));
  try {
    for (const name of slot) {
      fs.mkdirSync(path.join(cwd, '.claude', 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
    }
    const run = spawnSync('node', [path.join(SKILL_DIR, 'scripts', 'required-skills.mjs'), '--role', role, '--home', home], { cwd, encoding: 'utf8' });
    const printed = run.stdout.split('\n').filter(Boolean);
    const want = requiredSkills(role, slot);
    const problems = [];
    if (run.status !== 0) problems.push(`${label}: required-skills.mjs exits ${run.status}`);
    if (JSON.stringify(printed) !== JSON.stringify(want)) problems.push(`${label}: prints ${JSON.stringify(printed)}, expected ${JSON.stringify(want)}`);
    if (new Set(printed).size !== printed.length) problems.push(`${label}: prints a name twice`);
    return problems;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function slotProblems(label, config, expected) {
  const home = homeWith(config);
  try {
    const slots = readExtensions(home);
    if (JSON.stringify(slots.delegate) !== JSON.stringify(expected)) return [`${label}: delegate slot is ${JSON.stringify(slots.delegate)}, expected ${JSON.stringify(expected)}`];
    return [];
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const readFull = (name) => ({ type: 'tool_use', name: 'Read', input: { file_path: `/wt/.claude/skills/${name}/SKILL.md` } });
const transcript = (brief, calls) =>
  [JSON.stringify({ type: 'user', message: { role: 'user', content: brief } }), ...calls.map((c) => JSON.stringify({ message: { content: [c] } }))].join('\n');

function gateProblems(role, slots) {
  const fixed = requiredSkills(role);
  const reads = [...fixed, ...slots].map(readFull);
  const required = requiredSkills(role, slots);
  const rules = (calls) => checkText(transcript('## Goal\nx\n', calls), { required }).findings.map((f) => f.rule);
  const problems = [];
  const green = rules(reads);
  if (green.length > 0) problems.push(`${role}: full reads and a brief with no line are red: ${green.join(', ')}`);
  if (!rules(reads.slice(0, -1)).includes('skill-not-read')) problems.push(`${role}: a slot skill never read in full is not red`);
  return problems;
}

export function extraSkills() {
  const problems = [
    ...gateProblems(ROLE.delegate, ['alpha-extra', 'beta-extra']),
    ...gateProblems(ROLE.orchestrator, ['gamma-extra']),
    ...gateProblems(ROLE.reviewer, ['delta-extra']),
    ...listProblems(ROLE.delegate, [EXTRA, 'second-extra'], 'delegate list'),
    ...listProblems(ROLE.orchestrator, [EXTRA], 'orchestrator list'),
    ...listProblems(ROLE.reviewer, [EXTRA], 'reviewer list'),
    ...slotProblems('empty config', null, []),
    ...slotProblems('one extra', { delegate: [EXTRA], orchestrator: [], reviewer: [] }, [EXTRA]),
    ...docProblems(),
  ];
  if (problems.length > 0) return FAIL(problems.join('; '));
  return OK('each role lists its fixed skills and its slot once and is held to full reads with no brief line; SKILL.md and protocol.md run the list command and name no fixed extra skill');
}
