import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import * as bundled from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
// @ts-expect-error plain ES module, no declarations
import * as kinds from '../skills/lantern-delegate/scripts/delegate-kinds.mjs';

const SKILLS = path.join(__dirname, '..', 'skills');
const COMPLEX = path.join(SKILLS, 'lantern-delegate-complex');
const DELEGATE = path.join(SKILLS, 'lantern-delegate');
const SCRIPTS = path.join(DELEGATE, 'scripts');
const read = (file: string) => fs.readFileSync(file, 'utf8');

function frontmatter(text: string) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  return Object.fromEntries(
    block
      .split('\n')
      .map((line) => /^([a-zA-Z-]+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/, '');

const MODELS = ['opus', 'fable'] as const;
const EFFORTS = ['medium', 'high', 'xhigh'] as const;
const TYPE_FILES = MODELS.flatMap((model) => EFFORTS.map((effort) => `lantern-delegate-complex-${model}-${effort}.md`));

describe('the lantern-delegate-complex skill folder', () => {
  it('has a named, user-invocable SKILL.md that sends the reader to lantern-delegate for the rest', () => {
    const text = read(path.join(COMPLEX, 'SKILL.md'));
    const meta = frontmatter(text);
    expect(meta.name).toBe('lantern-delegate-complex');
    expect(meta['user-invocable']).toBe('true');
  });

  it('holds the skill file and its agent types and nothing that duplicates lantern-delegate', () => {
    expect(fs.readdirSync(COMPLEX).sort()).toEqual(['SKILL.md', 'agents']);
    expect(fs.readdirSync(path.join(COMPLEX, 'agents')).sort()).toEqual([...TYPE_FILES, 'reviewer-complex.md'].sort());
  });

  it('ships one agent type per model and effort, worktree-isolated, pointing at protocol.md and its Opus and Fable section', () => {
    expect(kinds.COMPLEX_KINDS).toEqual([...MODELS]);
    for (const model of MODELS) {
      for (const effort of EFFORTS) {
        const name = `lantern-delegate-complex-${model}-${effort}`;
        expect(kinds.typeKind(name)).toBe(model);
        const text = read(path.join(COMPLEX, 'agents', `${name}.md`));
        expect(frontmatter(text)).toMatchObject({ name, model, effort, isolation: 'worktree' });
        expect(text).toContain("the `lantern-delegate` skill's `protocol.md`");
        expect(text).toContain('"Opus and Fable delegates" section');
      }
    }
  });

  it('ships reviewer-complex as the reviewer on Fable: same tools, same body', () => {
    const reviewer = read(path.join(DELEGATE, 'agents', 'reviewer.md'));
    const complex = read(path.join(COMPLEX, 'agents', 'reviewer-complex.md'));
    expect(frontmatter(complex)).toMatchObject({ name: 'reviewer-complex', model: 'fable', disallowedTools: 'Edit, Write, NotebookEdit' });
    expect(frontmatter(reviewer)).toMatchObject({ name: 'reviewer', model: 'opus', disallowedTools: 'Edit, Write, NotebookEdit' });
    expect(bodyOf(complex)).toBe(bodyOf(reviewer));
  });
});

describe('the model policy for the map accepts Sonnet, Opus and Fable', () => {
  const MODEL = path.join(SKILLS, 'lantern-setup', 'scripts', 'model.mjs');
  const check = (id: string) => spawnSync(process.execPath, [MODEL, 'check', id], { encoding: 'utf8', env: { ...process.env, LANTERN_PROVIDER: '' } });

  it.each(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'])('prints OK for %s', (id) => {
    const result = check(id);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`OK ${id}\n`);
  });

  it.each(['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-opus-5-0', 'claude-sonnet-5-4', 'claude-fable-5-0'])('accepts the older %s with an advisory, never a refusal', (id) => {
    const result = check(id);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^OK ${id} \\(below the recommended (sonnet|opus|fable) \\d\\.\\d\\)\n$`));
  });

  it.each(['claude-haiku-5-5', 'claude-haiku-4-5', 'gpt-4o', 'gpt-6-sol'])('prints NOT ALLOWED for %s', (id) => {
    const result = check(id);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`NOT ALLOWED ${id}\n`);
  });

  it('keeps the recommended versions in the policy file, not as a minimum', () => {
    const floor = JSON.parse(read(path.join(SKILLS, 'lantern-setup', 'references', 'model-floor.json')));
    expect(floor.claude).toEqual([
      { family: 'sonnet', recommended: '5.5' },
      { family: 'opus', recommended: '5.5' },
      { family: 'fable', recommended: '5.1' },
    ]);
    expect(floor.allowedIds).toEqual(['gpt-6-astra']);
    expect(JSON.stringify(floor.claude)).not.toContain('minVersion');
  });

  it('prints the policy as any version with a recommendation', () => {
    const { stdout } = spawnSync(process.execPath, [MODEL, 'floor'], { encoding: 'utf8', env: { ...process.env, LANTERN_PROVIDER: '' } });
    expect(stdout).toContain('of any version');
    expect(stdout).toContain('recommended: sonnet 5.5, opus 5.5, fable 5.1 or newer');
  });

  it('has the lantern-mapper agent still pinned to Sonnet 5.5', () => {
    expect(frontmatter(read(path.join(SKILLS, 'lantern-setup', 'agents', 'lantern-mapper.md'))).model).toBe('claude-sonnet-5-5');
  });
});

describe('bundle lists and roles', () => {
  it('lists the skill once, locked like lantern-delegate, and it is not switchable for any role', () => {
    expect(bundled.BUNDLED_SKILLS.filter((name: string) => name === 'lantern-delegate-complex')).toHaveLength(1);
    for (const role of ['delegate', 'orchestrator', 'reviewer']) expect(bundled.switchableSkills(role)).not.toContain('lantern-delegate-complex');
    expect(bundled.offEverywhere({ delegate: bundled.SWITCHABLE_SKILLS.delegate, reviewer: bundled.SWITCHABLE_SKILLS.reviewer })).not.toContain('lantern-delegate-complex');
  });

  it('prints the same delegate list for every kind of delegate: the role, not the agent type, decides', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'complex-required-'));
    try {
      const run = () => spawnSync(process.execPath, [path.join(SCRIPTS, 'required-skills.mjs'), '--role', 'delegate', '--home', home], { encoding: 'utf8' });
      const { status, stdout } = run();
      expect(status).toBe(0);
      expect(stdout.trim().split('\n')).toEqual(['lantern-commit', 'lantern-no-comments', 'lantern-local-loop']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('delegate kinds', () => {
  it('reads the kind from the agent type, then from the model', () => {
    expect(kinds.delegateKind({ agentType: 'lantern-delegate-complex-fable-high' })).toBe('fable');
    expect(kinds.delegateKind({ agentType: 'lantern-delegate-complex-opus-medium' })).toBe('opus');
    expect(kinds.delegateKind({ agentType: 'lantern-delegate-high' })).toBe('sonnet');
    expect(kinds.delegateKind({ model: 'claude-fable-5-1' })).toBe('fable');
    expect(kinds.delegateKind({ model: 'claude-opus-5-5' })).toBe('opus');
    expect(kinds.delegateKind({ model: 'claude-sonnet-5-5' })).toBe('sonnet');
    expect(kinds.delegateKind({ agentType: 'lantern-delegate-high', model: 'claude-opus-5-5' })).toBe('sonnet');
    expect(kinds.delegateKind({ agentType: 'lantern-delegate-high', model: 'claude-fable-5-1' })).toBe('sonnet');
    expect(kinds.delegateKind({})).toBe('sonnet');
  });

  it('names the reviewer a kind uses: reviewer-complex only for Fable', () => {
    expect(kinds.reviewerFor('fable')).toBe('reviewer-complex');
    expect(kinds.reviewerFor('opus')).toBe('reviewer');
    expect(kinds.reviewerFor('sonnet')).toBe('reviewer');
    expect(kinds.REVIEWER_AGENT_TYPES).toEqual(['reviewer', 'reviewer-complex']);
  });

  it('tells a model family from a model id and a kind from a delegate type', () => {
    expect(kinds.modelKind('claude-opus-5-5')).toBe('opus');
    expect(kinds.modelKind('claude-haiku-5-5')).toBeNull();
    expect(kinds.modelKind(undefined)).toBeNull();
    expect(kinds.typeKind('lantern-delegate-complex-opus-xhigh')).toBe('opus');
    expect(kinds.typeKind('lantern-delegate-xhigh')).toBe('sonnet');
    expect(kinds.typeKind('reviewer')).toBeNull();
  });
});

describe('the transcript checks and an Opus or Fable delegate', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const tool = (name: string, input: object, id = `t${Math.random().toString(36).slice(2)}`) => ({ type: 'tool_use', id, name, input });
  const agent = (id: string, subagent_type: string, description: string, prompt: string) => tool('Agent', { subagent_type, description, prompt }, id);
  const bash = (command: string) => tool('Bash', { command });
  const line = (block: object, model: string) => ({ type: 'assistant', message: { id: `m${Math.random()}`, model, content: [block] } });
  const result = (id: string, content: string) => ({ message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });

  function world(entries: object[], { agentType, model = 'claude-fable-5-1' }: { agentType?: string; model?: string } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complex-lint-'));
    dirs.push(root);
    const dir = path.join(root, 'transcripts');
    const home = path.join(root, 'home');
    const project = path.join(root, 'project');
    for (const folder of [dir, path.join(home, '.claude'), path.join(project, '.claude', 'skills')]) fs.mkdirSync(folder, { recursive: true });
    const lines = entries.map((e) => ('message' in e && !(e as { type?: string }).type ? e : line(e, model)));
    fs.writeFileSync(path.join(dir, 'agent-d1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    if (agentType) fs.writeFileSync(path.join(dir, 'agent-d1.meta.json'), JSON.stringify({ agentType }));
    return { dir, home, project };
  }

  const node = (script: string, args: string[], cwd?: string) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', cwd });
  const reviewerLint = (dir: string, extra: string[] = ['--agent-id', 'd1']) => node('lint-reviewer.mjs', [...extra, dir]);

  const REVIEW = 'Review HEAD on this branch against main with the reviewer skills. End with VERDICT lines.';
  const FABLE_TYPE = 'lantern-delegate-complex-fable-high';
  const OPUS_TYPE = 'lantern-delegate-complex-opus-medium';
  const SONNET_TYPE = 'lantern-delegate-medium';
  const OPUS = 'claude-opus-5-5';
  const SONNET = 'claude-sonnet-5-5';

  const mapWrites = () => [
    tool('Edit', { file_path: '/wt/.lantern/map/src/a.lantern' }),
    tool('Write', { file_path: '/wt/.lantern/prs/12.pr', content: 'x' }),
    bash('node /s/lantern-sync/scripts/sync.mjs finish --base main --model claude-opus-5-5'),
    bash('node /s/lantern-sync/scripts/sync.mjs pr 12 --url u --title t --base main'),
    bash('node /s/lantern-setup/scripts/systems.mjs add stripe --text "Payments"'),
  ];

  const run = (reviewer: string, writes = mapWrites()) => [
    bash('git fetch origin'),
    agent('r1', reviewer, 'Review the branch', REVIEW),
    ...writes,
    bash('git push origin HEAD:refs/heads/feat/hard-thing'),
    bash('node /s/lantern-sync/scripts/sync.mjs verify --base main --require-pr --branch feat/hard-thing'),
  ];

  it('accepts a Fable delegate that reviews with reviewer-complex and writes the map itself', () => {
    const { dir } = world(run('reviewer-complex'), { agentType: FABLE_TYPE });
    const res = reviewerLint(dir);
    expect(res.stdout).toContain('0 review problem(s) out of 1 review(s)');
    expect(res.status).toBe(0);
  });

  it('accepts an Opus delegate that reviews with the plain reviewer and writes the map itself', () => {
    const { dir } = world(run('reviewer'), { agentType: OPUS_TYPE, model: OPUS });
    const res = reviewerLint(dir);
    expect(res.stdout).toContain('0 review problem(s) out of 1 review(s)');
    expect(res.status).toBe(0);
  });

  it('stays strict on a Sonnet delegate: the plain reviewer passes, reviewer-complex and others do not', () => {
    expect(reviewerLint(world(run('reviewer'), { agentType: SONNET_TYPE, model: SONNET }).dir).status).toBe(0);
    for (const type of ['reviewer-complex', 'general-purpose']) {
      const res = reviewerLint(world(run(type), { agentType: SONNET_TYPE, model: SONNET }).dir);
      expect(res.status, type).toBe(1);
      expect(res.stdout, type).toContain(`review-not-by-reviewer ${type}`);
    }
  });

  it('takes the kind from the model when no meta file is there', () => {
    expect(reviewerLint(world(run('reviewer-complex'), { model: 'claude-fable-5-1' }).dir).status).toBe(0);
    expect(reviewerLint(world(run('reviewer'), { model: OPUS }).dir).status).toBe(0);
    expect(reviewerLint(world(run('reviewer-complex'), { model: SONNET }).dir).status).toBe(1);
  });

  it('flags a Fable delegate whose review went to the plain reviewer or to another type', () => {
    for (const type of ['reviewer', 'general-purpose']) {
      const res = reviewerLint(world([agent('r1', type, 'Review the branch', REVIEW)], { agentType: FABLE_TYPE }).dir);
      expect(res.status, type).toBe(1);
      expect(res.stdout, type).toContain(`review-not-by-reviewer ${type} expected reviewer-complex`);
    }
  });

  it('flags an Opus delegate whose review went to reviewer-complex', () => {
    const res = reviewerLint(world([agent('r1', 'reviewer-complex', 'Review the branch', REVIEW)], { agentType: OPUS_TYPE, model: OPUS }).dir);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('review-not-by-reviewer reviewer-complex');
  });

  it('flags a delegate type that ran on another model family, whichever way round', () => {
    const cases: [string, string][] = [
      [SONNET_TYPE, 'claude-fable-5-1'],
      [SONNET_TYPE, OPUS],
      [OPUS_TYPE, SONNET],
      [FABLE_TYPE, OPUS],
    ];
    for (const [type, model] of cases) {
      const res = reviewerLint(world(run(type === FABLE_TYPE ? 'reviewer-complex' : 'reviewer'), { agentType: type, model }).dir);
      expect(res.status, `${type} ${model}`).toBe(1);
      expect(res.stdout, `${type} ${model}`).toContain(`agent-d1.jsonl:1 delegate-type-on-wrong-model ${type} ${model}`);
    }
  });

  it('flags a reviewer spawned with a model, which would override the model its type pins', () => {
    const spawn = (id: string, type: string, model: string) => tool('Agent', { subagent_type: type, model, description: 'Review the branch', prompt: REVIEW }, id);
    const { dir } = world([spawn('r1', 'reviewer-complex', 'sonnet'), spawn('r2', 'reviewer', 'fable')], { agentType: FABLE_TYPE });
    const res = reviewerLint(dir);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('model-override-on-spawn reviewer-complex sonnet');
    expect(res.stdout).toContain('model-override-on-spawn reviewer fable');
  });

  it('reports a reviewer agent type that was not found', () => {
    const missing = "Agent type 'reviewer-complex' not found. Available agents: general-purpose, Explore";
    const { dir } = world([agent('r1', 'reviewer-complex', 'Review the branch', REVIEW), result('r1', missing)], { agentType: FABLE_TYPE });
    const res = reviewerLint(dir);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/agent-d1\.jsonl:1 reviewer-missing/);
  });

  it('does not treat a re-mapping or a lantern-mapper spawn as anything special any more', () => {
    const remap = 'Re-map the work list of sync.mjs finish for this branch and validate it.';
    const { dir } = world([agent('g1', 'general-purpose', 'Re-map the files', remap), agent('m1', 'lantern-mapper', 'Re-map the branch', remap)], { agentType: FABLE_TYPE });
    const res = reviewerLint(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('0 review problem(s) out of 0 review(s)');
  });

  it('lint-transcript and check-skill-use accept the same Opus and Fable transcripts', () => {
    const reads = ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'].map((name) => tool('Read', { file_path: `/wt/.claude/skills/${name}/SKILL.md` }));
    for (const [type, model, reviewer] of [[FABLE_TYPE, 'claude-fable-5-1', 'reviewer-complex'], [OPUS_TYPE, OPUS, 'reviewer']]) {
      const { dir, home, project } = world([...reads, ...run(reviewer)], { agentType: type, model });
      const commands = node('lint-transcript.mjs', ['--agent-id', 'd1', dir], project);
      expect(commands.status, type).toBe(0);
      const skills = node('check-skill-use.mjs', ['--home', home, '--agent-id', 'd1', dir], project);
      expect(skills.stdout, type).toContain('0 skill-use finding(s)');
      expect(skills.status, type).toBe(0);
    }
  });

  it('still flags an Opus or Fable delegate that skipped a required skill: the gate has one list for every delegate', () => {
    const { dir, home, project } = world(run('reviewer-complex'), { agentType: FABLE_TYPE });
    const skills = node('check-skill-use.mjs', ['--home', home, '--agent-id', 'd1', dir], project);
    expect(skills.status).toBe(1);
    expect(skills.stdout).toMatch(/skill-not-read lantern-commit/);
  });

  it('checks a reviewer-complex transcript with the reviewer role', () => {
    const reads = ['lantern-no-comments', 'lantern-code-reviewer'].map((name) => tool('Read', { file_path: `/wt/.claude/skills/${name}/SKILL.md` }));
    const { dir, home, project } = world(reads, { agentType: 'reviewer-complex' });
    const skills = node('check-skill-use.mjs', ['--role', 'reviewer', '--home', home, '--agent-id', 'd1', dir], project);
    expect(skills.stdout).toContain('0 skill-use finding(s)');
    expect(skills.status).toBe(0);
  });
});
