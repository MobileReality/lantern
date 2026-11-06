import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAreas } from './helpers/lantern-areas-gate-fixtures';
import { areaSpec } from './helpers/lantern-areas-fixtures';
import { makeVocabProject, removeVocabProjects, snapshotLantern } from './helpers/lantern-vocab-project';

const FEATURES = ['catalog', 'orders', 'payments', 'invoices', 'shipping', 'returns', 'accounts', 'reports', 'search'];
const TREE = [
  'order-handling', '  catalog', '  orders',
  'money-matters', '  payments', '  invoices',
  'parcel-delivery', '  shipping', '  returns',
  'people-and-insight', '  accounts',
  'retired-code', '  reports',
  '',
].join('\n');
const REAL: Record<string, string> = {
  catalog: 'order-handling', orders: 'order-handling', payments: 'money-matters', invoices: 'money-matters',
  shipping: 'parcel-delivery', returns: 'parcel-delivery', accounts: 'people-and-insight', reports: 'retired-code',
};
const dirs: string[] = [];

afterEach(() => {
  removeVocabProjects();
  dirs.splice(0).forEach((d) => { fs.rmSync(d, { recursive: true, force: true }); });
});

const project = () => makeVocabProject(areaSpec(TREE, FEATURES));

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lookup-'));
  dirs.push(dir);
  return dir;
}

function packets(root: string) {
  const out = path.join(tmp(), 'packets');
  const result = runAreas(['lookup', 'packets', root, '--out', out]);
  return { ...result, out, files: fs.existsSync(out) ? fs.readdirSync(out).sort() : [] };
}

function score(root: string, answers: unknown, ...flags: string[]) {
  const file = path.join(tmp(), 'answers.json');
  fs.writeFileSync(file, typeof answers === 'string' ? answers : JSON.stringify(answers));
  const result = runAreas(['lookup', 'score', root, '--answers', file, ...flags]);
  return { ...result, json: flags.includes('--json') && result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null };
}

describe('areas.mjs lookup packets', () => {
  it('writes one packet per placed feature with a text, none for To assign', () => {
    const p = packets(project());
    expect(p.status).toBe(0);
    expect(p.files).toEqual(['accounts.txt', 'catalog.txt', 'invoices.txt', 'manifest.json', 'orders.txt', 'payments.txt', 'reports.txt', 'returns.txt', 'shipping.txt']);
    expect(p.stdout).toContain('no packet for search: in To assign');
    expect(JSON.parse(fs.readFileSync(path.join(p.out, 'manifest.json'), 'utf8'))).toEqual(Object.fromEntries(Object.keys(REAL).sort().map((id) => [`${id}.txt`, id])));
  });

  it('holds every offered area id and purpose, the one feature text and the question, and nothing else', () => {
    const p = packets(project());
    const text = fs.readFileSync(path.join(p.out, 'orders.txt'), 'utf8');
    expect(text).toContain('Which area would you look in for this feature? Answer with exactly one area id from the list and nothing else.');
    expect(text).toContain('- order-handling: what order-handling groups, in one sentence');
    expect(text).toContain('what orders covers');
    expect(text).toContain('- retired-code: what retired-code groups');
  });

  it('leaks no member list, no other feature, no path', () => {
    const p = packets(project());
    for (const file of p.files.filter((f) => f.endsWith('.txt'))) {
      const id = file.replace('.txt', '');
      const text = fs.readFileSync(path.join(p.out, file), 'utf8');
      for (const other of FEATURES.filter((f) => f !== id)) expect(text, `${file} leaks ${other}`).not.toContain(other);
      expect(text).not.toMatch(/service\/|\.ts\b|\.lantern/);
      expect(text).toContain(`what ${id} covers`);
    }
  });

  it('is deterministic and writes nothing under .lantern', () => {
    const root = project();
    const before = snapshotLantern(root);
    const a = packets(root);
    const b = packets(root);
    expect(a.files).toEqual(b.files);
    for (const f of a.files) expect(fs.readFileSync(path.join(a.out, f), 'utf8')).toBe(fs.readFileSync(path.join(b.out, f), 'utf8'));
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('removes only the packets its previous manifest listed, never another file', () => {
    const p = packets(project());
    const manifest = path.join(p.out, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ 'stale.txt': 'gone', '../outside.txt': 'x' }));
    fs.writeFileSync(path.join(p.out, 'stale.txt'), 'old');
    fs.writeFileSync(path.join(p.out, 'notes.txt'), 'mine');
    expect(runAreas(['lookup', 'packets', project(), '--out', p.out]).status).toBe(0);
    expect(fs.readdirSync(p.out)).not.toContain('stale.txt');
    expect(fs.readFileSync(path.join(p.out, 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('exits 2 without --out or without an areas file', () => {
    expect(runAreas(['lookup', 'packets', project()]).status).toBe(2);
    const bare = makeVocabProject({ ...areaSpec(TREE, FEATURES), areas: undefined, areaTexts: undefined });
    expect(runAreas(['lookup', 'packets', bare, '--out', path.join(tmp(), 'y')]).status).toBe(2);
  });
});

describe('areas.mjs lookup score', () => {
  it('passes a correct answer set and prints the chance level', () => {
    const r = score(project(), REAL);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('LOOKUP PASS: 8 of 8');
    expect(r.stdout).toContain('chance is 20%');
  });

  it('fails a shuffled set and lists every misplaced feature', () => {
    const ids = Object.keys(REAL);
    const shuffled = Object.fromEntries(ids.map((id, i) => [id, REAL[ids[(i + 2) % ids.length]]]));
    const r = score(project(), shuffled, '--json');
    expect(r.status).toBe(1);
    expect(r.json.passed).toBe(false);
    const wrong = ids.filter((id) => shuffled[id] !== REAL[id]);
    expect(r.json.misplaced.map((m: { feature: string }) => m.feature).sort()).toEqual(wrong.sort());
  });

  it('passes with one misplaced feature but still lists it as a revision item', () => {
    const root = project();
    const r = score(root, { ...REAL, orders: 'money-matters' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('revise orders: it is in order-handling, the reader chose money-matters');
    expect(JSON.parse(score(root, { ...REAL, orders: 'money-matters' }, '--json').stdout).misplaced).toHaveLength(1);
  });

  it('normalises quotes, backticks, case, spaces and a trailing full stop', () => {
    const messy = { ...REAL, catalog: '  "Order-Handling" ', orders: '`order-handling`', payments: "'MONEY-MATTERS'.", invoices: 'money-matters\n' };
    expect(score(project(), messy).stdout).toContain('LOOKUP PASS: 8 of 8');
  });

  it('exits 2 on a missing answer, a missing file, and malformed files', () => {
    const { catalog: _omitted, ...partial } = REAL;
    const missing = score(project(), partial);
    expect(missing.status).toBe(2);
    expect(missing.stdout).toContain('no answer for catalog');
    expect(runAreas(['lookup', 'score', project(), '--answers', path.join(tmp(), 'nope.json')]).status).toBe(2);
    expect(score(project(), '{not json').status).toBe(2);
    expect(score(project(), ['catalog']).status).toBe(2);
    expect(score(project(), { ...REAL, orders: 3 }).status).toBe(2);
    expect(runAreas(['lookup', 'score', project()]).status).toBe(2);
  });

  it('gives the same output on a rerun', () => {
    const root = project();
    expect(score(root, REAL, '--json').stdout).toBe(score(root, REAL, '--json').stdout);
  });
});
