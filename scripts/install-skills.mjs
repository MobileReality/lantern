#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_SKILLS, installBundleGuarded, skippedEntries } from './lantern-bundle.mjs';
import { describeRtk, detectRtk, rtkDetectionDisabled } from '../skills/lantern-delegate/scripts/rtk-detect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = process.env.INSTALL_SKILLS_SOURCE || path.join(ROOT, 'skills');
const USAGE = `usage: node scripts/install-skills.mjs <project-dir>
  Copies the bundled skills (lantern-setup, lantern-sync, lantern-delegate, lantern-delegate-complex, the planning skills
  lantern-plan, lantern-plan-impact, lantern-plan-stages, lantern-plan-review, lantern-plan-handoff, the
  skills a delegate works by: lantern-commit, lantern-local-loop, lantern-no-comments, lantern-code-reviewer, and the
  default integration skills lantern-jira, lantern-bitbucket, lantern-github) into <project-dir>/.claude/skills/ and the lantern-delegate
  and lantern-delegate-complex agent types (the Opus and Fable delegates and reviewer-complex) into <project-dir>/.claude/agents/ (the Lantern app does the same when a project
  is opened in it). In a git project where git does not ignore them, their paths are first added to
  the repo-local .git/info/exclude (never .gitignore, never duplicated). A directory outside any git
  repository has nothing tracked to pollute and is installed into directly. A bundled name added after an
  earlier install is excluded and installed the same way; anything still left out is printed as
  "skipped   <name> (<reason>)". Never writes to ~. An entry without
  the .lantern-bundle marker, a symlink, or a name that exists in ~/.claude is never overwritten.
  A marked copy is refreshed when the bundle changes; delete its marker to pin it.
  A bundled skill the user switched off in the Skills window for every role that lists it is not installed, and a marked copy of it already in the project is removed
  ("skipped" / "removed" lines); switching it back on installs it on the next run.
  --provider codex installs the three Lantern skills and the three integration skills into <project-dir>/.agents/skills/ instead (no agent types).
  The last line reports whether the optional RTK tool is on this machine (read only; nothing is installed or written for it).`;

const SKILL_NOTES = {
  installed: 'installed',
  refreshed: 'refreshed',
  current: 'current  ',
  unmarked: 'kept     ',
  symlink: 'kept     ',
  home: 'kept     ',
  'missing-source': 'missing  ',
  off: 'skipped  ',
  'removed-off': 'removed  ',
};
const SKILL_REASONS = {
  unmarked: ' (no .lantern-bundle marker; remove the folder to install the bundled copy)',
  symlink: ' (symlink)',
  'missing-source': ' (not in the bundle)',
  off: ' (switched off in the Skills window)',
  'removed-off': ' (switched off in the Skills window)',
};

const PERMISSION_NOTES = {
  written: 'written   delegate permissions in .claude/settings.local.json',
  current: 'current   delegate permissions in .claude/settings.local.json',
  unparseable: 'kept      .claude/settings.local.json is not valid settings JSON; left untouched, fix it and run again',
  'not-ignored': 'kept      git does not ignore .claude/settings.local.json; delegate permissions not written',
};

function parseArgs(argv) {
  const opts = { project: null, provider: 'claude' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--provider') {
      const provider = argv[++i];
      if (provider !== 'claude' && provider !== 'codex') throw new Error(`unsupported provider ${provider ?? '(missing)'}`);
      opts.provider = provider;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unknown argument ${arg}`);
    if (opts.project) throw new Error('only one project directory allowed');
    opts.project = path.resolve(arg);
  }
  if (!opts.project) throw new Error('project directory missing');
  return opts;
}

async function installSkills(project, provider) {
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${project} is not a directory`);
  }
  const result = await installBundleGuarded({ project, root: SKILLS_DIR, home: os.homedir(), provider });
  const skillsDir = provider === 'codex' ? '.agents/skills' : '.claude/skills';
  if (result.skipped === 'home') return [`skipped   ${project} is the home directory; nothing is written to ~`];
  if (result.skipped === 'not-ignored') {
    return [`skipped   git does not ignore ${provider === 'codex' ? skillsDir : '.claude'} in ${project} (or ${provider === 'codex' ? 'it' : '.claude'} is a symlink); nothing installed`];
  }
  const homeReason = provider === 'codex' ? ' (already in a Codex user skill root)' : ' (already in ~/.claude/skills)';
  const lines = (result.obsolete ?? []).map((name) => `removed   ${name} (old bundled copy)`);
  lines.push(...BUNDLE_SKILLS.filter(({ name }) => result.skills[name] && result.skills[name] !== 'not-ignored').map(({ name }) => `${SKILL_NOTES[result.skills[name]]} ${name}${result.skills[name] === 'home' ? homeReason : (SKILL_REASONS[result.skills[name]] ?? '')}`));
  lines.push(...skippedEntries(result, provider).map(({ name, reason }) => `skipped   ${name} (${reason})`));
  if (result.agents && result.agents.status !== 'missing-source') {
    const { status, files } = result.agents;
    lines.push(`${status === 'symlink' || status === 'kept' ? 'kept     ' : (SKILL_NOTES[status] ?? status)} lantern-delegate agents${files.length ? ` (${files.join(', ')})` : ''}`);
    if (status === 'installed' || status === 'refreshed') lines.push('          agent types written; a session that started earlier may need one retry of the dispatch');
  }
  if (result.permissions) lines.push(PERMISSION_NOTES[result.permissions.status] ?? `kept      .claude/settings.local.json (${result.permissions.status})`);
  return lines;
}

async function rtkLine(project) {
  try {
    const status = await detectRtk({ projectDirs: [project], loginShell: false });
    const { level, check, detail } = describeRtk(status);
    return `${level === 'ok' ? 'ok  ' : 'note'} ${check}: ${detail}${status.hookFound ? `; WARN rtk-hook set in ${status.hookFiles.join(', ')}` : ''}`;
  } catch (err) {
    return `note rtk: check failed (${err.message}), ignored (optional)`;
  }
}

try {
  const { project, provider } = parseArgs(process.argv.slice(2));
  const lines = await installSkills(project, provider);
  console.log((rtkDetectionDisabled() ? lines : [...lines, await rtkLine(project)]).join('\n'));
} catch (err) {
  console.error(`install-skills: ${err.message}\n${USAGE}`);
  process.exit(1);
}
