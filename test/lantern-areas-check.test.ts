import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BAD_AREAS, BAD_PURPOSES, GOOD_AREAS, PURPOSES, checkInput, failedRules, removeInputs, runAreas, snapshot, withAreas, writeInput } from './helpers/lantern-areas-gate-fixtures';
import { removeVocabProjects } from './helpers/lantern-vocab-project';

afterEach(() => {
  removeInputs();
  removeVocabProjects();
});

const RULES = ['placed-once', 'area-count', 'fan-out', 'cohesion', 'name-words', 'name-shape', 'name-anchor', 'purpose'];

function without(areas: Record<string, string[]>, id: string) {
  return Object.fromEntries(Object.entries(areas).map(([name, ids]) => [name, ids.filter((x) => x !== id)]));
}

function renamedFirst(name: string, purpose = PURPOSES['order-handling']) {
  const rest = Object.entries(GOOD_AREAS).filter(([n]) => n !== 'order-handling');
  return withAreas({ [name]: GOOD_AREAS['order-handling'], ...Object.fromEntries(rest) }, { ...PURPOSES, [name]: purpose });
}

function pairs(areaNames: string[], groups: string[][]) {
  return Object.fromEntries(areaNames.map((name, i) => [name, groups[i]]));
}

const EIGHT = pairs(
  ['order-handling', 'money-matters', 'delivery-and-returns', 'people-and-insight', 'customer-voice', 'stock-planning', 'store-presence', 'loyalty-programs'],
  [['catalog', 'search'], ['orders', 'gift-cards'], ['payments', 'invoices'], ['refunds', 'loyalty'], ['shipping', 'tracking'], ['returns', 'stock'], ['accounts', 'reports'], ['reviews', 'notifications']],
);

describe('areas.mjs check, a grouping by product function', () => {
  it('passes all eight rules and exits 0', () => {
    const result = checkInput(snapshot());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS, 8 of 8 rules (check exits 0)');
  });

  it('prints every rule by name in the text output', () => {
    const { stdout } = checkInput(snapshot());
    for (const rule of RULES) expect(stdout).toContain(`pass  ${rule}:`);
  });

  it('gives the same result as the JSON output', () => {
    const { json } = checkInput(snapshot(), '--json');
    expect(json.pass).toBe(true);
    expect(json.rules.map((r: { name: string }) => r.name)).toEqual(RULES);
    expect(json.toAssign).toEqual([]);
  });

  it('is deterministic: the same input prints the same bytes', () => {
    const file = writeInput(snapshot());
    expect(runAreas(['check', '--input', file]).stdout).toBe(runAreas(['check', '--input', file]).stdout);
  });
});

describe('areas.mjs check, a grouping by technical layer', () => {
  it('fails only name-words, with the seven reasons the design shows, and exits 1', () => {
    const bad = failedRules(withAreas(BAD_AREAS, BAD_PURPOSES));
    expect(bad.status).toBe(1);
    expect(bad.failed).toEqual(['name-words']);
    expect(bad.reasons('name-words')).toEqual([
      "frontend-modules: 'frontend' is a platform, channel or vendor word",
      "frontend-modules: main word 'frontend' is a technical layer or filler",
      "backend-services: 'backend' is a platform, channel or vendor word",
      "backend-services: main word 'backend' is a technical layer or filler",
      "slack-and-teams: 'slack' is a platform, channel or vendor word",
      "slack-and-teams: 'teams' is a platform, channel or vendor word",
      "misc-other: main word 'misc' is a technical layer or filler",
    ]);
  });

  it('prints FAIL in text mode with the offending names and a fix line', () => {
    const { stdout, status } = checkInput(withAreas(BAD_AREAS, BAD_PURPOSES));
    expect(status).toBe(1);
    expect(stdout).toContain('FAIL, 1 of 8 rules (check exits 1)');
    expect(stdout).toContain("- frontend-modules: 'frontend' is a platform, channel or vendor word");
    expect(stdout).toContain('fix: name the product function');
  });

  it('never lets a layer-named tree pass', () => {
    expect(checkInput(withAreas(BAD_AREAS, BAD_PURPOSES)).status).not.toBe(0);
  });
});

describe('areas.mjs check, each rule fails in isolation', () => {
  it('placed-once: a feature in two areas', () => {
    const bad = failedRules(withAreas({ ...GOOD_AREAS, 'customer-voice': ['reviews', 'notifications', 'catalog'] }));
    expect(bad.failed).toEqual(['placed-once']);
    expect(bad.reasons('placed-once')).toEqual(['catalog is in 2 areas (order-handling, customer-voice); keep it in exactly one']);
  });

  it('placed-once: an unknown leaf', () => {
    const bad = failedRules(withAreas({ ...GOOD_AREAS, 'customer-voice': ['reviews', 'notifications', 'ghost'] }));
    expect(bad.failed).toEqual(['placed-once']);
    expect(bad.reasons('placed-once')[0]).toContain('ghost (in customer-voice) is not a feature with records');
  });

  it('area-count: eight areas', () => {
    const bad = failedRules(withAreas(EIGHT, PURPOSES));
    expect(bad.failed).toEqual(['area-count']);
    expect(bad.reasons('area-count')).toEqual(['8 areas, at most 7 are allowed; merge the closest areas']);
  });

  it('area-count: three areas', () => {
    const bad = failedRules(withAreas({ 'order-handling': ['catalog', 'orders', 'gift-cards', 'search', 'payments', 'invoices'], 'delivery-and-returns': ['shipping', 'returns', 'stock', 'tracking', 'refunds'], 'people-and-insight': ['accounts', 'reports', 'reviews', 'notifications', 'loyalty'] }));
    expect(bad.failed).toEqual(['area-count']);
  });

  it('fan-out: an area with eight children', () => {
    const areas = { 'order-handling': ['catalog', 'orders', 'gift-cards', 'search', 'payments', 'invoices', 'refunds', 'loyalty'], 'delivery-and-returns': ['shipping', 'returns', 'stock'], 'people-and-insight': ['accounts', 'reports', 'tracking'], 'customer-voice': ['reviews', 'notifications'] };
    const bad = failedRules(withAreas(areas));
    expect(bad.failed).toEqual(['fan-out']);
    expect(bad.reasons('fan-out')).toEqual(['order-handling has 8 children, allowed 1 to 7; split it into two areas']);
  });

  it('fan-out: three one-child areas', () => {
    const areas = { 'order-handling': ['catalog', 'orders', 'gift-cards', 'search', 'payments', 'invoices', 'refunds'], 'delivery-and-returns': ['shipping', 'returns', 'stock', 'tracking', 'accounts', 'reports'], 'customer-voice': ['reviews'], 'money-matters': ['notifications'], 'people-and-insight': ['loyalty'] };
    const bad = failedRules(withAreas(areas));
    expect(bad.failed).toEqual(['fan-out']);
    expect(bad.reasons('fan-out')).toEqual(['3 single-child areas (customer-voice, money-matters, people-and-insight), at most 2 are allowed; fold one into a related area']);
  });

  it('cohesion: a grouping worse than random, one feature from each coupled cluster per area', () => {
    const areas = pairs(['order-handling', 'money-matters', 'delivery-and-returns', 'people-and-insight'], [
      ['catalog', 'payments', 'shipping', 'accounts'], ['orders', 'invoices', 'returns', 'reports'], ['gift-cards', 'refunds', 'stock', 'reviews'], ['search', 'loyalty', 'tracking', 'notifications'],
    ]);
    const bad = failedRules(withAreas(areas));
    expect(bad.failed).toEqual(['cohesion']);
    expect(bad.reasons('cohesion')[0]).toMatch(/areas split strongly coupled features more than chance \(lift 0\.\d\d, floor 0\.5\)/);
  });

  it('name-words: a platform word', () => {
    const bad = failedRules(renamedFirst('portal-orders'));
    expect(bad.failed).toEqual(['name-words']);
    expect(bad.reasons('name-words')).toEqual(["portal-orders: 'portal' is a platform, channel or vendor word"]);
  });

  it('name-words: a generic main word', () => {
    const bad = failedRules(renamedFirst('general-orders'));
    expect(bad.failed).toEqual(['name-words']);
    expect(bad.reasons('name-words')).toEqual(["general-orders: main word 'general' is a technical layer or filler"]);
  });

  it('name-shape: too long a name', () => {
    const name = 'order-handling-and-checkout-flows';
    const bad = failedRules(renamedFirst(name));
    expect(bad.failed).toEqual(['name-shape']);
    expect(bad.reasons('name-shape')).toEqual([`${name}: 5 word(s), allowed 2 to 4`, `${name}: 33 characters, at most 32`]);
  });

  it('name-shape: a name equal to a feature id', () => {
    const bad = failedRules(renamedFirst('gift-cards', 'taking orders for gift cards and more'));
    expect(bad.failed).toEqual(['name-shape']);
    expect(bad.reasons('name-shape')).toEqual(['gift-cards: equals a feature id; name the product function the features serve']);
  });

  it('name-shape: two names equal once normalised', () => {
    const areas = { 'order-handling': ['catalog', 'orders', 'gift-cards', 'search'], 'handling-order': ['payments', 'invoices', 'refunds', 'loyalty'], 'delivery-and-returns': GOOD_AREAS['delivery-and-returns'], 'people-and-insight': GOOD_AREAS['people-and-insight'], 'customer-voice': GOOD_AREAS['customer-voice'] };
    const bad = failedRules(withAreas(areas, { ...PURPOSES, 'handling-order': 'handling the order of payments and money' }));
    expect(bad.failed).toEqual(['name-shape']);
    expect(bad.reasons('name-shape')).toEqual(['order-handling: same as handling-order once normalised; merge them or rename one', 'handling-order: same as order-handling once normalised; merge them or rename one']);
  });

  it('name-anchor: a name that shares no word with its purpose or members', () => {
    const bad = failedRules(renamedFirst('zebra-crossing'));
    expect(bad.failed).toEqual(['name-anchor']);
    expect(bad.reasons('name-anchor')[0]).toContain('zebra-crossing: shares no word with its purpose or its features');
  });

  it('purpose: missing', () => {
    const { 'order-handling': _dropped, ...rest } = PURPOSES;
    const bad = failedRules(withAreas(GOOD_AREAS, rest));
    expect(bad.failed).toEqual(['purpose']);
    expect(bad.reasons('purpose')[0]).toContain('order-handling: purpose missing');
  });

  it('purpose: too long', () => {
    const long = 'taking orders and following every single one of them through checkout and payment and packing and shipping and delivery and returns and refunds';
    const bad = failedRules(withAreas(GOOD_AREAS, { ...PURPOSES, 'order-handling': long }));
    expect(bad.failed).toEqual(['purpose']);
    expect(bad.reasons('purpose')).toEqual(['order-handling: purpose has 23 word(s), allowed 4 to 20']);
  });

  it('purpose: more than one sentence', () => {
    const bad = failedRules(withAreas(GOOD_AREAS, { ...PURPOSES, 'order-handling': 'taking orders. Following them through checkout.' }));
    expect(bad.failed).toEqual(['purpose']);
    expect(bad.reasons('purpose')).toEqual(['order-handling: purpose is more than one sentence; keep one']);
  });
});

describe('areas.mjs check, no rule judges an area by its share of files', () => {
  it('passes when one area holds almost every file and another almost none', () => {
    const lopsided = snapshot();
    lopsided.blocks = lopsided.blocks.map((b) => ({ ...b, files: b.id === 'catalog' ? 5000 : b.id === 'notifications' ? 1 : 2 }));
    const result = checkInput(lopsided);
    expect(result.status).toBe(0);
  });

  it('keeps file counts out of the gate source', () => {
    const gate = fs.readFileSync(path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'areas-gate.mjs'), 'utf8');
    expect(gate).not.toMatch(/\.files\b|by_platform|by_top_dir|balance|file share/);
  });
});

describe('areas.mjs check, features in no area', () => {
  const withoutCatalog = () => withAreas(without(GOOD_AREAS, 'catalog'));

  it('fails placed-once by default and names the feature under "To assign"', () => {
    const result = checkInput(withoutCatalog());
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('catalog is in no area ("To assign")');
    expect(result.stdout).toContain('To assign: catalog');
  });

  it('accepts it with --allow-unassigned and still lists it', () => {
    const result = checkInput(withoutCatalog(), '--allow-unassigned');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 in "To assign" (allowed)');
    expect(result.stdout).toContain('To assign: catalog');
  });

  it('still fails a duplicate under --allow-unassigned', () => {
    const areas = { ...without(GOOD_AREAS, 'catalog'), 'customer-voice': ['reviews', 'notifications', 'orders'] };
    expect(checkInput(withAreas(areas), '--allow-unassigned').status).toBe(1);
  });
});

describe('areas.mjs check, exit codes for unusable input', () => {
  it('exits 2 on a missing input file', () => {
    const result = runAreas(['check', '--input', '/nonexistent/areas-input.json']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('cannot read');
  });

  it('exits 2 when the input has no groupings', () => {
    const { areas: _areas, ...noAreas } = snapshot();
    const result = checkInput(noAreas);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--input needs');
  });

  it('exits 2 with no command', () => {
    const result = runAreas([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: areas.mjs');
  });
});
