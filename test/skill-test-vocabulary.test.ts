import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMap } from '../skills/lantern-setup/scripts/lib.mjs';
import { runFakeAgent } from '../scripts/skill-test/fake-agent.mjs';
import { snapshotSources, validateSettled } from '../scripts/skill-test/fixtures.mjs';
import { RETAG_PROMPT, SETUP_PROMPT } from '../scripts/skill-test/prompts.mjs';
import { main, parseArgs } from '../scripts/skill-test/run.mjs';
import { SKILLS } from '../scripts/skill-test/slices.mjs';
import { evalTable, judgeClients, judgePlain, judgeRetag, judgeSibling, macroEval, vocabularyOffenders, warnings } from '../scripts/skill-test/vocab-checks.mjs';
import { createClientsProject, createPlainProject, createSiblingProject, createUntidyProject } from '../scripts/skill-test/vocab-fixtures.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(create: (root: string) => void) {
  const root = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vocab-test-')), 'project');
  dirs.push(path.dirname(root));
  create(root);
  return root;
}

function agent(root: string, prompt: string, scenario = 'good') {
  const out: string[] = [];
  const code = runFakeAgent(['-p', prompt], { scenario }, root, (line: string) => out.push(line));
  expect(JSON.parse(out[0]).subtype, out[0]).toBe('success');
  expect(code).toBe(0);
}

function setup(create: (root: string) => void, scenario = 'good', prompt = SETUP_PROMPT) {
  const root = fixture(create);
  const before = snapshotSources(root);
  const beforeEvaluation = macroEval(root);
  const beforeState = new Map(loadMap(root).records.map((r: { path: string }) => [r.path, r]));
  agent(root, prompt, scenario);
  return { root, ctx: { before, beforeEvaluation, beforeState, evaluation: macroEval(root) } };
}

const mapFile = (root: string, rel: string) => path.join(root, '.lantern', 'map', rel);

describe('the three fixtures', () => {
  it('stay small, neutral and unmapped or untidy as designed', () => {
    const clients = fixture(createClientsProject);
    expect(Object.keys(snapshotSources(clients))).toHaveLength(8);
    expect(fs.readFileSync(path.join(clients, '.lantern', 'platforms'), 'utf8')).toContain('browser web clients/browser/**');
    expect(fs.existsSync(path.join(clients, '.lantern', 'map'))).toBe(false);
    const plain = fixture(createPlainProject);
    expect(Object.keys(snapshotSources(plain))).toHaveLength(6);
    expect(fs.existsSync(path.join(plain, '.lantern'))).toBe(false);
    const untidy = fixture(createUntidyProject);
    expect(validateSettled(untidy).status).toBe(0);
    expect(warnings(macroEval(untidy))).toEqual(['feature-collisions', 'system-near-duplicates', 'system-library-like']);
    expect(vocabularyOffenders(macroEval(untidy))).toEqual(expect.arrayContaining(['acmepay', 'dayjs.js', 'mail-relay', 'mail-relay-api']));
  });
});

describe('the clients judge', () => {
  it('passes the good answer and prints a before and after table', () => {
    const { root, ctx } = setup(createClientsProject);
    expect(judgeClients(root, ctx)).toMatchObject({ ok: true });
    const table = evalTable('clients', ctx.beforeEvaluation, ctx.evaluation).join('\n');
    expect(table).toContain('feature-divergence[web]');
    expect(table).toMatch(/warnings: \d+ -> 0/);
  });

  it('fails a feature named after a platform and a relay spelled two ways, naming the ids', () => {
    const { root, ctx } = setup(createClientsProject, 'broken');
    const verdict = judgeClients(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('validate --strict');
    for (const id of ['browser-notes', 'kiosk-notes', 'mail-relay-api']) expect(verdict.reason).toContain(id);
  });

  it('fails one capability that carries different feature ids on the two clients', () => {
    const { root, ctx } = setup(createClientsProject, 'split');
    const verdict = judgeClients(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('different feature ids');
    expect(verdict.reason).toContain('clients/kiosk/save-note.mjs=note-keeping');
  });

  it('fails an edited source file and an edited platforms file', () => {
    const { root, ctx } = setup(createClientsProject);
    fs.appendFileSync(path.join(root, 'shared', 'note.mjs'), '// edit\n');
    expect(judgeClients(root, ctx).reason).toContain('source files changed: shared/note.mjs');
    fs.writeFileSync(path.join(root, 'shared', 'note.mjs'), fs.readFileSync(path.join(root, 'shared', 'note.mjs'), 'utf8').replace('// edit\n', ''));
    fs.appendFileSync(path.join(root, '.lantern', 'platforms'), 'extra other extra/**\n');
    expect(judgeClients(root, ctx).reason).toContain('.lantern/platforms was edited');
  });
});

describe('the plain judge', () => {
  it('passes the good answer and fails an invented outside system with its ids', () => {
    const good = setup(createPlainProject);
    expect(judgePlain(good.root, good.ctx)).toMatchObject({ ok: true });
    expect(warnings(good.ctx.evaluation)).toEqual([]);
    const bad = setup(createPlainProject, 'broken');
    const verdict = judgePlain(bad.root, bad.ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('text-tools-api');
  });

  it('fails a platforms file invented for a single-platform project', () => {
    const { root, ctx } = setup(createPlainProject);
    fs.writeFileSync(path.join(root, '.lantern', 'platforms'), 'lib other src/**\n');
    expect(judgePlain(root, ctx).reason).toContain('.lantern/platforms was invented');
  });
});

describe('the retag judge', () => {
  it('passes a retag that used the scripts: strict clean, records kept, warnings down', () => {
    const { root, ctx } = setup(createUntidyProject, 'good', RETAG_PROMPT);
    const verdict = judgeRetag(root, ctx);
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.reason).toContain('3 -> 0');
    expect(fs.readFileSync(path.join(root, '.lantern', 'systems'), 'utf8')).toContain('acmepay-api');
  });

  it('fails an untouched map with the surviving ids', () => {
    const { root, ctx } = setup(createUntidyProject, 'broken', RETAG_PROMPT);
    const verdict = judgeRetag(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('validate --strict');
    for (const id of ['acmepay', 'dayjs.js']) expect(verdict.reason).toContain(id);
  });

  it('fails a record whose role was changed along the way', () => {
    const { root, ctx } = setup(createUntidyProject, 'good', RETAG_PROMPT);
    const file = mapFile(root, 'src.lantern');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('src/catalog.mjs . service', 'src/catalog.mjs . util'));
    const verdict = judgeRetag(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('src/catalog.mjs: record line changed');
  });

  it('fails a retag that left the duplicate and the library but fixed the feature', () => {
    const { root, ctx } = setup(createUntidyProject, 'broken', RETAG_PROMPT);
    const retag = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'retag.mjs');
    expect(spawnSync(process.execPath, [retag, root, 'retag-feature', 'acmepay', 'payments']).status).toBe(0);
    const verdict = judgeRetag(root, { ...ctx, evaluation: macroEval(root) });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/offending ids: .*dayjs\.js/);
    expect(verdict.reason).not.toContain('acmepay');
  });
});

describe('the sibling judge', () => {
  it('passes the good answer: twins share a feature, the plumbing is marked, nothing else changed', () => {
    const { root, ctx } = setup(createSiblingProject, 'good', RETAG_PROMPT);
    expect(judgeSibling(root, ctx)).toMatchObject({ ok: true });
    expect(warnings(ctx.evaluation).filter((name: string) => name.startsWith('untagged-'))).toEqual([]);
  });

  it('fails an agent that did nothing, naming the plan that is not done', () => {
    const { root, ctx } = setup(createSiblingProject, 'broken', RETAG_PROMPT);
    const verdict = judgeSibling(root, ctx);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('plan.mjs . retag is not done');
  });

  it('fails a record tagged with a feature other than its twin, and one never marked plumbing', () => {
    const { root, ctx } = setup(createSiblingProject, 'good', RETAG_PROMPT);
    const retag = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'retag.mjs');
    expect(spawnSync(process.execPath, [retag, root, 'tag-file', 'counter/wishlist-add.mjs', 'cart']).status).toBe(0);
    const wrongTwin = judgeSibling(root, { ...ctx, evaluation: macroEval(root) });
    expect(wrongTwin.ok).toBe(false);
    expect(wrongTwin.reason).toContain('counter/wishlist-add.mjs=cart');
    expect(spawnSync(process.execPath, [retag, root, 'tag-file', 'counter/tap-log.mjs', 'cart']).status).toBe(0);
    expect(judgeSibling(root, { ...ctx, evaluation: macroEval(root) }).reason).toContain('counter/tap-log.mjs is plumbing but tagged cart');
  });
});

describe('the lantern-vocabulary skill-test entry', () => {
  it('has a $6 default cap, five free fixture slices and nine isolated paid slices', () => {
    expect(parseArgs(['lantern-vocabulary'], {})).toMatchObject({ skill: 'lantern-vocabulary', live: false, capUsd: 6 });
    expect(SKILLS['lantern-vocabulary'].slices.map((s: { name: string; paid: boolean }) => `${s.name}:${s.paid}`)).toEqual([
      'clients-fixture:false',
      'plain-fixture:false',
      'retag-fixture:false',
      'sibling-fixture:false',
      'clients-setup:true',
      'plain-setup:true',
      'sibling-retag-run:true',
      'retag-run:true',
      'areas-fixture:false',
      'areas-setup:true',
      'areas-delegate-places:true',
      'areas-delegate-eighth:true',
      'areas-delegate-loop-fails:true',
      'areas-delegate-merged:true',
    ]);
    expect(SKILLS['lantern-vocabulary'].slices.filter((s: { isolated?: boolean }) => s.isolated)).toHaveLength(9);
  });

  it('reports each broken slice on its own with the vocabulary reason, and prints the tables on a pass', async () => {
    const lines: string[] = [];
    const log = (...a: unknown[]) => void lines.push(a.join(' '));
    expect(await main(['lantern-vocabulary', '--fake', 'broken'], {}, { log, err: log })).toBe(1);
    const text = lines.join('\n');
    expect(text).toMatch(/FAIL clients-setup\s+validate --strict .*browser-notes/);
    expect(text).toMatch(/FAIL plain-setup\s+validate --strict .*text-tools-api/);
    expect(text).toMatch(/FAIL retag-run\s+validate --strict .*acmepay/);
    expect(text).toMatch(/FAIL sibling-retag-run\s+plan.mjs . retag is not done/);
    expect(text).not.toContain('not run');
    lines.length = 0;
    expect(await main(['lantern-vocabulary'], {}, { log, err: log })).toBe(0);
    expect(lines.join('\n')).toMatch(/retag-run macro-eval retag[\s\S]*warnings: 3 -> 0/);
  }, 180_000);

  it('stops at the cap: the first paid slice fails and the others are not run', async () => {
    const lines: string[] = [];
    const log = (...a: unknown[]) => void lines.push(a.join(' '));
    expect(await main(['lantern-vocabulary', '--max-usd', '0.07'], {}, { log, err: log })).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('PASS clients-setup');
    expect(text).toContain('CAP EXCEEDED');
    expect(text).toMatch(/FAIL plain-setup\s+cost cap exceeded/);
  }, 180_000);
});
