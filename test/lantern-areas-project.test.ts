import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coupledSpec, removeInputs, runAreas, snapshot, writeInput } from './helpers/lantern-areas-gate-fixtures';
import { VALID_TREE } from './helpers/lantern-areas-fixtures';
import { makeVocabProject, removeVocabProjects, snapshotLantern } from './helpers/lantern-vocab-project';

afterEach(() => {
  removeInputs();
  removeVocabProjects();
});

const GOLDEN = path.join(__dirname, 'fixtures', 'lantern-areas', 'propose.golden.txt');
const TREE = VALID_TREE;

function projectWith(tree?: string) {
  return makeVocabProject(coupledSpec(tree));
}

describe('areas.mjs propose', () => {
  it('prints the golden output on the neutral fixture', () => {
    const result = runAreas(['propose', projectWith()]);
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd()).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
  });

  it('prints the same bytes on a rerun and from a separately built copy of the project', () => {
    const root = projectWith();
    expect(runAreas(['propose', root]).stdout).toBe(runAreas(['propose', root]).stdout);
    expect(runAreas(['propose', projectWith()]).stdout).toBe(runAreas(['propose', root]).stdout);
    expect(runAreas(['propose', root, '--json']).stdout).toBe(runAreas(['propose', root, '--json']).stdout);
  });

  it('gives three strongest partners at most, strongest first', () => {
    const { features } = JSON.parse(runAreas(['propose', projectWith(), '--json']).stdout);
    const orders = features.find((f: { id: string }) => f.id === 'orders');
    expect(orders.partners).toEqual([{ id: 'catalog', lines: 8 }, { id: 'payments', lines: 4 }, { id: 'shipping', lines: 2 }]);
    for (const feature of features) expect(feature.partners.length).toBeLessThanOrEqual(3);
  });

  it('leaves core:* blocks out of features, weights and groups', () => {
    const result = runAreas(['propose', projectWith()]);
    expect(result.stdout).toContain('core:service');
    expect(result.stdout).toContain('FEATURES (8; core:* blocks excluded: core:service)');
    const json = JSON.parse(runAreas(['propose', projectWith(), '--json']).stdout);
    expect(JSON.stringify([json.features, json.weights, json.candidates])).not.toContain('core:');
  });

  it('prints raw lines, distinct file pairs and size-normalised weights, and orders by lines', () => {
    const { weights } = JSON.parse(runAreas(['propose', projectWith(), '--json']).stdout);
    expect(weights[0]).toMatchObject({ a: 'catalog', b: 'orders', lines: 8, filePairs: 2 });
    expect(weights[0].perSize).toBeGreaterThan(0);
    expect(weights.map((w: { lines: number }) => w.lines)).toEqual([...weights.map((w: { lines: number }) => w.lines)].sort((x: number, y: number) => y - x));
  });

  it('reports the share of lines each candidate group keeps inside', () => {
    const { candidates } = JSON.parse(runAreas(['propose', projectWith(), '--json']).stdout);
    const four = candidates.find((c: { groups: number }) => c.groups === 4);
    expect(four.groupsList).toHaveLength(4);
    for (const group of four.groupsList) expect(group.keepsInside === null || (group.keepsInside >= 0 && group.keepsInside <= 1)).toBe(true);
    expect(four.groupsList.flatMap((g: { features: string[] }) => g.features).sort()).toEqual(['accounts', 'catalog', 'invoices', 'orders', 'payments', 'reports', 'returns', 'shipping']);
  });

  it('writes nothing under .lantern', () => {
    const root = projectWith();
    const before = snapshotLantern(root);
    runAreas(['propose', root]);
    runAreas(['propose', root, '--json']);
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('runs on a design-style snapshot given with --input', () => {
    const result = runAreas(['propose', '--input', writeInput(snapshot())]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('FEATURES (16; core:* blocks excluded: core:service)');
  });
});

describe('areas.mjs check on a project', () => {
  it('exits 2 with a clear message when .lantern/areas does not exist', () => {
    const result = runAreas(['check', projectWith()]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no .lantern/areas');
    expect(result.stderr).toContain('areas.mjs propose');
  });

  it('exits 2 on a malformed areas file and names the line', () => {
    const result = runAreas(['check', projectWith('order-handling\n\tcatalog\n')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('.lantern/areas is malformed');
    expect(result.stderr).toContain('.lantern/areas:2');
  });

  it('passes a good tree read from the map and exits 0', () => {
    const result = runAreas(['check', projectWith(TREE)]);
    expect(result.out).toContain('PASS, 8 of 8 rules');
    expect(result.status).toBe(0);
  });

  it('fails a layer-named tree read from the map and exits 1', () => {
    const tree = 'screen-backend\n  catalog\n  orders\n  payments\n  invoices\nmisc-other\n  shipping\n  returns\nportal-modules\n  accounts\n  reports\n';
    const result = runAreas(['check', projectWith(tree)]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("screen-backend: 'backend' is a platform, channel or vendor word");
    expect(result.stdout).toContain("misc-other: main word 'misc' is a technical layer or filler");
    expect(result.stdout).toContain("portal-modules: 'portal' is a platform, channel or vendor word");
  });

  it('treats a feature in no area as "To assign" and honours --allow-unassigned', () => {
    const tree = VALID_TREE.replace('  reports\n', '');
    const root = projectWith(tree);
    const strict = runAreas(['check', root]);
    expect(strict.status).toBe(1);
    expect(strict.stdout).toContain('reports is in no area ("To assign")');
    const lenient = runAreas(['check', root, '--allow-unassigned']);
    expect(lenient.status).toBe(0);
    expect(lenient.stdout).toContain('To assign: reports');
  });

  it('reads the purposes from lang/<primary>/areas.json', () => {
    const root = projectWith(TREE);
    fs.writeFileSync(path.join(root, '.lantern', 'lang', 'en', 'areas.json'), `${JSON.stringify({ text: { 'order-handling': 'taking orders' } })}\n`);
    const result = runAreas(['check', root, '--json']);
    expect(result.status).toBe(1);
    const purpose = JSON.parse(result.stdout).rules.find((r: { name: string }) => r.name === 'purpose');
    expect(purpose.reasons).toContain('order-handling: purpose has 2 word(s), allowed 4 to 20');
    expect(purpose.reasons).toContain('money-matters: purpose missing; write one sentence of 4 to 20 words in the areas text file');
  });

  it('exits 2 when areas.json is not valid JSON', () => {
    const root = projectWith(TREE);
    fs.writeFileSync(path.join(root, '.lantern', 'lang', 'en', 'areas.json'), '{ nope');
    expect(runAreas(['check', root]).status).toBe(2);
  });
});
