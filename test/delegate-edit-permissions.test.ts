import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_SKILLS, installBundleGuarded } from '../scripts/lantern-bundle.mjs';
import {
  DENY,
  EDIT_TARGETS,
  EDIT_TOOLS,
  editAllow,
  editRuleMatches,
  missingPermissions,
  requiredAllow,
} from '../skills/lantern-delegate/scripts/permissions.mjs';
import { makeRepo } from './support/bundle-fixtures';

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'skills');
const PREFLIGHT = path.join(SKILLS, 'lantern-delegate', 'scripts', 'preflight.mjs');

// The skills' prose is the source of truth: every `.lantern/...` or `.ai/...` path it names is either
// covered by an Edit and Write rule (EDIT_TARGETS) or listed here with the reason no rule is wanted.
// A new path in the prose that is in neither place fails the test and names itself.
const NOT_WRITTEN_WITH_EDIT: Array<{ glob: string; why: string }> = [
  { glob: '.lantern/prs', why: 'PR records are written by sync.mjs pr' },
  { glob: '.lantern/prs/**', why: 'PR records are written by sync.mjs pr' },
  { glob: '.lantern/local', why: 'local branch records are written by sync.mjs' },
  { glob: '.lantern/local/**', why: 'local branch records are written by sync.mjs' },
  { glob: '.lantern/.project/areas', why: 'the scratch folder of the app\'s map run, written by areas.mjs lookup run; a delegate uses .ai/tmp/areas' },
  { glob: '.lantern/systems', why: 'edited only through systems.mjs; no agent writes it by hand' },
  { glob: '.ai/.env', why: 'a user-owned file, never written by a skill' },
  { glob: '.ai/tmp/pr-ID', why: 'a git worktree, created by git worktree add' },
  { glob: '.ai/tmp/lantern.html', why: 'written by render.mjs' },
  { glob: '.ai/tmp/RUN*', why: 'written by build-report.mjs' },
  { glob: '.ai/postmortems', why: 'postmortems are the postmortem skill, outside the Lantern skills' },
  { glob: '.ai/postmortems/**', why: 'postmortems are the postmortem skill, outside the Lantern skills' },
  { glob: '.ai/tmp/cost.md', why: 'written by build-report.mjs' },
];

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'example-web') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function normalise(raw: string): string {
  let token = raw.replace(/<run-id>/g, 'RUN').replace(/<id>/g, 'ID');
  const open = token.indexOf('<');
  if (open !== -1 && token.indexOf('>', open) === -1) token = token.slice(0, open);
  token = token.replace(/<[^>]*>/g, 'x');
  return token.replace(/[/.>]+$/, '');
}

function mentionedPaths(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of markdownFiles(SKILLS)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:^|[^A-Za-z0-9_/.-])(\.(?:lantern|ai)\/[A-Za-z0-9_<>*%.{}/-]+)/gm)) {
      const normalised = normalise(match[1]);
      if (!normalised.includes('/')) continue;
      const where = found.get(normalised) ?? [];
      where.push(path.relative(ROOT, file));
      found.set(normalised, where);
    }
  }
  return found;
}

const covered = (allow: string[], target: string) =>
  EDIT_TOOLS.every((tool) => allow.some((rule) => editRuleMatches(rule, tool, target) || editRuleMatches(rule, tool, `${target}/x`)));
const isDirectoryOfTarget = (target: string) => EDIT_TARGETS.some(({ pattern }) => pattern.startsWith(`${target}/`));
const excluded = (target: string) => NOT_WRITTEN_WITH_EDIT.some(({ glob }) => editRuleMatches(`Edit(${glob})`, 'Edit', target));

describe('Edit and Write rules for the files the skills tell an agent to write', () => {
  const allow = requiredAllow([path.join(ROOT, '.claude', 'skills')]);

  it('has a rule for every Edit and Write target, in requiredAllow', () => {
    expect(editAllow()).toHaveLength(EDIT_TARGETS.length * EDIT_TOOLS.length);
    expect(missingPermissions(['/nonexistent'], editAllow())).toEqual(editAllow());
    for (const rule of editAllow()) expect(allow).toContain(rule);
  });

  it('covers every .lantern and .ai path the skills name, or lists why not', () => {
    const mentioned = mentionedPaths();
    for (const known of ['.lantern/map', '.lantern/lang/x','.lantern/areas', '.ai/tmp/reason.json', '.ai/tmp/pr-body.md', '.ai/runs']) {
      expect([...mentioned.keys()], `the scan must find ${known}`).toContain(known);
    }
    const uncovered: string[] = [];
    for (const [target, files] of mentioned) {
      if (covered(allow, target) || isDirectoryOfTarget(target) || excluded(target)) continue;
      uncovered.push(`${target} (named in ${[...new Set(files)].join(', ')})`);
    }
    expect(uncovered, 'add an Edit and Write rule to EDIT_TARGETS in permissions.mjs, or a reason to NOT_WRITTEN_WITH_EDIT').toEqual([]);
  });

  it('names the paths the audit found, each in the prose of its source file', () => {
    for (const { pattern, source } of EDIT_TARGETS) {
      const prefix = pattern.split('*')[0].replace(/\/$/, '');
      expect(fs.readFileSync(path.join(ROOT, source), 'utf8'), `${pattern} in ${source}`).toContain(prefix);
    }
  });

  it('keeps every rule narrow: inside .lantern or .ai, never settings, never the whole project', () => {
    for (const { pattern } of EDIT_TARGETS) {
      expect(pattern).toMatch(/^\.(lantern|ai)\/[^*]/);
      for (const settings of ['.claude/settings.json', '.claude/settings.local.json', 'src/main.ts', 'package.json', '.lantern/prs/1.pr', '.lantern/systems']) {
        expect(editRuleMatches(`Edit(${pattern})`, 'Edit', settings), `${pattern} must not reach ${settings}`).toBe(false);
      }
    }
    expect(editAllow().join('\n')).not.toMatch(/settings|\(\*\*?\)/);
  });

  it('leaves DENY as it was: no Edit or Write rule in it', () => {
    expect(DENY.some((rule) => /^(Edit|Write)/.test(rule))).toBe(false);
  });

  it('matches the paths the protocol uses, in the delegate worktree', () => {
    const rules = editAllow();
    for (const file of [
      '.lantern/map/src/main.lantern',
      '.lantern/map/%2Eclaude/skills/x.lantern',
      '.lantern/lang/en/src/main.json',
      '.lantern/lang/en/.lantern.json',
      '.lantern/lang/en/%2Eclaude/skills/x.json',
      '.lantern/plans/my-plan.plan',
      '.ai/tmp/reason.json',
      '.ai/runs/2026-10-29-slug/HANDOFF.md',
    ]) {
      for (const tool of EDIT_TOOLS) expect(rules.some((rule) => editRuleMatches(rule, tool, file)), `${tool} ${file}`).toBe(true);
    }
    expect(rules.some((rule) => editRuleMatches(rule, 'Edit', '.lantern/plans/sub/x.plan'))).toBe(false);
  });

  it('names the rule that is missing when one is removed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-perms-'));
    try {
      const file = path.join(tmp, 'settings.json');
      const without = (drop: string) => {
        fs.writeFileSync(file, JSON.stringify({ permissions: { allow: allow.filter((rule) => rule !== drop) } }));
        return missingPermissions([file], allow);
      };
      expect(missingPermissions([(fs.writeFileSync(file, JSON.stringify({ permissions: { allow } })), file)], allow)).toEqual([]);
      expect(without('Edit(.lantern/map/**)')).toEqual(['Edit(.lantern/map/**)']);
      expect(without('Write(.lantern/lang/**)')).toEqual(['Write(.lantern/lang/**)']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts a wider rule the user already has', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-perms-'));
    try {
      const file = path.join(tmp, 'settings.json');
      fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Edit(.lantern/**)', 'Write(.lantern/**)', 'Edit', 'Write'] } }));
      expect(missingPermissions([file], editAllow())).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the rules reach a project', () => {
  let tmp: string;
  let home: string;
  let project: string;
  const settingsFile = () => path.join(project, '.claude', 'settings.local.json');
  const skillNames = [...BUNDLE_SKILLS.map((s: { name: string }) => s.name), 'my-extra', 'second-extra'];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-perms-project-'));
    home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    project = makeRepo(path.join(tmp, 'project'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function preflight() {
    for (const name of skillNames) {
      fs.mkdirSync(path.join(project, '.claude', 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(project, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
    }
    fs.mkdirSync(path.join(tmp, 'linker'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'linker', 'skill-linker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, SKILL_LINKER: path.join(tmp, 'linker', 'skill-linker'), LANTERN_RTK_DETECT: 'off' };
    for (const name of ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'GITHUB_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
    const res = spawnSync(process.execPath, [PREFLIGHT, '--target', 'main', '--no-api'], { cwd: project, env, encoding: 'utf8' });
    return `${res.stdout}${res.stderr}`;
  }

  it('lands in a fresh project on open, and a second open adds nothing', async () => {
    await installBundleGuarded({ project, root: SKILLS, home, provider: 'claude' });
    const written: string[] = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).permissions.allow;
    for (const rule of editAllow()) expect(written).toContain(rule);
    const second = await installBundleGuarded({ project, root: SKILLS, home, provider: 'claude' });
    expect(second.permissions).toEqual({ status: 'current' });
  });

  it('adds only the missing edit rules to a project that has the Bash ones', async () => {
    await installBundleGuarded({ project, root: SKILLS, home, provider: 'claude' });
    const settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings.permissions.allow = settings.permissions.allow.filter((rule: string) => !/^(Edit|Write)\(/.test(rule));
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
    const result = await installBundleGuarded({ project, root: SKILLS, home, provider: 'claude' });
    expect(result.permissions).toEqual({ status: 'written' });
    const merged: string[] = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).permissions.allow;
    for (const rule of editAllow()) expect(merged.filter((r) => r === rule)).toHaveLength(1);
  });

  it('is reported by preflight, naming each missing rule, and reported clean once present', async () => {
    await installBundleGuarded({ project, root: SKILLS, home, provider: 'claude' });
    const settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings.permissions.allow = settings.permissions.allow.filter((rule: string) => rule !== 'Edit(.lantern/map/**)' && rule !== 'Write(.ai/runs/**)');
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
    const out = preflight();
    expect(out).toMatch(/permissions/);
    expect(out).toContain('2 command(s) or file edit(s)');
    expect(out).toContain('Edit(.lantern/map/**)');
    expect(out).toContain('Write(.ai/runs/**)');
    expect(out).not.toContain('Write(.lantern/lang/**) Write');
    await installBundleGuarded({ project, root: SKILLS, home, provider: 'claude' });
    expect(preflight()).not.toContain('file edit(s)');
  });
});
