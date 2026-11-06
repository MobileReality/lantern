import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadAreas as loadAppAreas, parseAreas as parseApp } from '../src/main/lantern-areas';
import { LangStore } from '../src/main/lantern-texts';
import { StampedCache } from '../src/main/lantern-cache';
import { VALID_TREE } from './helpers/lantern-areas-fixtures';

const SKILL_SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts');

let parseSkill: (text: string) => ReturnType<typeof parseApp>;
let loadSkill: (root: string) => { exists: boolean; areas: ReturnType<typeof parseApp>['areas'] };

beforeAll(async () => {
  const mod = await import(pathToFileURL(path.join(SKILL_SCRIPTS, 'areas-file.mjs')).href);
  parseSkill = mod.parseAreas;
  loadSkill = mod.loadAreas;
});

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => { fs.rmSync(root, { recursive: true, force: true }); }));

const CASES: [string, string][] = [
  ['a valid tree with comments and blanks', VALID_TREE],
  ['CRLF', VALID_TREE.replace(/\n/g, '\r\n')],
  ['empty file', ''],
  ['only comments', '# nothing yet\n\n'],
  ['depth 3', 'area-one\n  a-feature\n    too-deep\n'],
  ['odd indent', 'area-one\n sub-one\n   sub-two\n'],
  ['tab indent', 'area-one\n\tsub-one\n'],
  ['core id as leaf and area', 'area-one\n  core:web\ncore:api\n  thing\n'],
  ['bad ids', 'Area_One\n  Some Thing\n  ok-feature\n'],
  ['leaf before any area', '  lonely\narea-one\n  a-feature\n'],
  ['empty area', 'area-one\narea-two\n  a-feature\n'],
  ['indented comment and no trailing newline', 'area-one\n  # note\n  a-feature'],
];

describe('the skill parser and the app reader agree', () => {
  it.each(CASES)('on %s', (_name, text) => {
    expect(parseApp(text)).toEqual(parseSkill(text));
  });

  it('on a real file: same areas, same children, same order', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-areas-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, '.lantern', 'lang', 'en'), { recursive: true });
    fs.writeFileSync(path.join(root, '.lantern', 'areas'), VALID_TREE);
    fs.writeFileSync(path.join(root, '.lantern', 'lang', 'en', 'areas.json'), JSON.stringify({ text: { 'order-handling': 'taking and tracking orders' } }));
    const store = await LangStore.open(root, undefined, new StampedCache());
    const app = await loadAppAreas(root, store, []);
    const skill = loadSkill(root);
    expect(app?.map((a) => ({ id: a.id, features: a.features }))).toEqual(skill.areas.map((a) => ({ id: a.id, features: a.children.map((c) => c.id) })));
    expect(app?.[0].description).toBe('taking and tracking orders');
    expect(app?.[1].description).toBe('');
  });

  it('a missing file means no areas in both, with no warnings', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-areas-'));
    roots.push(root);
    const warnings: string[] = [];
    const store = await LangStore.open(root, undefined, new StampedCache());
    expect(await loadAppAreas(root, store, warnings)).toBeNull();
    expect(warnings).toEqual([]);
    expect(loadSkill(root).exists).toBe(false);
  });
});
