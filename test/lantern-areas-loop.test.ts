import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runFakeAgent } from '../scripts/skill-test/fake-agent.mjs';
import { judgeAreasAdd, judgeAreasRebuilt, judgeAreasSetup, parseTree } from '../scripts/skill-test/areas-checks.mjs';
import { createAreasProject, NEW_FEATURE } from '../scripts/skill-test/areas-fixtures.mjs';
import { snapshotSources } from '../scripts/skill-test/fixtures.mjs';
import { AREAS_ADD_FAILING_PROMPT, AREAS_ADD_PROMPT, AREAS_MERGED_PROMPT, AREAS_PROMPT } from '../scripts/skill-test/prompts.mjs';
import { VALID_TREE } from './helpers/lantern-areas-fixtures';
import { coupledSpec, runAreas } from './helpers/lantern-areas-gate-fixtures';
import { makeVocabProject, removeVocabProjects, runScript } from './helpers/lantern-vocab-project';

const REPO = path.join(__dirname, '..');
const SYNC = path.join(REPO, 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const RETAG = path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'retag.mjs');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

afterEach(removeVocabProjects);

function repoWith(tree?: string) {
  const root = makeVocabProject(coupledSpec(tree));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.test');
  git('config', 'user.name', 't');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return root;
}

function verify(root: string) {
  const result = spawnSync(process.execPath, [SYNC, 'verify', '--base', 'main', '--root', root], { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function retag(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [RETAG, root, ...args], { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const areasFile = (root: string) => fs.readFileSync(path.join(root, '.lantern', 'areas'), 'utf8');
const areasTexts = (root: string) => JSON.parse(fs.readFileSync(path.join(root, '.lantern', 'lang', 'en', 'areas.json'), 'utf8')).text;
const leaves = (root: string) => areasFile(root).split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim());
const validate = (root: string) => runScript('validate.mjs', [root, '--settled']);

describe('the skill text names the Areas loop', () => {
  const setup = read('skills/lantern-setup/SKILL.md');

  it('has step 4a with its thresholds, cap, lookup commands and the flat-view fallback', () => {
    expect(setup).toMatch(/^4a\. \*\*Areas\.\*\*/m);
    expect(setup).toContain('more than\n   120 records and 8 or more features');
    expect(setup).toContain('At most 3 rounds');
    expect(setup).toContain('areas.mjs . propose');
    expect(setup).toContain('areas.mjs . lookup run --out .ai/tmp/areas');
    expect(setup).toContain('areas.mjs . lookup packets --out');
    expect(setup).toContain('lookup score --answers');
    expect(setup).toContain('"placed elsewhere"');
    expect(setup).toContain('keep the flat view');
    expect(setup).toContain('An existing `.lantern/areas` that passes `check` stays');
  });

  it('puts the loop in retag mode too, and lets the lookup gate only creating or replacing a tree', () => {
    expect(setup).toMatch(/7\. \*\*Areas\.\*\* With more than 120 records and 8 or more features/);
    expect(setup).toContain('The lookup gates only creating a tree or replacing one that\n  fails `check`');
  });

  it('tells delegates and lantern-sync to place or create an area, run check, and never delete the tree', () => {
    for (const text of [read('skills/lantern-delegate/protocol.md'), read('skills/lantern-sync/SKILL.md')]) {
      expect(text).toContain('areas.mjs');
      expect(text).toContain('--allow-unassigned');
      expect(text).toContain('"To assign"');
      expect(text).toContain('eighth area');
      expect(text).toMatch(/never delete the tree/i);
    }
  });
});

describe('the overflow rule and the coordination between delegates', () => {
  const protocol = read('skills/lantern-delegate/protocol.md');
  const orchestrator = read('skills/lantern-delegate/SKILL.md');
  const sync = read('skills/lantern-sync/SKILL.md');

  it('rebuilds the areas in the PR with only the Areas loop, and keeps "To assign" for a loop that fails', () => {
    for (const text of [protocol, sync]) {
      expect(text).toMatch(/rebuild the areas in this PR/);
      expect(text).toMatch(/"Areas loop"/);
      expect(text).toMatch(/at most\s+3 rounds/);
      expect(text).toMatch(/never the full retag|It is never the full retag/);
      expect(text).toMatch(/Only (when|if) the loop fails within the cap/);
      expect(text).toMatch(/a few model calls/);
      expect(text).toMatch(/AREAS: rebuilt/);
      expect(text).toMatch(/AREAS: placed <feature> in <area>/);
      expect(text).toMatch(/AREAS: to assign <feature> \(<reason>\)/);
      expect(text).toMatch(/PR record/);
    }
    expect(protocol).not.toMatch(/never run the setup loop here/);
  });

  it('merges the PR target before the final verify and takes the target tree on a conflict', () => {
    for (const text of [protocol, sync]) {
      expect(text).toContain('fetch');
      expect(text).toContain('--allow-unassigned');
      expect(text).toMatch(/takes? the target('s| branch's) version|taking the target branch's version/);
    }
    expect(protocol).toMatch(/^2a\. \*\*Ship-time merge/m);
    expect(protocol).toMatch(/before step 3's first `finish`/);
    expect(protocol).toMatch(/git merge --no-edit origin\/<target>` \(no force, no rebase of pushed commits\)/);
    expect(protocol).toMatch(/A merge that comes after the PR is open[\s\S]*?\*\*Re-entry\*\*/);
    expect(protocol).toMatch(/declare\s+its id in `\.lantern\/features`/);
    expect(protocol).toContain('retag.mjs . retag-feature <old> <new>');
    expect(protocol).toMatch(/first commit the `\.lantern\/` work so far/);
    expect(sync).toContain('retag.mjs . retag-feature <old> <new>');
    expect(sync).toMatch(/before the first map `finish`/);
    expect(protocol).toMatch(/write it back with the\s+Write tool, never a redirect/);
    expect(protocol).toMatch(/step 2a \(the ship-time merge\) is skipped/);
    expect(protocol).toMatch(/never by\s+hand-merging two trees/);
  });

  it('gives the orchestrator the message template and the brief line', () => {
    expect(orchestrator).toContain('Areas were rebuilt in PR #<id> (<branch>); before you ship, merge <target> once that PR is merged, or merge its branch if your PR stacks on it, and re-place your features against the new tree; do not rebuild areas yourself unless your feature does not fit the new tree.');
    expect(orchestrator).toContain('ship against the current target; do not wait.');
    expect(protocol).toContain('identity.mjs --exec git merge --no-edit origin/<target>');
    expect(protocol).toMatch(/conflict outside `\.lantern\/` is a source change of\s+yours: resolve it, then back to step 2/);
    expect(orchestrator).toMatch(/AREAS: rebuilt/);
    expect(orchestrator).toMatch(/every\s+other delegate of the session that is still running/);
    expect(orchestrator).toMatch(/Should not.*coordinated/s);
    expect(orchestrator).toMatch(/Areas changes are coordinated/);
  });
});

describe('sync.mjs verify and the areas tree', () => {
  it('prints no areas line and exits 0 when the project has no .lantern/areas', () => {
    const result = verify(repoWith());
    expect(result.status).toBe(0);
    expect(result.out).not.toContain('[areas]');
  });

  it('is green with no areas warning for a tree that passes check', () => {
    const result = verify(repoWith(VALID_TREE));
    expect(result.status).toBe(0);
    expect(result.out).not.toContain('[areas]');
  });

  it('warns, and still exits 0, on a tree that fails check', () => {
    const layers = 'screen-backend\n  catalog\n  orders\n  payments\n  invoices\nmisc-other\n  shipping\n  returns\nportal-modules\n  accounts\n  reports\n';
    const result = verify(repoWith(layers));
    expect(result.out).toContain('GREEN');
    expect(result.status).toBe(0);
    expect(result.out).toContain("warning: [areas] name-words: screen-backend: 'backend' is a platform, channel or vendor word");
  });

  it('warns once per feature under "To assign" and exits 0', () => {
    const result = verify(repoWith(VALID_TREE.replace('  reports\n', '').replace('  returns\n', '')));
    expect(result.status).toBe(0);
    expect(result.out).toContain('warning: [areas] feature "reports" is under "To assign"');
    expect(result.out).toContain('warning: [areas] feature "returns" is under "To assign"');
    expect(result.out.match(/is under "To assign"/g)).toHaveLength(2);
  });
});

describe('retag-feature and the areas leaf', () => {
  it('renames the leaf in place and keeps the tree valid', () => {
    const root = makeVocabProject(coupledSpec(VALID_TREE));
    const done = retag(root, 'retag-feature', 'reports', 'insights');
    expect(done.status, done.out).toBe(0);
    expect(done.out).toContain('area leaf updated');
    expect(leaves(root)).toContain('insights');
    expect(leaves(root)).not.toContain('reports');
    expect(validate(root).status).toBe(0);
    expect(runAreas(['check', root]).status).toBe(0);
  });

  it('merges into the leaf that already exists, once', () => {
    const root = makeVocabProject(coupledSpec(VALID_TREE));
    expect(retag(root, 'retag-feature', 'returns', 'shipping').status).toBe(0);
    expect(leaves(root).filter((l) => l === 'shipping')).toHaveLength(1);
    expect(leaves(root)).not.toContain('returns');
    expect(validate(root).status).toBe(0);
    const again = retag(root, 'retag-feature', 'returns', 'shipping');
    expect(again.status).toBe(0);
    expect(leaves(root).filter((l) => l === 'shipping')).toHaveLength(1);
  });

  it('drops the leaf on --untag, and the area with its text when it empties', () => {
    const root = makeVocabProject(coupledSpec(VALID_TREE));
    expect(retag(root, 'retag-feature', 'reports', '--untag').status).toBe(0);
    expect(leaves(root)).not.toContain('reports');
    expect(areasFile(root)).toContain('people-and-insight');
    expect(retag(root, 'retag-feature', 'accounts', '--untag').status).toBe(0);
    expect(areasFile(root)).not.toContain('people-and-insight');
    expect(areasTexts(root)['people-and-insight']).toBeUndefined();
    expect(areasTexts(root)['order-handling']).toBeDefined();
    expect(validate(root).status).toBe(0);
  });

  it('does nothing to the areas file for a feature that has no leaf, and for a project without one', () => {
    const root = makeVocabProject(coupledSpec(VALID_TREE.replace('  reports\n', '')));
    const before = areasFile(root);
    expect(retag(root, 'retag-feature', 'reports', 'insights').status).toBe(0);
    expect(areasFile(root)).toBe(before);
    const bare = makeVocabProject(coupledSpec());
    const done = retag(bare, 'retag-feature', 'reports', 'insights');
    expect(done.status, done.out).toBe(0);
    expect(fs.existsSync(path.join(bare, '.lantern', 'areas'))).toBe(false);
  });

  it('leaves system rename and merge alone', () => {
    const root = makeVocabProject(coupledSpec(VALID_TREE));
    const before = areasFile(root);
    expect(retag(root, 'rename-system', 'mail-relay', 'mailer').status).toBe(0);
    expect(areasFile(root)).toBe(before);
  });
});

describe('the fake agent and the areas skill-test judges', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => { fs.rmSync(d, { recursive: true, force: true }); }));

  function shop(tree: 'five' | 'seven' | null, prompt: string, scenario = 'good') {
    const root = path.join(fs.mkdtempSync(path.join(fs.realpathSync(require('node:os').tmpdir()), 'areas-loop-')), 'project');
    dirs.push(path.dirname(root));
    createAreasProject(root, { tree });
    const before = snapshotSources(root);
    const beforeTree = tree ? parseTree(root) : null;
    const out: string[] = [];
    expect(runFakeAgent(['-p', prompt], { scenario }, root, (line: string) => out.push(line)), out[0]).toBe(0);
    return { root, before, beforeTree };
  }

  it('writes a passing tree for a 121-record, 12-feature map', () => {
    const { root, before } = shop(null, AREAS_PROMPT);
    expect(Object.keys(before).length).toBeGreaterThan(120);
    expect(runAreas(['check', root]).status).toBe(0);
    expect(judgeAreasSetup(root, { before })).toMatchObject({ ok: true });
  });

  it('is judged red when the written tree is named after layers', () => {
    const { root, before } = shop(null, AREAS_PROMPT, 'broken');
    const verdict = judgeAreasSetup(root, { before });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("'frontend' is a platform, channel or vendor word");
  });

  it('places a new feature in an existing area and the tree stays valid', () => {
    const { root, beforeTree } = shop('five', AREAS_ADD_PROMPT);
    expect(parseTree(root)['order-handling']).toContain(NEW_FEATURE);
    expect(runAreas(['check', root]).status).toBe(0);
    expect(validate(root).status).toBe(0);
    expect(judgeAreasAdd(root, { beforeTree, expectPlaced: true })).toMatchObject({ ok: true });
  });

  it('ends in a rebuilt tree that passes check, not in "To assign", when a seven-area tree has no room for an eighth', () => {
    const { root, beforeTree } = shop('seven', AREAS_ADD_PROMPT);
    expect(parseTree(root)).not.toEqual(beforeTree);
    expect(parseTree(root)['order-handling']).toContain(NEW_FEATURE);
    const strict = runAreas(['check', root]);
    expect(strict.status, strict.stdout).toBe(0);
    expect(strict.stdout).not.toContain('To assign');
    expect(validate(root).status).toBe(0);
    expect(judgeAreasRebuilt(root, { beforeTree })).toMatchObject({ ok: true });
  });

  it('is judged red when the overflow case leaves "To assign" although the loop could succeed', () => {
    const stuck = shop('seven', AREAS_ADD_FAILING_PROMPT);
    const verdict = judgeAreasRebuilt(stuck.root, { beforeTree: stuck.beforeTree });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(`To assign: ${NEW_FEATURE}`);
  });

  it('accepts a placement that passes check, and the fake overflow output changes the set of areas', () => {
    const placed = shop('five', AREAS_ADD_PROMPT);
    expect(judgeAreasRebuilt(placed.root, { beforeTree: placed.beforeTree })).toMatchObject({ ok: true });
    const seven = shop('seven', AREAS_ADD_PROMPT);
    expect(Object.keys(parseTree(seven.root))).not.toEqual(Object.keys(seven.beforeTree));
    expect(judgeAreasRebuilt(seven.root, { beforeTree: seven.beforeTree })).toMatchObject({ ok: true, reason: expect.stringContaining('a rebuilt tree') });
  });

  it('ends in "To assign" with the old tree intact when the loop fails within the cap', () => {
    const { root, beforeTree } = shop('seven', AREAS_ADD_FAILING_PROMPT);
    expect(parseTree(root)).toEqual(beforeTree);
    expect(runAreas(['check', root]).status).toBe(1);
    const lenient = runAreas(['check', root, '--allow-unassigned']);
    expect(lenient.status).toBe(0);
    expect(lenient.stdout).toContain(`To assign: ${NEW_FEATURE}`);
    expect(judgeAreasAdd(root, { beforeTree, expectPlaced: false })).toMatchObject({ ok: true });
  });

  it('is judged red when the failed loop leaves the old tree changed', () => {
    const { root, beforeTree } = shop('seven', AREAS_ADD_FAILING_PROMPT);
    const rebuilt = shop('seven', AREAS_ADD_PROMPT);
    fs.copyFileSync(path.join(rebuilt.root, '.lantern', 'areas'), path.join(root, '.lantern', 'areas'));
    fs.copyFileSync(path.join(rebuilt.root, '.lantern', 'lang', 'en', 'areas.json'), path.join(root, '.lantern', 'lang', 'en', 'areas.json'));
    const verdict = judgeAreasAdd(root, { beforeTree, expectPlaced: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/lost parts|was placed/);
  });

  it('re-places only its own feature when the target tree replaced the delegate tree underneath it', () => {
    const { root, beforeTree } = shop('seven', AREAS_MERGED_PROMPT);
    const tree = parseTree(root);
    expect(Object.keys(tree)).toEqual(Object.keys(beforeTree));
    expect(Object.values(tree).flat()).toContain(NEW_FEATURE);
    expect(runAreas(['check', root]).status).toBe(0);
    expect(judgeAreasAdd(root, { beforeTree, expectPlaced: true })).toMatchObject({ ok: true });
  });

  it('is judged red when the feature is listed twice or a tree part disappears', () => {
    const twice = shop('five', AREAS_ADD_PROMPT, 'broken');
    expect(judgeAreasAdd(twice.root, { beforeTree: twice.beforeTree, expectPlaced: true }).ok).toBe(false);
    const lost = shop('seven', AREAS_ADD_PROMPT);
    fs.writeFileSync(path.join(lost.root, '.lantern', 'areas'), fs.readFileSync(path.join(lost.root, '.lantern', 'areas'), 'utf8').replace('  support\n', ''));
    const verdict = judgeAreasAdd(lost.root, { beforeTree: lost.beforeTree, expectPlaced: false });
    expect(verdict.ok).toBe(false);
  });
});
