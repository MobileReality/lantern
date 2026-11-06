import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SETUP = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts');
const SYNC = path.join(__dirname, '..', 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const CLAUDE = { model: 'claude-sonnet-5-5', env: { ...process.env, LANTERN_PROVIDER: '' } };
const CODEX = { model: 'gpt-6.1-sol', env: { ...process.env, LANTERN_PROVIDER: 'codex' } };
const PROVENANCE = /^#model(\s|$)|^\s*"model"\s*:/m;
type Agent = typeof CLAUDE;

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => { fs.rmSync(root, { recursive: true, force: true }); }));

const hashOf = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);

// `modelLines[i]`, when given, is written above record i: the legacy per-record layout.
function repo(names: string[], modelLines: string[] = [], lang: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-shared-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
  const mapFile = path.join(root, '.lantern', 'map', 'src.lantern');
  const langFile = path.join(root, '.lantern', 'lang', 'en', 'src.lantern.json');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.dirname(mapFile), { recursive: true });
  fs.mkdirSync(path.dirname(langFile), { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(root, 'src', `${name}.ts`), `export const ${name} = 1;\n`);
  const records = names.flatMap((n, i) => [...(modelLines[i] ? [modelLines[i]] : []), `src/${n}.ts . util ${hashOf(path.join(root, 'src', `${n}.ts`))}`]);
  fs.writeFileSync(mapFile, ['lantern 1', '# src', '', ...records, ''].join('\n'));
  fs.writeFileSync(langFile, `${JSON.stringify({ ...lang, text: Object.fromEntries(names.map((n) => [`${n}.ts`, `${n.toUpperCase()}.`])) }, null, 1)}\n`);
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'map src');

  const run = (agent: Agent, script: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: agent.env });
  return {
    root,
    git,
    run,
    head: () => git('rev-parse', 'HEAD'),
    recordLines: () => Object.fromEntries(fs.readFileSync(mapFile, 'utf8').split('\n').filter((l) => l.startsWith('src/')).map((l) => [l.split(' ')[0], l])),
    edit: (name: string) => fs.appendFileSync(path.join(root, 'src', `${name}.ts`), '// edit\n'),
    remove: (name: string) => fs.rmSync(path.join(root, 'src', `${name}.ts`)),
    provenance: () => [mapFile, langFile].filter((file) => PROVENANCE.test(fs.readFileSync(file, 'utf8'))),
    finish(agent: Agent, base: string) {
      const result = run(agent, SYNC, 'finish', '--base', base, '--model', agent.model, '--json');
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as { workList: { path: string; hash: string }[]; removal: { removed: string[] } };
    },
    remap(work: { path: string; hash: string }[]) {
      let text = fs.readFileSync(mapFile, 'utf8');
      for (const item of work) text = text.replace(new RegExp(`^${item.path} \\. util \\w+$`, 'm'), `${item.path} . util ${item.hash}`);
      fs.writeFileSync(mapFile, text);
    },
    green(base: string) {
      for (const agent of [CLAUDE, CODEX]) {
        const valid = run(agent, path.join(SETUP, 'validate.mjs'), '.', '--settled');
        expect(valid.status, valid.stdout + valid.stderr).toBe(0);
        expect(run(agent, path.join(SETUP, 'plan.mjs'), '.', 'pending').stdout.trim()).toBe('ALL DONE');
        const verify = run(agent, SYNC, 'verify', '--base', base);
        expect(verify.status, verify.stdout).toBe(0);
      }
    },
  };
}

describe('Claude and Codex alternating on one map file', () => {
  it("re-maps only what changed, never the other agent's records", () => {
    const r = repo(['a', 'b', 'c', 'd']);
    const mappedByClaude = r.head();

    // Codex edits b and deletes c, which sits between records Claude wrote.
    r.edit('b');
    r.remove('c');
    r.git('commit', '-qam', 'codex edits');
    const before = r.recordLines();
    const codex = r.finish(CODEX, mappedByClaude);
    expect(codex.removal.removed).toEqual(['src/c.ts']);
    expect(codex.workList.map((w) => w.path)).toEqual(['src/b.ts']);
    r.remap(codex.workList);
    expect(r.recordLines()['src/a.ts']).toBe(before['src/a.ts']);
    expect(r.recordLines()['src/d.ts']).toBe(before['src/d.ts']);
    expect(r.provenance()).toEqual([]);
    r.green(mappedByClaude);
    r.git('add', '.');
    r.git('commit', '-qm', 'codex re-maps');
    const mappedByCodex = r.head();

    // Claude edits a and deletes d, the last record; Codex's b stays.
    r.edit('a');
    r.remove('d');
    r.git('commit', '-qam', 'claude edits');
    const afterCodex = r.recordLines();
    const claude = r.finish(CLAUDE, mappedByCodex);
    expect(claude.removal.removed).toEqual(['src/d.ts']);
    expect(claude.workList.map((w) => w.path)).toEqual(['src/a.ts']);
    r.remap(claude.workList);
    expect(r.recordLines()['src/b.ts']).toBe(afterCodex['src/b.ts']);
    expect(r.provenance()).toEqual([]);
    r.green(mappedByCodex);

    const refused = r.run(CLAUDE, SYNC, 'finish', '--base', mappedByCodex, '--model', CODEX.model);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/not allowed to write the map on this route/);
  }, 30_000);

  it('keeps a legacy map with several #model lines valid when a record between them is deleted', () => {
    const r = repo(['a', 'b', 'c'], ['#model claude-sonnet-5-5', '#model gpt-6.1-sol', '#model claude-sonnet-5-5'], { model: ['claude-sonnet-5-5', 'gpt-6.1-sol'] });
    const base = r.head();
    const before = r.recordLines();
    r.remove('b');
    r.git('commit', '-qam', 'delete b');
    const result = r.finish(CLAUDE, base);
    expect(result.removal.removed).toEqual(['src/b.ts']);
    expect(result.workList).toEqual([]);
    expect(r.recordLines()).toEqual({ 'src/a.ts': before['src/a.ts'], 'src/c.ts': before['src/c.ts'] });
    r.green(base);
  });

  it('warns on a map stripped by hand and refuses a branch that adds provenance back', () => {
    const r = repo(['a']);
    const base = r.head();
    fs.mkdirSync(path.join(r.root, 'lib'));
    fs.writeFileSync(path.join(r.root, 'lib', 'x.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(r.root, '.lantern', 'map', 'lib.lantern'), `lantern 1\n# lib\n#model claude-sonnet-5-5\n\nlib/x.ts . util ${hashOf(path.join(r.root, 'lib', 'x.ts'))}\n`);
    fs.writeFileSync(path.join(r.root, '.lantern', 'lang', 'en', 'lib.lantern.json'), '{\n "text": {\n  "x.ts": "X."\n }\n}\n');
    r.git('add', '.');
    r.git('commit', '-qm', 'add lib with a #model line');
    expect(r.run(CLAUDE, SYNC, 'status').stdout).toMatch(/warning: map partly migrated: 1 of 2/);
    const verify = r.run(CLAUDE, SYNC, 'verify', '--base', base, '--require-pr');
    expect(verify.status).toBe(1);
    expect(verify.stdout).toMatch(/lib\.lantern: this branch adds a #model line/);
  });

  it('flags a top-level "model" in a lang file, not a feature tag or a note that mentions model', () => {
    const r = repo(['a']);
    const base = r.head();
    const lang = path.join(r.root, '.lantern', 'lang', 'en');
    fs.writeFileSync(path.join(lang, 'features.json'), `${JSON.stringify({ text: { model: 'The model layer.' } }, null, 1)}\n`);
    fs.writeFileSync(path.join(lang, 'note.json'), `${JSON.stringify({ text: { 'a.ts': 'Stores "model": 1.' } }, null, 1)}\n`);
    fs.writeFileSync(path.join(r.root, '.lantern', 'ignore'), '#model is only a comment here\n');
    r.git('add', '.');
    r.git('commit', '-qm', 'feature tag named model');
    expect(r.run(CLAUDE, SYNC, 'verify', '--base', base, '--require-pr').stdout).not.toMatch(/this branch adds a #model line/);

    fs.writeFileSync(path.join(lang, 'extra.lantern.json'), `${JSON.stringify({ model: 'claude-sonnet-5-5', text: {} })}\n`);
    r.git('add', '.');
    r.git('commit', '-qm', 'lang file with a top-level model');
    const verify = r.run(CLAUDE, SYNC, 'verify', '--base', base, '--require-pr');
    expect(verify.stdout).toMatch(/extra\.lantern\.json: this branch adds a #model line or "model" field/);
    expect(verify.stdout).not.toMatch(/(features|note)\.json: this branch adds/);
  });

  it('does not flag a legacy map file that was only renamed', () => {
    const r = repo(['a'], ['#model claude-sonnet-5-5']);
    const base = r.head();
    r.git('mv', '.lantern/map/src.lantern', '.lantern/map/moved.lantern');
    r.git('commit', '-qm', 'rename a legacy map file');
    expect(r.run(CLAUDE, SYNC, 'verify', '--base', base, '--require-pr').stdout).not.toMatch(/this branch adds a #model line/);
  });
});
