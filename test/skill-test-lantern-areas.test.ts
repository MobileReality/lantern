import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { areasCheck, hasAreasFile, parseTree } from '../scripts/skill-test/areas-checks.mjs';
import { runFakeAgent } from '../scripts/skill-test/fake-agent.mjs';
import { snapshotSources, validateSettled } from '../scripts/skill-test/fixtures.mjs';
import { judgeOverflow, judgeRetagTree, judgeSmall, judgeTreeOrFlat, lookupEvidence } from '../scripts/skill-test/lantern-areas-checks.mjs';
import { ANSWERS_FILE, FIXTURES, mapNewFeature, PROJECT_NAMES, SCRATCH_DIR, writeTree } from '../scripts/skill-test/lantern-areas-fixtures.mjs';
import { NO_ANSWER, parsePacket, standInAnswer, standInAnswers, writePacketsFor } from '../scripts/skill-test/lantern-areas-reader.mjs';
import { SHOP, STUDIO } from '../scripts/skill-test/lantern-areas-specs.mjs';
import { LANTERN_AREAS_DELEGATE_PROMPT, LANTERN_AREAS_RETAG_PROMPT, LANTERN_AREAS_SETUP_PROMPT } from '../scripts/skill-test/prompts.mjs';
import { mapState } from '../scripts/skill-test/vocab-checks.mjs';
import { main, parseArgs } from '../scripts/skill-test/run.mjs';
import { SKILLS } from '../scripts/skill-test/slices.mjs';

vi.setConfig({ testTimeout: 60_000 });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

type Key = keyof typeof FIXTURES;

function build(key: Key) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'areas-test-'));
  dirs.push(base);
  const root = path.join(base, 'project');
  FIXTURES[key](root);
  return { root, ctx: { before: snapshotSources(root), beforeState: mapState(root), beforeTree: hasAreasFile(root) ? parseTree(root) : null, report: '', reader: true } };
}

function moveDown(scratch: string, sub: string) {
  const parking = `${scratch}-parked`;
  fs.renameSync(scratch, parking);
  fs.mkdirSync(path.join(scratch, path.dirname(sub)), { recursive: true });
  fs.renameSync(parking, path.join(scratch, sub));
}

function agent(root: string, prompt: string, scenario = 'good') {
  const out: string[] = [];
  const code = runFakeAgent(['-p', prompt], { scenario }, root, (line: string) => out.push(line));
  expect(JSON.parse(out[0]).subtype, out[0]).toBe('success');
  expect(code).toBe(0);
}

function run(key: Key, prompt: string, scenario = 'good') {
  const built = build(key);
  agent(built.root, prompt, scenario);
  return built;
}

const fingerprint = (root: string) => {
  const hash = crypto.createHash('sha256');
  const walk = (dir: string) =>
    fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else hash.update(`${path.relative(root, file)}\n`).update(fs.readFileSync(file));
    });
  walk(root);
  return hash.digest('hex');
};

const replaceIn = (file: string, from: string, to: string) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to));
const mapFile = (root: string, rel: string) => path.join(root, '.lantern', 'map', rel);

describe('the five fixtures', () => {
  it('are byte for byte the same on every build', () => {
    for (const key of Object.keys(FIXTURES) as Key[]) expect(fingerprint(build(key).root), key).toBe(fingerprint(build(key).root));
  });

  it('are named like their project and neutral of any real name', () => {
    for (const key of Object.keys(FIXTURES) as Key[]) {
      const { root } = build(key);
      expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name).toBe(PROJECT_NAMES[key]);
    }
  });

  it('are settled maps with the sizes the loop cares about', () => {
    const sizes = Object.fromEntries((Object.keys(FIXTURES) as Key[]).map((key) => [key, mapState(build(key).root).size]));
    for (const key of ['good', 'trap', 'retag', 'overflow']) expect(sizes[key], key).toBeGreaterThan(120);
    expect(sizes.small).toBeLessThanOrEqual(120);
    for (const key of ['good', 'trap', 'small', 'retag'] as Key[]) expect(validateSettled(build(key).root).status, key).toBe(0);
    expect(SHOP.features).toHaveLength(13);
    expect(STUDIO.features).toHaveLength(12);
  });

  it('start with no .lantern/areas, except the overflow project that starts with a full seven-area tree', () => {
    for (const key of ['good', 'trap', 'small', 'retag'] as Key[]) expect(hasAreasFile(build(key).root), key).toBe(false);
    const overflow = build('overflow');
    expect(Object.keys(overflow.ctx.beforeTree!)).toHaveLength(7);
    expect(areasCheck(overflow.root).status).toBe(0);
    expect(validateSettled(overflow.root).status).toBe(1);
  });

  it('keep the feature texts in lang/en/features.json', () => {
    const { root } = build('good');
    const texts = JSON.parse(fs.readFileSync(path.join(root, '.lantern', 'lang', 'en', 'features.json'), 'utf8')).text;
    expect(Object.keys(texts)).toHaveLength(13);
    expect(texts['sign-in']).toContain('sign in');
  });

  it('give the trap project coupling that crosses product functions', () => {
    const { root } = build('trap');
    const propose = spawnSync(process.execPath, [path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'areas.mjs'), root, 'propose', '--json'], { encoding: 'utf8' });
    const best = [...JSON.parse(propose.stdout).candidates].sort((a, b) => b.insideShare - a.insideShare)[0];
    const fnOf = (id: string) => SHOP.features.find((f: { id: string }) => f.id === id)!.fn;
    for (const group of best.groupsList) expect(new Set(group.features.map(fnOf)).size, group.features.join()).toBeGreaterThan(1);
  });
});

describe('the stand-in reader', () => {
  it('reads a packet and answers the area whose purpose shares the most words, or says it is unsure', () => {
    const packet = ['Areas:', '- product-browsing: Finding and browsing the product catalogue', '- order-handling: Placing orders', '', 'Feature:', 'Shoppers browse the product catalogue.', '', 'Which area?', ''].join('\n');
    expect(parsePacket(packet).areas.map((a: { id: string }) => a.id)).toEqual(['product-browsing', 'order-handling']);
    expect(standInAnswer(packet)).toBe('product-browsing');
    expect(standInAnswer(packet.replace('Shoppers browse the product catalogue.', 'Nothing alike.'))).toBe(NO_ANSWER);
  });

  it('places every feature of each right tree and fewer than the bar of the misleading one', () => {
    for (const [key, tree, purposes] of [['good', SHOP.tree, SHOP.purposes], ['retag', STUDIO.tree, STUDIO.purposes], ['trap', SHOP.decoyTree, SHOP.decoyPurposes]] as const) {
      const { root } = build(key);
      writeTree(root, tree, purposes);
      const out = path.join(path.dirname(root), 'packets');
      writePacketsFor(root, out);
      const answers = standInAnswers(out);
      const right = Object.entries(answers).filter(([id, area]) => (tree as Record<string, string[]>)[area as string]?.includes(id)).length;
      if (key === 'trap') expect(right / Object.keys(answers).length).toBeLessThan(0.75);
      else expect(right).toBe(Object.keys(answers).length);
    }
  });
});

describe('the good and trap judges', () => {
  it('pass the right tree in offline mode and in live mode, from the files the agent left', () => {
    for (const key of ['good', 'trap'] as Key[]) {
      const { root, ctx } = run(key, LANTERN_AREAS_SETUP_PROMPT);
      expect(judgeTreeOrFlat(root, ctx), key).toMatchObject({ ok: true });
      expect(judgeTreeOrFlat(root, { ...ctx, reader: false }), key).toMatchObject({ ok: true });
    }
  });

  it('are red before the agent runs, naming the missing tree', () => {
    for (const key of ['good', 'trap'] as Key[]) {
      const { root, ctx } = build(key);
      const verdict = judgeTreeOrFlat(root, ctx);
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toContain('no .lantern/areas');
    }
  });

  it('fail a layered tree on the areas rules', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT, 'broken');
    const verdict = judgeTreeOrFlat(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/--strict exit 1.*frontend/);
  });

  it('fail the misleading tree that passes check, on the blind lookup, with the features the reader placed elsewhere', () => {
    const { root, ctx } = run('trap', LANTERN_AREAS_SETUP_PROMPT, 'broken');
    expect(areasCheck(root).status).toBe(0);
    for (const reader of [true, false]) {
      const verdict = judgeTreeOrFlat(root, { ...ctx, reader });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toContain('blind lookup');
      expect(verdict.reason).toContain('revise ');
    }
  });

  it('accept the flat view only when the report says so', () => {
    const { root, ctx } = build('trap');
    expect(judgeTreeOrFlat(root, { ...ctx, report: 'The areas loop failed within its 3 rounds; keeping the flat view.' })).toMatchObject({ ok: true });
    expect(judgeTreeOrFlat(root, { ...ctx, report: 'Done.' }).ok).toBe(false);
  });

  it('fail a tree whose lookup was never run, or ran on an earlier tree', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT);
    fs.rmSync(path.join(root, SCRATCH_DIR), { recursive: true });
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).reason).toContain('the blind lookup was not run');
    agent(root, LANTERN_AREAS_SETUP_PROMPT);
    fs.rmSync(path.join(root, ANSWERS_FILE));
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).reason).toContain('answers were not kept');
    agent(root, LANTERN_AREAS_SETUP_PROMPT);
    replaceIn(path.join(root, '.lantern', 'lang', 'en', 'areas.json'), 'Finding and browsing the product catalogue', 'Looking through the product catalogue');
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).reason).toContain('ran on an earlier one');
  });

  it('find the packets and answers in a subdirectory of the scratch directory, and still judge them', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT);
    const scratch = path.join(root, SCRATCH_DIR);
    moveDown(scratch, 'packets');
    expect(fs.existsSync(path.join(scratch, 'manifest.json'))).toBe(false);
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false })).toMatchObject({ ok: true });
  });

  it('fail packets in a subdirectory that differ from the final tree, or that have no answers', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT);
    const scratch = path.join(root, SCRATCH_DIR);
    moveDown(scratch, 'packets/deep');
    const first = fs.readdirSync(path.join(scratch, 'packets', 'deep')).find((f) => f.endsWith('.txt')) as string;
    fs.rmSync(path.join(scratch, 'packets', 'deep', 'answers.json'));
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).reason).toContain('answers were not kept');
    fs.appendFileSync(path.join(scratch, 'packets', 'deep', first), 'edited\n');
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).reason).toContain('ran on an earlier one');
    fs.rmSync(path.join(scratch, 'packets'), { recursive: true });
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).reason).toContain('the blind lookup was not run');
  });

  it('take answers only from the directory of the manifest, never from another answers.json under the scratch directory', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT);
    const scratch = path.join(root, SCRATCH_DIR);
    moveDown(scratch, 'packets');
    const stray = path.join(scratch, 'elsewhere');
    fs.mkdirSync(stray);
    fs.renameSync(path.join(scratch, 'packets', 'answers.json'), path.join(stray, 'answers.json'));
    const verdict = judgeTreeOrFlat(root, { ...ctx, reader: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('no answers.json beside');
  });

  it('fail answers that score below the bar even when the packets are fresh', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT);
    const answers = JSON.parse(fs.readFileSync(path.join(root, ANSWERS_FILE), 'utf8'));
    for (const id of Object.keys(answers)) answers[id] = 'public-site';
    fs.writeFileSync(path.join(root, ANSWERS_FILE), JSON.stringify(answers));
    const verdict = lookupEvidence(root, { reader: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('LOOKUP FAIL');
    expect(judgeTreeOrFlat(root, { ...ctx, reader: false }).ok).toBe(false);
  });

  it('fail an edited source file, a changed record line and a retagged feature, naming them', () => {
    const { root, ctx } = run('good', LANTERN_AREAS_SETUP_PROMPT);
    fs.appendFileSync(path.join(root, 'api', 'sign-in', 'part-01.mjs'), '// edit\n');
    expect(judgeTreeOrFlat(root, ctx).reason).toContain('source files changed: api/sign-in/part-01.mjs');
    fs.writeFileSync(path.join(root, 'api', 'sign-in', 'part-01.mjs'), fs.readFileSync(path.join(root, 'api', 'sign-in', 'part-01.mjs'), 'utf8').replace('// edit\n', ''));
    replaceIn(mapFile(root, 'api/refunds.lantern'), 'api/refunds/part-01.mjs . route', 'api/refunds/part-01.mjs . handler');
    expect(judgeTreeOrFlat(root, ctx).reason).toContain('api/refunds/part-01.mjs: record line changed');
    replaceIn(mapFile(root, 'api/refunds.lantern'), 'api/refunds/part-01.mjs . handler', 'api/refunds/part-01.mjs . route');
    replaceIn(mapFile(root, 'api/refunds.lantern'), '#feature refunds', '#feature sign-in');
    expect(judgeTreeOrFlat(root, ctx).reason).toContain('feature tags changed');
  });

  it('fail an areas text left behind without a tree', () => {
    const { root, ctx } = build('good');
    writeTree(root, SHOP.tree, SHOP.purposes);
    fs.rmSync(path.join(root, '.lantern', 'areas'));
    expect(judgeTreeOrFlat(root, { ...ctx, report: 'flat view kept' }).reason).toContain('areas.json was left');
  });
});

describe('the small judge', () => {
  it('passes a project where nothing was written and fails any tree', () => {
    const { root, ctx } = run('small', LANTERN_AREAS_SETUP_PROMPT);
    expect(judgeSmall(root, ctx)).toMatchObject({ ok: true });
    const bad = run('small', LANTERN_AREAS_SETUP_PROMPT, 'broken');
    expect(judgeSmall(bad.root, bad.ctx)).toMatchObject({ ok: false });
    expect(judgeSmall(bad.root, bad.ctx).reason).toContain('too small');
  });

  it('fails when only the areas text was written, or a record changed', () => {
    const { root, ctx } = build('small');
    fs.writeFileSync(path.join(root, '.lantern', 'lang', 'en', 'areas.json'), '{"text":{}}\n');
    expect(judgeSmall(root, ctx).reason).toContain('too small');
    fs.rmSync(path.join(root, '.lantern', 'lang', 'en', 'areas.json'));
    replaceIn(mapFile(root, 'api/product-listing.lantern'), 'api/product-listing/part-01.mjs . route', 'api/product-listing/part-01.mjs . handler');
    expect(judgeSmall(root, ctx).reason).toContain('record line changed');
  });
});

describe('the retag judge', () => {
  it('passes a valid tree on an old map with the records kept and retag done', () => {
    const { root, ctx } = run('retag', LANTERN_AREAS_RETAG_PROMPT);
    expect(judgeRetagTree(root, ctx)).toMatchObject({ ok: true });
    expect(judgeRetagTree(root, { ...ctx, reader: false })).toMatchObject({ ok: true });
  });

  it('is red on the untouched map, and fails a layered tree', () => {
    const fresh = build('retag');
    expect(judgeRetagTree(fresh.root, fresh.ctx).ok).toBe(false);
    const bad = run('retag', LANTERN_AREAS_RETAG_PROMPT, 'broken');
    expect(judgeRetagTree(bad.root, bad.ctx).reason).toMatch(/--strict exit 1.*frontend/);
  });

  it('allows a feature line to change but not a record line', () => {
    const { root, ctx } = run('retag', LANTERN_AREAS_RETAG_PROMPT);
    replaceIn(mapFile(root, 'server/seat-booking.lantern'), '#feature seat-booking', '#feature waiting-list');
    expect(judgeRetagTree(root, ctx).reason ?? '').not.toContain('feature tags changed');
    replaceIn(mapFile(root, 'server/seat-booking.lantern'), 'server/seat-booking/part-01.mjs . route', 'server/seat-booking/part-01.mjs . handler');
    expect(judgeRetagTree(root, ctx).reason).toContain('record line changed');
  });
});

describe('the overflow judge', () => {
  it('is red before the agent runs: the new feature has files and no record', () => {
    const { root, ctx } = build('overflow');
    const verdict = judgeOverflow(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('unmapped: api/staff-rota/part-01.mjs');
  });

  it('passes a rebuilt tree that passes strict check and the lookup, in both modes', () => {
    const { root, ctx } = run('overflow', LANTERN_AREAS_DELEGATE_PROMPT);
    expect(areasCheck(root).status).toBe(0);
    for (const reader of [true, false]) expect(judgeOverflow(root, { ...ctx, reader }), String(reader)).toMatchObject({ ok: true });
  });

  it('fails a rebuilt tree whose lookup was never run', () => {
    const { root, ctx } = run('overflow', LANTERN_AREAS_DELEGATE_PROMPT);
    fs.rmSync(path.join(root, SCRATCH_DIR), { recursive: true });
    expect(judgeOverflow(root, { ...ctx, reader: false }).reason).toContain('blind lookup');
  });

  it('passes the feature under "To assign" with the old tree intact, and fails it when the tree changed', () => {
    const { root, ctx } = build('overflow');
    mapNewFeature(root);
    expect(areasCheck(root).status).toBe(1);
    expect(judgeOverflow(root, ctx)).toMatchObject({ ok: true });
    expect(judgeOverflow(root, ctx).reason).toContain('To assign');
    const tree = parseTree(root);
    tree['product-browsing'] = ['product-listing'];
    tree['cart-checkout'].push('product-search');
    writeTree(root, tree, SHOP.sevenPurposes);
    expect(judgeOverflow(root, ctx).reason).toContain('old tree was not left intact');
  });

  it('fails the feature crammed into an existing area of the full tree without a rebuild', () => {
    const { root, ctx } = build('overflow');
    mapNewFeature(root);
    writeTree(root, { ...SHOP.sevenTree, 'customer-accounts': [...SHOP.sevenTree['customer-accounts'], 'staff-rota'] }, SHOP.sevenPurposes);
    expect(judgeOverflow(root, ctx).reason).toContain('with no rebuild');
  });

  it('fails a renamed area that hides the feature crammed into a misfit one, and a merge that leaves it in a misfit area', () => {
    const { root, ctx } = build('overflow');
    mapNewFeature(root);
    const renamed = { ...SHOP.sevenTree, 'customer-accounts': [...SHOP.sevenTree['customer-accounts'], 'staff-rota'] } as Record<string, string[]>;
    renamed['public-pages'] = renamed['public-site'];
    delete renamed['public-site'];
    writeTree(root, renamed, { ...SHOP.sevenPurposes, 'public-pages': SHOP.sevenPurposes['public-site'] });
    for (const reader of [true, false]) {
      if (!reader) {
        const out = path.join(root, SCRATCH_DIR);
        writePacketsFor(root, out);
        fs.writeFileSync(path.join(root, ANSWERS_FILE), JSON.stringify(standInAnswers(out)));
      }
      const verdict = judgeOverflow(root, { ...ctx, reader });
      expect(verdict.ok, String(reader)).toBe(false);
      expect(verdict.reason).toContain('does not fit there');
    }
  });

  it('fails an eighth area, a deleted tree, an unmapped feature and a changed record', () => {
    const eight = run('overflow', LANTERN_AREAS_DELEGATE_PROMPT, 'broken');
    expect(judgeOverflow(eight.root, eight.ctx).reason).toContain('8 areas, at most 7');
    const deleted = run('overflow', LANTERN_AREAS_DELEGATE_PROMPT);
    fs.rmSync(path.join(deleted.root, '.lantern', 'areas'));
    expect(judgeOverflow(deleted.root, deleted.ctx).reason).toContain('areas file was deleted');
    const untagged = run('overflow', LANTERN_AREAS_DELEGATE_PROMPT);
    replaceIn(mapFile(untagged.root, 'api/staff-rota.lantern'), '#feature staff-rota', '#feature sign-in');
    expect(judgeOverflow(untagged.root, untagged.ctx).reason).toContain('was not mapped as a feature');
    const edited = run('overflow', LANTERN_AREAS_DELEGATE_PROMPT);
    replaceIn(mapFile(edited.root, 'api/sign-in.lantern'), 'api/sign-in/part-01.mjs . route', 'api/sign-in/part-01.mjs . handler');
    expect(judgeOverflow(edited.root, edited.ctx).reason).toContain('record line changed');
  });
});

describe('the lantern-areas skill-test entry', () => {
  it('has a $12 default cap, five free fixture slices and five isolated paid slices', () => {
    expect(parseArgs(['lantern-areas'], {})).toMatchObject({ skill: 'lantern-areas', live: false, capUsd: 12 });
    expect(SKILLS['lantern-areas'].slices.map((s: { name: string; paid: boolean }) => `${s.name}:${s.paid}`)).toEqual([
      'good-fixture:false',
      'trap-fixture:false',
      'small-fixture:false',
      'retag-fixture:false',
      'overflow-fixture:false',
      'good-setup:true',
      'trap-setup:true',
      'small-setup:true',
      'retag-run:true',
      'overflow-delegate:true',
    ]);
    expect(SKILLS['lantern-areas'].slices.filter((s: { isolated?: boolean }) => s.isolated)).toHaveLength(5);
  });

  it('keeps the prompts free of the rules: no limits, no gate names, no layer talk', () => {
    for (const prompt of [LANTERN_AREAS_SETUP_PROMPT, LANTERN_AREAS_RETAG_PROMPT, LANTERN_AREAS_DELEGATE_PROMPT]) {
      expect(prompt).not.toMatch(/120|MIN_LOOKUP|check|lookup|propose|cohesion|4 to 6|fan-out|To assign|flat view/i);
    }
  });

  it('reports each broken slice on its own with an areas reason, and passes with the good fake', async () => {
    const lines: string[] = [];
    const log = (...a: unknown[]) => void lines.push(a.join(' '));
    expect(await main(['lantern-areas', '--fake', 'broken'], {}, { log, err: log })).toBe(1);
    const text = lines.join('\n');
    expect(text).toMatch(/FAIL good-setup\s+validate --settled --strict .*frontend/);
    expect(text).toMatch(/FAIL trap-setup\s+the tree passes check but not the blind lookup/);
    expect(text).toMatch(/FAIL small-setup\s+areas were written/);
    expect(text).toMatch(/FAIL retag-run\s+validate --settled --strict .*frontend/);
    expect(text).toMatch(/FAIL overflow-delegate\s+validate --settled exit 1: .*8 areas, at most 7/);
    expect(text).not.toContain('not run');
    lines.length = 0;
    expect(await main(['lantern-areas'], {}, { log, err: log })).toBe(0);
    expect(lines.join('\n')).toContain('RESULT: PASS');
  }, 240_000);
});
