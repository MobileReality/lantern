import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FixtureFile, FixtureSpec } from './helpers/lantern-vocab-project';
import { makeVocabProject, removeVocabProjects, runScript, snapshotLantern } from './helpers/lantern-vocab-project';

vi.setConfig({ testTimeout: 60_000 });
afterEach(removeVocabProjects);

const retag = (root: string, ...args: string[]) => runScript('retag.mjs', [root, ...args]);
const plan = (root: string, ...args: string[]) => runScript('plan.mjs', [root, 'retag', ...args]);
const validate = (root: string, ...flags: string[]) => runScript('validate.mjs', [root, ...flags]);
const macroEval = (root: string) => runScript('macro-eval.mjs', [root, '--json']);
const FEATURES = ['orders', 'reports'];

interface Group {
  platform: string;
  tagged: number;
  untagged: number;
  untaggedRole?: string;
  plumbingRoles?: string[];
}

function group({ platform, tagged, untagged, untaggedRole = 'service', plumbingRoles = [] }: Group): FixtureFile[] {
  const tags = Array.from({ length: tagged }, (_, i) => ({ path: `${platform}/tagged-${i}.ts`, feature: FEATURES[i % FEATURES.length] }));
  const rest = Array.from({ length: untagged }, (_, i) => ({ path: `${platform}/loose-${i}.ts`, role: untaggedRole, relations: i === 0 ? ['> ext:mailer'] : [] }));
  const plumbing = plumbingRoles.map((role, i) => ({ path: `${platform}/${role}-${i}.ts`, role }));
  return [...tags, ...rest, ...plumbing];
}

const PAIR = ['alpha web alpha/**', 'beta web beta/**'];
const spec = (files: FixtureFile[], platforms: string[] | null = PAIR): FixtureSpec => ({ files, features: FEATURES, platforms: platforms ?? undefined, systems: ['mailer'] });

const siblingGap = () => spec([...group({ platform: 'alpha', tagged: 11, untagged: 1 }), ...group({ platform: 'beta', tagged: 12, untagged: 10, plumbingRoles: ['config', 'entry'] })]);

const loose = (platform: string, count: number) => Array.from({ length: count }, (_, i) => `${platform}/loose-${i}.ts`);

describe('retag lists untagged records of a platform far above its sibling', () => {
  it('flags the platform with its share and the sibling, and lists exactly the qualifying records', () => {
    const root = makeVocabProject(siblingGap());
    const status = plan(root).out;
    expect(status).toMatch(/beta\s+12\/24 untagged \(50%\), 10 to review\s+<- FLAG sibling alpha \(web\) is 8% untagged/);
    expect(status).toContain('roles left out as plumbing');
    expect(status).toMatch(/RETAG TODO/);
    const pending = plan(root, 'pending').out.trim();
    expect(pending).toBe('retag chunk 1: 10 record(s), untagged on beta');
    const lines = plan(root, 'chunk', '1').stdout.trim().split('\n');
    const rows = lines.filter((l) => !l.startsWith('#'));
    expect(rows.map((l) => l.split(' | ')[0]).sort()).toEqual(loose('beta', 10).sort());
    expect(rows).toContain('beta/loose-0.ts | beta | service | purpose of beta/loose-0.ts | > ext:mailer');
    expect(lines.at(-1)).toBe('# features you may use: orders, reports');
    expect(rows.join('\n')).not.toMatch(/config-0|entry-0/);
  });

  it('ends RETAG DONE once every record is tagged or marked plumbing, and validates settled and strict', () => {
    const root = makeVocabProject(siblingGap());
    const paths = loose('beta', 10);
    paths.slice(0, 2).forEach((file) => { expect(retag(root, 'tag-file', file, 'orders').status).toBe(0); });
    expect(plan(root, 'pending').out).toMatch(/retag chunk 1: 8 record\(s\)/);
    paths.slice(2).forEach((file) => { expect(retag(root, 'tag-file', file, '--none').status).toBe(0); });
    expect(plan(root, 'pending').out.trim()).toBe('ALL DONE');
    expect(plan(root).out).toContain('RETAG DONE');
    const checked = validate(root, '--settled', '--strict');
    expect(checked.out).toContain('OK');
    expect(checked.status).toBe(0);
  });

  it('never brings a resolved record back as pending, and a rerun changes nothing', () => {
    const root = makeVocabProject(siblingGap());
    expect(retag(root, 'tag-file', 'beta/loose-3.ts', '--none').status).toBe(0);
    const marked = fs.readFileSync(path.join(root, '.lantern/map/beta.lantern'), 'utf8');
    expect(marked).toMatch(/beta\/loose-3\.ts \. service [0-9a-f]{12}\n#plumbing\n/);
    expect(plan(root, 'chunk', '1').out).not.toContain('beta/loose-3.ts');
    expect(plan(root, 'pending').out).toMatch(/retag chunk 1: 9 record\(s\)/);
    const before = snapshotLantern(root);
    const again = retag(root, 'tag-file', 'beta/loose-3.ts', '--none');
    expect(again.status).toBe(0);
    expect(again.out).toContain('already so');
    expect(snapshotLantern(root)).toEqual(before);
    expect(plan(root).out).toEqual(plan(root).out);
    expect(plan(root, 'pending').out).toMatch(/9 record\(s\)/);
  });

  it('treats the marker as optional for older readers: the record line is untouched and the hash stays', () => {
    const root = makeVocabProject(siblingGap());
    const head = (text: string) => text.split('\n').filter((l) => /^\S+ [.~+-] /.test(l));
    const before = head(fs.readFileSync(path.join(root, '.lantern/map/beta.lantern'), 'utf8'));
    retag(root, 'tag-file', 'beta/loose-1.ts', '--none');
    expect(head(fs.readFileSync(path.join(root, '.lantern/map/beta.lantern'), 'utf8'))).toEqual(before);
  });

  it('swaps a plumbing mark for a feature and a feature for a plumbing mark, keeping one of them', () => {
    const root = makeVocabProject(siblingGap());
    const mapText = () => fs.readFileSync(path.join(root, '.lantern/map/beta.lantern'), 'utf8');
    retag(root, 'tag-file', 'beta/loose-2.ts', '--none');
    retag(root, 'tag-file', 'beta/loose-2.ts', 'reports');
    expect(mapText()).toMatch(/beta\/loose-2\.ts \. service [0-9a-f]{12}\n#feature reports\n/);
    expect(mapText()).not.toMatch(/loose-2[^\n]*\n#plumbing/);
    retag(root, 'tag-file', 'beta/tagged-0.ts', '--none');
    expect(mapText()).toMatch(/beta\/tagged-0\.ts \. service [0-9a-f]{12}\n#plumbing\n/);
    expect(validate(root, '--settled').status).toBe(0);
  });

  it('rejects a record that carries both a feature and a plumbing mark', () => {
    const root = makeVocabProject(siblingGap());
    const file = path.join(root, '.lantern/map/beta.lantern');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(beta\/tagged-0\.ts[^\n]*\n#feature [a-z]+\n)/, '$1#plumbing\n'));
    const checked = validate(root);
    expect(checked.status).toBe(1);
    expect(checked.out).toContain('marked #plumbing and has a #feature');
  });
});

describe('what stays out of retag review', () => {
  it('does not flag an infra-style platform whose untagged records are all plumbing roles', () => {
    const roles = ['config', 'infra', 'script', 'schema', 'style', 'entry', 'migration', 'test'];
    const infra = ['alpha web alpha/**', 'beta web beta/**'];
    const files = [...group({ platform: 'alpha', tagged: 12, untagged: 0 }), ...group({ platform: 'beta', tagged: 1, untagged: 0, plumbingRoles: [...roles, ...roles, ...roles] })];
    const root = makeVocabProject(spec(files, infra));
    expect(plan(root).out).not.toContain('untagged records to review');
    expect(plan(root, 'pending').out.trim()).toBe('ALL DONE');
    expect(plan(root).out).toContain('RETAG DONE');
    expect(JSON.parse(macroEval(root).stdout).checks.find((c: { name: string }) => c.name === 'untagged-share').status).toBe('WARN');
  });

  it('does not flag a gap with fewer than ten reviewable records, nor a small platform', () => {
    const files = [...group({ platform: 'alpha', tagged: 12, untagged: 0 }), ...group({ platform: 'beta', tagged: 6, untagged: 6 })];
    const root = makeVocabProject(spec(files));
    expect(plan(root, 'pending').out.trim()).toBe('ALL DONE');
    const small = makeVocabProject(spec([...group({ platform: 'alpha', tagged: 12, untagged: 0 }), ...group({ platform: 'beta', tagged: 1, untagged: 8 })]));
    expect(plan(small, 'pending').out.trim()).toBe('ALL DONE');
  });
});

describe('a project without a sibling', () => {
  it('flags a single platform only by the share threshold', () => {
    const solo = ['solo web solo/**'];
    const heavy = makeVocabProject(spec(group({ platform: 'solo', tagged: 4, untagged: 8 }), solo));
    expect(plan(heavy).out).toMatch(/solo\s+8\/12 untagged \(67%\), 8 to review\s+<- FLAG share over 60%\n/);
    expect(plan(heavy, 'pending').out.trim()).toBe('retag chunk 1: 8 record(s), untagged on solo');
    const light = makeVocabProject(spec(group({ platform: 'solo', tagged: 7, untagged: 5 }), solo));
    expect(plan(light, 'pending').out.trim()).toBe('ALL DONE');
  });

  it('works with no platforms file at all, and lists the records under the whole project', () => {
    const none = makeVocabProject(spec(group({ platform: 'src', tagged: 2, untagged: 10 }), null));
    expect(plan(none).out).toMatch(/all\s+10\/12 untagged \(83%\)/);
    expect(plan(none, 'chunk', '1').out).toContain('src/loose-0.ts | all | service');
    expect(macroEval(none).status).toBe(0);
    const tidy = makeVocabProject(spec(group({ platform: 'src', tagged: 12, untagged: 0 }), null));
    expect(plan(tidy).out).toContain('RETAG DONE');
  });
});

describe('macro-eval untagged checks', () => {
  const checkOf = (root: string, name: string) => JSON.parse(macroEval(root).stdout).checks.find((c: { name: string }) => c.name === name);

  it('lists every platform over the threshold, not only the worst', () => {
    const root = makeVocabProject(spec([...group({ platform: 'alpha', tagged: 2, untagged: 10 }), ...group({ platform: 'beta', tagged: 4, untagged: 10 })]));
    const check = checkOf(root, 'untagged-share');
    expect(check.status).toBe('WARN');
    expect(check.value).toBe('alpha 83%, beta 71%');
    const clean = makeVocabProject(spec([...group({ platform: 'alpha', tagged: 12, untagged: 0 }), ...group({ platform: 'beta', tagged: 8, untagged: 4 })]));
    expect(checkOf(clean, 'untagged-share')).toMatchObject({ status: 'PASS', value: 'none over' });
  });

  it('warns on a gap between platforms of one kind with the pair and the points, and stays quiet below it', () => {
    const gap = checkOf(makeVocabProject(siblingGap()), 'untagged-divergence');
    expect(gap.status).toBe('WARN');
    expect(gap.value).toBe('beta 50% vs alpha 8% (gap 42 points)');
    const near = checkOf(makeVocabProject(spec([...group({ platform: 'alpha', tagged: 8, untagged: 4 }), ...group({ platform: 'beta', tagged: 7, untagged: 5 })])), 'untagged-divergence');
    expect(near).toMatchObject({ status: 'PASS', value: 'no gap' });
  });

  it('is not judged under ten records on either side, with one platform, or with no platforms file', () => {
    const thin = checkOf(makeVocabProject(spec([...group({ platform: 'alpha', tagged: 12, untagged: 0 }), ...group({ platform: 'beta', tagged: 1, untagged: 5 })])), 'untagged-divergence');
    expect(thin).toMatchObject({ status: 'PASS', value: 'n/a' });
    const solo = checkOf(makeVocabProject(spec(group({ platform: 'solo', tagged: 2, untagged: 10 }), ['solo web solo/**'])), 'untagged-divergence');
    expect(solo.value).toBe('n/a');
    const none = checkOf(makeVocabProject(spec(group({ platform: 'src', tagged: 2, untagged: 10 }), null)), 'untagged-divergence');
    expect(none.value).toBe('n/a');
  });

  it('counts a record marked plumbing as resolved', () => {
    const root = makeVocabProject(spec(group({ platform: 'solo', tagged: 2, untagged: 10 }), ['solo web solo/**']));
    expect(checkOf(root, 'untagged-share').status).toBe('WARN');
    loose('solo', 10).forEach((file) => { retag(root, 'tag-file', file, '--none'); });
    expect(checkOf(root, 'untagged-share').status).toBe('PASS');
    expect(plan(root).out).toContain('RETAG DONE');
  });
});
