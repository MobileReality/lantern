import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGraph, loadMacro } from '../src/main/lantern';
import type { LanternMap, LanternPlanView } from '../src/main/lantern';
import { readRegisteredMacro } from '../src/main/lantern-macro-load';
import { lanternStamp } from '../src/main/lantern-stamp';
import { deriveMarks } from '../src/renderer/lib/macroview/marks';
import { buildModel } from '../src/renderer/lib/macroview/model';
import type { AreasPayload } from '../src/renderer/lib/macroview/types';
import { itemPick, planFocus, planPick, stagePick } from '../src/renderer/lib/lanternplanfocus';
import { commitFile, git, mergeNoFf, prRecord, write } from './helpers/git-repo';
import { EXAMPLE, fixtureText, makeProject, makeRemoteProject, removeDir } from './helpers/lantern-plan-world';

const roots: string[] = [];
const track = (root: string) => {
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) removeDir(root);
});

async function plansOf(root: string): Promise<{ plans: LanternPlanView[]; map: LanternMap }> {
  const map = await loadGraph(root, undefined, true);
  return { plans: map.plans, map };
}

const stageOf = (plan: LanternPlanView, id: string) => plan.stages.find((stage) => stage.id === id)!;
const itemOf = (plan: LanternPlanView, id: string) => plan.stages.flatMap((stage) => stage.items).find((item) => item.id === id)!;
const planFile = (root: string) => path.join(root, '.lantern', 'plans', `${EXAMPLE}.plan`);

describe('the plans the app loads next to the map', () => {
  it('loads one plan with its stages in order', async () => {
    const root = track(makeProject([EXAMPLE]));
    const { plans } = await plansOf(root);
    expect(plans).toHaveLength(1);
    expect(plans[0].slug).toBe(EXAMPLE);
    expect(plans[0].title).toBe("Show a plan's stages and progress on the Lantern map");
    expect(plans[0].stages.map((stage) => stage.id)).toEqual(['s1', 's2']);
    expect(plans[0].stages.map((stage) => stage.items.map((item) => item.id))).toEqual([['s1.1', 's1.2'], ['s2.1', 's2.2']]);
    expect(plans[0].impact.map((entry) => `${entry.kind}:${entry.target}`)).toContain('feature:macro-view');
  });

  it('yields an empty list for a project without plans', async () => {
    const root = track(makeProject([]));
    const { plans, map } = await plansOf(root);
    expect(map.exists).toBe(true);
    expect(plans).toEqual([]);
  });

  it('reads a stage with an unanswered question as blocked, until the question is answered', async () => {
    const root = track(makeProject([EXAMPLE]));
    const first = (await plansOf(root)).plans[0];
    expect(stageOf(first, 's2').blocked).toBe(true);
    expect(stageOf(first, 's2').questions.map((question) => [question.id, question.answer])).toEqual([['s2.q1', null]]);
    expect(itemOf(first, 's2.1').blocked).toBe(true);
    expect(stageOf(first, 's1').blocked).toBe(false);
    expect(stageOf(first, 's1').questions[0].answer).toEqual({ by: 'jun', text: 'Only the checked-out branch for now.' });

    const question = '#question s2.q1 Does the stage list sit in the review pane or beside the macro view?';
    fs.writeFileSync(planFile(root), fixtureText(EXAMPLE).replace(question, `${question}\n#answer jun Beside the macro view.`));
    const answered = (await plansOf(root)).plans[0];
    expect(stageOf(answered, 's2').blocked).toBe(false);
    expect(itemOf(answered, 's2.1').blocked).toBe(false);
    expect(stageOf(answered, 's2').approval.state).toBe('approved');
  });

  it('shows an approved plan as approved, and a section edited after approval as stale', async () => {
    const root = track(makeProject([EXAMPLE]));
    const approved = (await plansOf(root)).plans[0];
    expect(approved.lifecycle).toBe('approved');
    expect(approved.sections.every((mark) => mark.state === 'approved')).toBe(true);

    const edited = fixtureText(EXAMPLE).replace('#item s2.2 Highlight what a selected stage changes', '#item s2.2 Highlight what a selected stage changes, softly');
    fs.writeFileSync(planFile(root), edited);
    const stale = (await plansOf(root)).plans[0];
    expect(stale.lifecycle).toBe('stale');
    expect(stageOf(stale, 's2').approval.state).toBe('stale');
    expect(stageOf(stale, 's1').approval.state).toBe('approved');
    expect(stale.sections.find((mark) => mark.section === 's2')).toMatchObject({ state: 'stale', by: 'jun' });
  });

  it('shows a plan that was never approved as a draft with pending sections', async () => {
    const root = track(makeProject(['draft-reader']));
    const draft = (await plansOf(root)).plans[0];
    expect(draft.lifecycle).toBe('draft');
    expect(draft.sections.map((mark) => `${mark.section}:${mark.state}`)).toEqual(['title:approved', 'goal:pending', 'scope:pending', 'impact:pending', 's1:pending', 'risks:pending']);
  });

  it('reports a plan file it cannot read as a map warning instead of a plan', async () => {
    const root = track(makeProject([EXAMPLE]));
    write(root, '.lantern/plans/broken.plan', 'not a plan\n');
    const { plans, map } = await plansOf(root);
    expect(plans.map((plan) => plan.slug)).toEqual([EXAMPLE]);
    expect(map.warnings.some((warning) => warning.includes('.lantern/plans/broken.plan'))).toBe(true);
  });

  it('keeps a plan with a few unreadable lines and counts them', async () => {
    const root = track(makeProject([EXAMPLE]));
    fs.appendFileSync(planFile(root), 'a line that is not a tag line\n');
    const { plans } = await plansOf(root);
    expect(plans[0].problems).toHaveLength(1);
  });
});

describe('plans refresh whenever the map does', () => {
  it('changes the stamp the app polls when a plan file is edited, added or removed', async () => {
    const root = track(makeProject([EXAMPLE]));
    const stamps = [await lanternStamp(root)];
    fs.appendFileSync(planFile(root), '#risk Another risk.\n');
    stamps.push(await lanternStamp(root));
    write(root, '.lantern/plans/second.plan', fixtureText('draft-reader').replace('# draft-reader', '# second'));
    stamps.push(await lanternStamp(root));
    fs.rmSync(path.join(root, '.lantern', 'plans', 'second.plan'));
    stamps.push(await lanternStamp(root));
    expect(new Set(stamps).size).toBe(3);
    expect(stamps[3]).not.toBe(stamps[2]);
  });

  it('changes the stamp when a pull request record that ticks an item lands', async () => {
    const root = track(makeProject([EXAMPLE]));
    const before = await lanternStamp(root);
    write(root, '.lantern/prs/301.pr', prRecord({ id: 301, branch: 'feat/x', head: 'a'.repeat(40), files: [`#plan ${EXAMPLE} s1.1`, '~ src/main/lantern-prs.ts'] }));
    expect(await lanternStamp(root)).not.toBe(before);
  });
});

describe('item status from the pull request records the app already derives', () => {
  function pushPrBranch(root: string, id: number, branch: string, item: string) {
    git(root, ['checkout', '-q', '-b', branch, 'main']);
    const head = commitFile(root, 'src/main/lantern-prs.ts', `export const change${id} = ${id};\n`, `change ${id}`);
    commitFile(root, `.lantern/prs/${id}.pr`, prRecord({ id, branch, head, title: `Tick ${item}`, files: [`#plan ${EXAMPLE} ${item}`, '~ src/main/lantern-prs.ts'] }), `chore: record pull request #${id}`);
    git(root, ['push', '-q', 'origin', branch]);
    git(root, ['checkout', '-q', 'main']);
  }

  it('reads open as in progress, merged as implemented, and links the pull requests from the item', async () => {
    const world = makeRemoteProject([EXAMPLE]);
    track(world.dir);
    pushPrBranch(world.root, 201, 'feat/s1-1', 's1.1');
    mergeNoFf(world.root, 'feat/s1-1', 201);
    git(world.root, ['push', '-q', 'origin', 'main']);
    pushPrBranch(world.root, 202, 'feat/s1-2', 's1.2');

    const plan = (await plansOf(world.root)).plans[0];
    expect(itemOf(plan, 's1.1')).toMatchObject({ status: 'implemented', prs: [{ id: '201', state: 'merged', title: 'Tick s1.1' }] });
    expect(itemOf(plan, 's1.2')).toMatchObject({ status: 'in progress', prs: [{ id: '202', state: 'open' }] });
    expect(itemOf(plan, 's2.1').status).toBe('planned');
    expect(itemOf(plan, 's2.1').prs).toEqual([]);
    expect(plan.finished).toBe(1);
    expect(plan.total).toBe(4);
    expect(stageOf(plan, 's1').done).toBe(false);
  });
});

describe('selecting a stage on the macro view', () => {
  async function payloadOf(root: string): Promise<AreasPayload> {
    const loaded = await readRegisteredMacro(() => true, loadMacro, root);
    if (!loaded.ok || !loaded.areas) throw new Error(loaded.ok ? 'the fixture map has no areas' : loaded.error);
    return { view: loaded.view, texts: loaded.texts, blockByPath: loaded.blockByPath, systemsByPath: loaded.systemsByPath, minStrongEdge: loaded.minStrongEdge, areas: loaded.areas };
  }

  async function marksFor(pickOf: (slug: string) => ReturnType<typeof planPick>) {
    const root = track(makeProject([EXAMPLE]));
    const plan = (await plansOf(root)).plans[0];
    const payload = await payloadOf(root);
    const model = buildModel(payload);
    const focus = planFocus(plan, pickOf(plan.slug));
    return deriveMarks(model, { prMarks: null, reading: { file: null, blocks: new Set() }, flowStep: null, payload, plan: focus }).plan;
  }

  it('marks exactly the files and features stage s1 touches, and nothing else', async () => {
    const marks = await marksFor((slug) => stagePick(slug, 's1'));
    expect(marks).not.toBeNull();
    expect([...marks!.files].sort()).toEqual(['src/main/lantern-prs.ts', 'src/main/lantern.ts', 'src/main/main.ts']);
    expect([...marks!.features].sort()).toEqual(['file-graph', 'pull-requests']);
    expect([...marks!.areas].sort()).toEqual(['explore-the-map', 'review-changes']);
    expect(marks!.foundation.size).toBe(0);
  });

  it('marks only what a single item touches', async () => {
    const marks = await marksFor((slug) => itemPick(slug, 's1.2'));
    expect([...marks!.files]).toEqual(['src/main/main.ts']);
    expect([...marks!.features]).toEqual(['file-graph']);
    expect([...marks!.areas]).toEqual(['explore-the-map']);
  });

  it('marks a feature a stage names even though it names none of its files', async () => {
    const marks = await marksFor((slug) => stagePick(slug, 's2'));
    expect([...marks!.features].sort()).toEqual(['macro-view']);
    expect([...marks!.files].sort()).toEqual(['src/renderer/lib/macroview/marks.ts', 'src/renderer/lib/macroview/model.ts']);
    expect([...marks!.areas]).toEqual(['explore-the-map']);
  });

  it('marks the areas, features and files of the #impact section for the plan as a whole', async () => {
    const marks = await marksFor((slug) => planPick(slug));
    expect([...marks!.areas].sort()).toEqual(['explore-the-map', 'review-changes']);
    expect([...marks!.features].sort()).toEqual(['file-graph', 'macro-view', 'pull-requests']);
    expect([...marks!.files].sort()).toEqual(['src/main/lantern-prs.ts', 'src/main/lantern.ts']);
  });

  it('marks the direct neighbours of the named files as related, apart from the changed ones, and draws no new file', async () => {
    const root = track(makeProject([EXAMPLE]));
    const { plans, map } = await plansOf(root);
    const payload = await payloadOf(root);
    const focus = planFocus(plans[0], stagePick(plans[0].slug, 's1'), map);
    const marks = deriveMarks(buildModel(payload), { prMarks: null, reading: { file: null, blocks: new Set() }, flowStep: null, payload, plan: focus }).plan!;
    expect([...marks.related].sort()).toEqual(['src/main/lantern-pr-parse.ts', 'src/main/lantern-types.ts']);
    expect([...marks.files].sort()).toEqual(['src/main/lantern-prs.ts', 'src/main/lantern.ts', 'src/main/main.ts']);
    expect(marks.files.has('src/main/lantern-plans.ts')).toBe(false);
  });

  it('marks nothing without a pick, and leaves the pull request marks alone', async () => {
    const root = track(makeProject([EXAMPLE]));
    const payload = await payloadOf(root);
    const marks = deriveMarks(buildModel(payload), { prMarks: null, reading: { file: null, blocks: new Set() }, flowStep: null, payload, plan: null });
    expect(marks.plan).toBeNull();
    expect(marks.files.size + marks.features.size + marks.areas.size).toBe(0);
  });
});
