import { afterEach, describe, expect, it } from 'vitest';
import { FEATURES, VALID_TREE, areaSpec, numberedFeatures, spreadTree, textsFor } from './helpers/lantern-areas-fixtures';
import { tidySpec } from './helpers/lantern-vocab-fixtures';
import { makeVocabProject, removeVocabProjects, runScript } from './helpers/lantern-vocab-project';

afterEach(removeVocabProjects);

function validate(tree: string, ...flags: string[]) {
  const result = runScript('validate.mjs', [makeVocabProject(areaSpec(tree)), ...flags]);
  const [warned, failed = ''] = result.out.split('FAIL:');
  return { ...result, warned, failed };
}

const without = (id: string) =>
  VALID_TREE.split('\n')
    .filter((line) => line.trim() !== id)
    .join('\n');

describe('validate.mjs [areas] checks', () => {
  it('accepts a valid tree with comments and blank lines, even with --strict', () => {
    const result = validate(VALID_TREE, '--strict', '--settled');
    expect(result.status).toBe(0);
    expect(result.out).not.toContain('[areas]');
    expect(result.out).toContain('areas: OK');
  });

  it('accepts CRLF line endings', () => {
    const result = validate(VALID_TREE.replace(/\n/g, '\r\n'));
    expect(result.status).toBe(0);
    expect(result.out).toContain('areas: OK');
  });

  it('keeps a feature that has records but no area a warning, never an error', () => {
    const result = validate(without('reports'));
    expect(result.status).toBe(0);
    expect(result.warned).toContain('.lantern/features:8: [areas] feature "reports" has records but is in no area');
    expect(result.warned).toContain('add it under an area in .lantern/areas');
  });

  it('makes a feature listed twice an error naming the line and the first area', () => {
    const result = validate(VALID_TREE.replace('  returns', '  returns\n  orders'));
    expect(result.status).toBe(1);
    expect(result.failed).toContain('.lantern/areas:13: [areas] feature "orders" is listed twice (first in area "order-handling" at line 4)');
  });

  it('rejects a leaf that .lantern/features does not declare, listing what is declared', () => {
    const result = validate(VALID_TREE.replace('  reports', '  reportz'));
    expect(result.status).toBe(1);
    expect(result.failed).toContain('.lantern/areas:15: [areas] unknown feature "reportz"');
    expect(result.failed).toContain(`declared: ${FEATURES.join(', ')}`);
  });

  it('rejects a core:* id anywhere', () => {
    const asLeaf = validate(VALID_TREE.replace('  reports', '  reports\n  core:web'));
    expect(asLeaf.status).toBe(1);
    expect(asLeaf.failed).toContain('[areas] "core:web" is a core:* block');
    const asArea = validate(`${VALID_TREE}core:web\n  catalog\n`);
    expect(asArea.status).toBe(1);
    expect(asArea.failed).toContain('[areas] "core:web" is a core:* block');
  });

  it('rejects an area with no children', () => {
    const result = validate(`${VALID_TREE}empty-corner\n`);
    expect(result.status).toBe(1);
    expect(result.failed).toContain('.lantern/areas:16: [areas] area "empty-corner" has no children');
  });

  it('rejects a line nested deeper than two levels', () => {
    const result = validate(VALID_TREE.replace('  catalog', '  catalog\n    deeper-thing'));
    expect(result.status).toBe(1);
    expect(result.failed).toContain('.lantern/areas:4: [areas] "deeper-thing" nests deeper than two levels');
  });

  it('rejects odd indents, tabs and a feature above any area', () => {
    expect(validate(VALID_TREE.replace('  catalog', '   catalog')).failed).toContain('is indented by 3 spaces');
    expect(validate(VALID_TREE.replace('  catalog', '\tcatalog')).failed).toContain('indented with a tab');
    expect(validate(`  catalog\n${VALID_TREE}`).failed).toContain('no area line comes before it');
  });

  it('warns on an area named after a platform, a system or a channel, and fails them with --strict', () => {
    const cases: [string, string][] = [
      ['kiosk-reports', 'contains the platform id "kiosk" as a whole word'],
      ['payment-gateway-tools', 'contains the outside-system id "payment-gateway" as a whole word'],
      ['mobile-ordering', 'contains the channel or layer word "mobile"'],
    ];
    for (const [name, message] of cases) {
      const tree = VALID_TREE.replace('people-and-insight', name);
      const warned = validate(tree);
      expect(warned.status, name).toBe(0);
      expect(warned.warned, name).toContain(`[areas] area "${name}" ${message}`);
      const strict = validate(tree, '--strict');
      expect(strict.status, name).toBe(1);
      expect(strict.failed, name).toContain(`[areas] area "${name}" ${message}`);
    }
  });

  it('matches platform words as whole words only', () => {
    const result = validate(VALID_TREE.replace('people-and-insight', 'kiosks-and-insight'), '--strict');
    expect(result.status).toBe(0);
    expect(result.out).not.toContain('[areas]');
  });

  it('rejects an area equal to a feature, platform or outside-system id', () => {
    for (const [id, kind] of [['orders', 'feature'], ['kiosk', 'platform'], ['mail-relay', 'outside-system']]) {
      const result = validate(VALID_TREE.replace('people-and-insight', id));
      expect(result.status, id).toBe(1);
      expect(result.failed, id).toContain(`area "${id}" is also a ${kind} id`);
    }
  });

  it('rejects a repeated area id and a non-kebab-case one', () => {
    const twice = validate(`${VALID_TREE}order-handling\n  catalog\n`);
    expect(twice.failed).toContain('area "order-handling" is declared twice (first at line 2)');
    expect(validate(VALID_TREE.replace('people-and-insight', 'People_And_Insight')).failed).toContain('must be one lowercase kebab-case id');
  });

  it('warns on a one-word area name', () => {
    const result = validate(VALID_TREE.replace('people-and-insight', 'overview'));
    expect(result.status).toBe(0);
    expect(result.warned).toContain('area "overview" is a single word');
  });

  it('rejects more than 7 areas but allows exactly 7', () => {
    const eight = ['group-alpha', 'group-beta', 'group-gamma', 'group-delta', 'group-epsilon', 'group-zeta', 'group-eta', 'group-theta'];
    const tooMany = validate(spreadTree(FEATURES, eight));
    expect(tooMany.status).toBe(1);
    expect(tooMany.failed).toContain('[areas] 8 areas, at most 7 are allowed');
    const seven = validate(`${spreadTree(FEATURES.slice(0, 6), eight.slice(0, 6))}${eight[6]}\n  ${FEATURES[6]}\n  ${FEATURES[7]}\n`);
    expect(seven.status).toBe(0);
    expect(seven.out).not.toContain('at most 7');
    expect(seven.warned).toContain('7 area(s); 4 to 6 read best');
  });

  it('rejects more than 7 children in an area', () => {
    const result = validate(`everything-here\n${FEATURES.map((f) => `  ${f}`).join('\n')}\n`);
    expect(result.status).toBe(1);
    expect(result.failed).toContain('area "everything-here" has 8 children, at most 7 are allowed');
  });

  it('warns, without failing, on 3 areas and on an area with one child', () => {
    const three = validate(spreadTree(FEATURES, ['group-alpha', 'group-beta', 'group-gamma']));
    expect(three.status).toBe(0);
    expect(three.warned).toContain('3 area(s); 4 to 6 read best');
    const single = validate(`${without('invoices')}money-owed\n  invoices\n`);
    expect(single.status).toBe(0);
    expect(single.warned).toContain('area "money-owed" has one child');
  });

  it('warns on an area without a primary-language text and on a text key with no area', () => {
    const texts = { ...textsFor(VALID_TREE), 'stale-area': 'no longer exists' };
    delete (texts as Record<string, string>)['money-matters'];
    const root = makeVocabProject(areaSpec(VALID_TREE, FEATURES, { areaTexts: texts }));
    const result = runScript('validate.mjs', [root]);
    expect(result.status).toBe(0);
    expect(result.out).toContain('area "money-matters" has no en text; add one sentence for it to .lantern/lang/en/areas.json');
    expect(result.out).toContain('.lantern/lang/en/areas.json: [areas] orphan key "stale-area"');
  });

  it('counts [areas] findings in the summary', () => {
    const result = validate(`${VALID_TREE}empty-corner\n`);
    expect(result.out).toMatch(/areas: \d+ finding\(s\) \(1 error\(s\), 0 warning\(s\)\)/);
  });
});

describe('without .lantern/areas', () => {
  it('prints nothing about areas', () => {
    const result = runScript('validate.mjs', [makeVocabProject(tidySpec())]);
    expect(result.status).toBe(0);
    expect(result.out).not.toMatch(/areas/i);
  });

  it('ignores a leftover areas.json', () => {
    const root = makeVocabProject({ ...tidySpec(), areaTexts: { 'some-area': 'text' } });
    const result = runScript('validate.mjs', [root]);
    expect(result.status).toBe(0);
    expect(result.out).not.toMatch(/areas|orphan/i);
  });
});

describe('the feature-count warning', () => {
  const warningFor = (count: number, withAreas: boolean) => {
    const features = numberedFeatures(count);
    const tree = spreadTree(features, ['group-alpha', 'group-beta', 'group-gamma', 'group-delta', 'group-epsilon']);
    const spec = areaSpec(tree, features, withAreas ? {} : { areas: undefined, areaTexts: undefined });
    return runScript('validate.mjs', [makeVocabProject(spec)]).out;
  };

  it('stays at about 12 without an areas file', () => {
    expect(warningFor(13, false)).toContain('13 features declared; keep the list under ~12');
  });

  it('rises to about 30 with an areas file', () => {
    expect(warningFor(13, true)).not.toContain('features declared');
    expect(warningFor(31, true)).toContain('31 features declared; keep the list under ~30');
  });
});
