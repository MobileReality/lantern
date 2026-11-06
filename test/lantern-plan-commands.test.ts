import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmp, write } from './helpers/git-repo';
import { DRAFT, EXAMPLE, REPO, importScript, makeProject, planJson, removeDir, runPlan } from './helpers/lantern-plan-world';

interface ImpactEntry {
  path: string;
  role: string | null;
  feature: string | null;
  area: string | null;
  depth?: number;
  via?: string[];
}

interface ImpactReport {
  depth: number;
  counts: { seeds: number; dependents: number; dependencies: number };
  seeds: ImpactEntry[];
  dependents: ImpactEntry[];
  dependencies: ImpactEntry[];
  features: { id: string; area: string | null; seeds: number; dependents: number; dependencies: number }[];
  areas: { id: string; seeds: number; dependents: number; dependencies: number }[];
  systems: { id: string; files: number }[];
}

let root: string;

beforeEach(() => {
  root = makeProject([EXAMPLE, DRAFT]);
});

afterEach(() => {
  removeDir(root);
});

const planPath = (slug: string) => path.join(root, '.lantern', 'plans', `${slug}.plan`);
const read = (slug: string) => fs.readFileSync(planPath(slug), 'utf8');
const paths = (entries: ImpactEntry[]) => entries.map((e) => e.path);

describe('plan.mjs impact', () => {
  const impact = (...args: string[]) => planJson<ImpactReport>(root, 'impact', ...args);

  it('lists dependents and dependencies of a file with their features and areas', () => {
    const report = impact('--file', 'src/main/lantern-prs.ts', '--depth', '1');
    expect(report.counts).toEqual({ seeds: 1, dependents: 1, dependencies: 2 });
    expect(report.seeds).toEqual([{ path: 'src/main/lantern-prs.ts', role: 'service', feature: 'pull-requests', area: 'review-changes' }]);
    expect(paths(report.dependents)).toEqual(['src/main/lantern.ts']);
    expect(report.dependents[0]).toMatchObject({ role: 'service', feature: 'file-graph', area: 'explore-the-map', depth: 1, via: ['src/main/lantern-prs.ts'] });
    expect(paths(report.dependencies)).toEqual(['src/main/lantern-pr-parse.ts', 'src/main/lantern-types.ts']);
  });

  it('rolls the files up by feature and area with counts', () => {
    const report = impact('--file', 'src/main/lantern-prs.ts', '--depth', '1');
    expect(report.features).toEqual([
      { id: 'pull-requests', area: 'review-changes', seeds: 1, dependents: 0, dependencies: 1 },
      { id: 'file-graph', area: 'explore-the-map', seeds: 0, dependents: 1, dependencies: 0 },
    ]);
    expect(report.areas.map((a) => [a.id, a.seeds, a.dependents, a.dependencies])).toEqual([
      ['review-changes', 1, 0, 1],
      ['explore-the-map', 0, 1, 0],
    ]);
  });

  it('counts how many seeds a dependent reaches', () => {
    const report = impact('--file', 'src/main/lantern-pr-parse.ts', '--file', 'src/main/lantern-prs.ts');
    const types = report.dependencies.find((d) => d.path === 'src/main/lantern-types.ts');
    expect(types?.via).toEqual(['src/main/lantern-pr-parse.ts', 'src/main/lantern-prs.ts']);
  });

  it('follows the relations further with --depth', () => {
    expect(paths(impact('--file', 'src/main/lantern-prs.ts', '--depth', '2').dependents)).toEqual(['src/main/lantern.ts', 'src/main/main.ts']);
    expect(impact('--file', 'src/main/lantern-prs.ts', '--depth', '1').dependents.map((d) => d.depth)).toEqual([1]);
  });

  it('reports the second hop by default, as files with their feature', () => {
    const report = impact('--file', 'src/main/lantern-prs.ts');
    expect(report.depth).toBe(2);
    expect(report.dependents.map((d) => [d.path, d.depth, d.feature])).toEqual([
      ['src/main/lantern.ts', 1, 'file-graph'],
      ['src/main/main.ts', 2, 'file-graph'],
    ]);
  });

  it('seeds from a feature, an area, or a directory', () => {
    expect(paths(impact('--feature', 'macro-view').seeds)).toEqual(['src/renderer/lib/macroview/marks.ts', 'src/renderer/lib/macroview/model.ts', 'src/renderer/lib/macroview/mount.ts']);
    expect(impact('--area', 'review-changes').counts.seeds).toBe(2);
    expect(impact('--file', 'src/renderer/lib/macroview/').counts.seeds).toBe(3);
  });

  it('names the outside systems the seeds talk to', () => {
    expect(impact('--file', 'src/main/lantern.ts').systems).toEqual([{ id: 'git', files: 1 }]);
  });

  it('refuses an unknown seed and a request with no seed', () => {
    const unknown = runPlan(root, 'impact', '--feature', 'nope', '--file', 'src/nope.ts');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/feature "nope" is not in the map/);
    expect(unknown.stderr).toMatch(/file "src\/nope\.ts" is not in the map/);
    expect(runPlan(root, 'impact').status).toBe(2);
  });

  it('prints a readable report', () => {
    const run = runPlan(root, 'impact', '--file', 'src/main/lantern-prs.ts');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/impact \(depth 2\): 1 seed file\(s\), 2 dependent\(s\), 2 dependencies/);
    expect(run.stdout).toMatch(/dependents \(files that use the seeds\):\n {2}src\/main\/lantern\.ts {2}\[service \/ file-graph \/ explore-the-map\] {2}\(1 link, depth 1\)/);
    expect(run.stdout).toMatch(/further dependents \(second hop: files that use a dependent\):\n {2}src\/main\/main\.ts {2}\[entry \/ file-graph \/ explore-the-map\] {2}\(1 link, depth 2\)/);
  });
});

describe('plan.mjs new and add', () => {
  const add = (slug: string, ...args: string[]) => runPlan(root, 'add', slug, ...args);

  function buildPlan() {
    expect(runPlan(root, 'new', 'built', '--title', 'Build it', '--goal', 'It is built.').status).toBe(0);
    expect(add('built', 'scope', 'in', 'The build.').status).toBe(0);
    expect(add('built', 'scope', 'out', 'The release.').status).toBe(0);
    expect(add('built', 'impact', 'feature', 'pull-requests', 'The reader sits beside the PR parser.').status).toBe(0);
    expect(add('built', 'stage', 'First stage').status).toBe(0);
    expect(add('built', 'item', 's1', 'Write the reader', '--touch', 'file:src/main/lantern-pr-parse.ts', '--accept', 'The reader test passes.').status).toBe(0);
    expect(add('built', 'question', 's1', 'Where does it live?').status).toBe(0);
    expect(add('built', 'risk', 'It may be slow.').status).toBe(0);
  }

  it('builds a plan that passes check, with ids assigned in order', () => {
    buildPlan();
    expect(read('built')).toContain('#stage s1 First stage\n#item s1.1 Write the reader\n#touch file src/main/lantern-pr-parse.ts\n#accept The reader test passes.\n#question s1.q1 Where does it live?');
    expect(planJson<{ ok: boolean }>(root, 'check', 'built').ok).toBe(true);
  });

  it('adds a second item and a stage-level touch with the next ids', () => {
    buildPlan();
    expect(add('built', 'item', 's1', 'Test the reader', '--touch', 'feature:pull-requests', '--accept', 'Tests are green.').status).toBe(0);
    expect(add('built', 'touch', 's1', 'feature', 'pull-requests').status).toBe(0);
    expect(add('built', 'stage', 'Second stage').status).toBe(0);
    expect(read('built')).toMatch(/#item s1\.2 Test the reader[\s\S]*#stage s2 Second stage/);
    expect(read('built')).toMatch(/#stage s1 First stage\n#touch feature pull-requests\n#item s1\.1/);
  });

  it('records an answer with who answered it', () => {
    buildPlan();
    expect(add('built', 'answer', 's1.q1', 'jun', 'In the main process.').status).toBe(0);
    expect(read('built')).toContain('#question s1.q1 Where does it live?\n#answer jun In the main process.');
  });

  it('records a long answer up to 2000 characters and refuses one more', () => {
    buildPlan();
    expect(add('built', 'answer', 's1.q1', 'jun', 'z'.repeat(2000)).status).toBe(0);
    expect(read('built')).toContain(`#answer jun ${'z'.repeat(2000)}`);
    const over = add('built', 'answer', 's1.q1', 'jun', 'z'.repeat(2001));
    expect(over.status).toBe(1);
    expect(over.stdout + over.stderr).toMatch(/the cap is 2000/);
  });

  it('refuses a second plan with the same slug and a plan with no goal', () => {
    expect(runPlan(root, 'new', EXAMPLE, '--title', 'x', '--goal', 'y').status).toBe(1);
    expect(runPlan(root, 'new', 'bare', '--title', 'x').status).toBe(2);
    expect(runPlan(root, 'new', 'Bad_Slug', '--title', 'x', '--goal', 'y').status).toBe(2);
  });

  it('refuses text that breaks the format and leaves the file as it was', () => {
    buildPlan();
    const before = read('built');
    const tooLong = add('built', 'risk', 'x'.repeat(200));
    expect(tooLong.status).toBe(1);
    expect(tooLong.stderr).toMatch(/the cap is 160/);
    expect(add('built', 'item', 's9', 'Nowhere').status).toBe(1);
    expect(add('built', 'answer', 's9.q9', 'jun', 'No.').status).toBe(1);
    expect(add('built', 'colour', 'x').status).toBe(1);
    expect(read('built')).toBe(before);
  });
});

describe('plan.mjs approve, section by section', () => {
  const approve = (slug: string, section: string) => runPlan(root, 'approve', slug, section, '--by', 'jun', '--date', '2026-10-26');
  const show = (slug: string) => planJson<{ state: string; next: string | null; sections: { section: string; state: string }[] }>(root, 'show', slug);

  it('walks the review queue in order, one section at a time', () => {
    const order: string[] = [];
    for (let next = show(DRAFT).next; next; next = show(DRAFT).next) {
      order.push(next);
      expect(approve(DRAFT, next).status).toBe(0);
    }
    expect(order).toEqual(['goal', 'scope', 'impact', 's1', 'risks']);
    expect(show(DRAFT).state).toBe('draft');
  });

  it('approves the plan only when every section is approved', () => {
    const early = approve(DRAFT, 'plan');
    expect(early.status).toBe(1);
    expect(early.stderr).toMatch(/sections still open: goal \(pending\), scope \(pending\), impact \(pending\), s1 \(pending\), risks \(pending\)/);
    for (const section of ['goal', 'scope', 'impact', 's1', 'risks']) approve(DRAFT, section);
    expect(approve(DRAFT, 'plan').status).toBe(0);
    expect(show(DRAFT).state).toBe('approved');
    expect(read(DRAFT)).toMatch(/#approved plan jun 2026-10-26\n$/);
  });

  it('refuses a section the plan does not have', () => {
    const run = approve(DRAFT, 'stage-two');
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/no section stage-two; sections: title, goal, scope, impact, s1, risks/);
  });

  it('takes the approval back when the section changes, until it is shown and approved again', () => {
    expect(show(EXAMPLE).state).toBe('approved');
    expect(runPlan(root, 'add', EXAMPLE, 'risk', 'A new risk.').status).toBe(0);
    expect(planJson<{ ok: boolean; results: { errors: string[] }[] }>(root, 'check', EXAMPLE).results[0].errors.join()).toMatch(/section risks is changed since it was approved/);
    expect(approve(EXAMPLE, 'risks').status).toBe(0);
    expect(show(EXAMPLE).state).toBe('draft');
    expect(approve(EXAMPLE, 'plan').status).toBe(0);
    expect(show(EXAMPLE).state).toBe('approved');
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(0);
  });

  it('keeps an approval when only a question is answered', () => {
    expect(runPlan(root, 'add', EXAMPLE, 'answer', 's2.q1', 'jun', 'Beside the macro view.').status).toBe(0);
    expect(show(EXAMPLE).state).toBe('approved');
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(0);
  });

  it('says so when the rewrite drops a tag it does not know, on approve and on verified too', () => {
    fs.appendFileSync(planPath(DRAFT), '#future keep me\n');
    const approved = approve(DRAFT, 'goal');
    expect(approved.stdout).toMatch(/warning: dropped on rewrite: .*unknown #future line, ignored/);
    expect(read(DRAFT)).not.toContain('#future');
    fs.appendFileSync(planPath(EXAMPLE), '#future keep me\n');
    const verified = runPlan(root, 'verified', EXAMPLE, 's1.1', '--by', 'jun');
    expect(verified.stdout).toMatch(/warning: dropped on rewrite: .*unknown #future line, ignored/);
  });

  it('shows a section with no lines as none named', () => {
    expect(runPlan(root, 'show', DRAFT, 'risks').stdout).toBe('section risks: pending\n(none named)\n');
  });

  it('needs to know who approved', () => {
    expect(runPlan(root, 'approve', DRAFT, 'goal').status).toBe(2);
  });

  it('shows one section as written, with its state', () => {
    const run = runPlan(root, 'show', EXAMPLE, 's1');
    expect(run.stdout).toMatch(/^section s1: approved\n#stage s1 Read plans in the main process\n#item s1\.1/);
    expect(run.stdout).toMatch(/#answer s1\.q1 jun Only the checked-out branch for now\.$/m);
  });
});

describe('plan.mjs verified', () => {
  it('writes the only status the plan stores', () => {
    expect(runPlan(root, 'verified', EXAMPLE, 's1.1', '--by', 'jun', '--date', '2026-11-02').status).toBe(0);
    expect(read(EXAMPLE)).toMatch(/#approved plan jun 2026-10-27\n#verified s1\.1 jun 2026-11-02\n$/);
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(0);
    expect(runPlan(root, 'verified', EXAMPLE, 's9.9', '--by', 'jun').status).toBe(1);
  });
});

describe('the planning skills check', () => {
  it('lists the skills that are missing and says how to install them', async () => {
    const skills = await importScript<{
      PLANNING_SKILLS: { name: string }[];
      checkPlanningSkills: (roots: string[]) => { name: string; found: string | null }[];
      formatSkillCheck: (results: { name: string; purpose: string; found: string | null }[]) => string[];
    }>('planning-skills.mjs');
    const dir = makeTmp('lantern-plan-registry-');
    for (const name of ['lantern-plan', 'lantern-plan-impact', 'lantern-plan-stages']) write(dir, `${name}/SKILL.md`, '---\nname: x\n---\n');
    const results = skills.checkPlanningSkills([dir]);
    expect(results.filter((r) => !r.found).map((r) => r.name)).toEqual(['lantern-plan-review', 'lantern-plan-handoff']);
    const lines = skills.formatSkillCheck(results as never);
    expect(lines.join('\n')).toMatch(/MISSING lantern-plan-review/);
    expect(lines.join('\n')).toMatch(/2 planning skill\(s\) missing: lantern-plan-review, lantern-plan-handoff\. Install them with `pnpm run install-skills/);
    expect(skills.checkPlanningSkills([]).every((r) => r.found === null)).toBe(true);
    removeDir(dir);
  });

  it('resolves every planning skill from the repo and prints what to read at each step', () => {
    const run = runPlan(root, 'skills');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/every planning skill resolves/);
    expect(run.stdout).toMatch(/step 5 review section by section: lantern-plan-review/);
  });
});

describe('the map gate', () => {
  const settled = () => {
    const dir = makeTmp('lantern-plan-gate-');
    write(dir, 'a.ts', 'export const a = 1;\n');
    return dir;
  };

  it('stays closed on a map that is not settled, and says to set it up or refresh it', () => {
    const run = runPlan(root, 'gate');
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/FAIL map: validate\.mjs --settled exits 1\. Planning needs a settled Lantern map\. Set the map up or refresh it with lantern-setup/);
    expect(run.stdout).toMatch(/GATE CLOSED/);
  });

  it('stays closed on a project with no map at all', () => {
    const dir = settled();
    const run = runPlan(dir, 'gate');
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/has no \.lantern\/map\. Planning needs a settled Lantern map/);
    removeDir(dir);
  });

  it('opens on a settled map', async () => {
    const dir = settled();
    const lib = await import(pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href);
    write(dir, '.lantern/map/.lantern', `lantern 1\n# .\n\na.ts . util ${lib.hashFile(dir, 'a.ts')}\n`);
    write(dir, '.lantern/lang/en/.lantern.json', '{"text":{"a.ts":"a constant"}}\n');
    const run = runPlan(dir, 'gate');
    expect(run.stdout).toMatch(/ok {3}map: validate\.mjs --settled passes/);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/GATE OPEN/);
    removeDir(dir);
  });
});
