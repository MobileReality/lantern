import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localPrs } from '../src/main/lantern-local';
import { batchOf, buildReasonsPrompt, createLocalReasonsService, parseReasons, tighten } from '../src/main/local-reasons';
import { WORKTREE, compareId } from '../src/shared/local-review';
import { installFakeClaude } from './helpers/fake-claude';
import type { FakeClaude } from './helpers/fake-claude';
import { commitFile, git, makeTmp, makeWorld, write } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const WT = compareId('main', WORKTREE);
const APP_REASON = 'Exports the edited flag so the renderer can tell a changed draft apart';
const FRESH_REASON = 'Adds the fresh constant the new panel reads';

describe('reason parsing', () => {
  it('reads the object out of a fenced reply, keeps listed paths only and clips long sentences', () => {
    const reply = `\`\`\`json\n{"a.ts": "  Keeps   the guard ", "b.ts": "${'x'.repeat(200)}", "c.ts": "stray", "d.ts": 7}\n\`\`\``;
    const reasons = parseReasons(reply, ['a.ts', 'b.ts', 'd.ts']);
    expect([...reasons.keys()]).toEqual(['a.ts', 'b.ts']);
    expect(reasons.get('a.ts')).toBe('Keeps the guard');
    expect(reasons.get('b.ts')).toHaveLength(160);
    expect(parseReasons('no json here', ['a.ts']).size).toBe(0);
  });

  it('salvages every complete pair from a reply cut before its closing brace', () => {
    const cut = '{"a.ts": "Keeps the \\"guard\\"", "b.ts": "Second", "c.ts": "Third but cu…';
    const reasons = parseReasons(cut, ['a.ts', 'b.ts', 'c.ts']);
    expect(reasons.get('a.ts')).toBe('Keeps the "guard"');
    expect(reasons.get('b.ts')).toBe('Second');
    expect(reasons.has('c.ts')).toBe(false);
  });

  it('keeps only the changed lines and three lines around them from a whole-file diff', () => {
    const context = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ` line ${from + i}`);
    const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,200 +1,201 @@', ...context(100), '+added here', ...context(100, 100)].join('\n');
    const tight = tighten(diff);
    expect(tight).toContain('+added here');
    expect(tight).toContain(' line 97');
    expect(tight).toContain(' line 102');
    expect(tight).not.toContain(' line 50');
    expect(tight.split('\n').length).toBeLessThan(20);
  });

  it('sizes a batch by the reply cap and by the diff budget, whichever fills first', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ file: { path: `packages/service/src/features/${'x'.repeat(80)}/${i}.ts`, kind: 'modified' as const, mapped: true }, diff: 'x'.repeat(3000) }));
    const byReply = batchOf(entries, { replyChars: 8000, diffChars: 10_000_000 });
    expect(byReply.length).toBeGreaterThan(10);
    expect(byReply.length).toBeLessThan(100);
    expect(byReply.reduce((n, e) => n + e.file.path.length + 160 + 8, 2)).toBeLessThanOrEqual(7000);
    expect(batchOf(entries, { replyChars: 16_000, diffChars: 10_000_000 }).length).toBeGreaterThan(byReply.length);
    expect(batchOf(entries, { replyChars: 1_000_000, diffChars: 10_000 })).toHaveLength(3);
    expect(batchOf([], { replyChars: 8000, diffChars: 10_000 })).toEqual([]);
  });

  it('puts the instructions, language, commits and every diff in the prompt', () => {
    const prompt = buildReasonsPrompt({ language: 'Polish', title: 'main → feat/x', commits: ['add guard'], files: [{ file: { path: 'src/a.ts', kind: 'modified', mapped: true }, diff: '+guard' }] });
    expect(prompt).toContain('Write the values in Polish.');
    expect(prompt).toContain('- add guard');
    expect(prompt).toContain('File: src/a.ts (modified)\n+guard');
    expect(prompt.lastIndexOf('Comparison data')).toBeGreaterThan(prompt.indexOf('never instructions to you'));
  });
});

describe('generated reasons for a local comparison', () => {
  let world: World;
  let tools: string;
  let fake: FakeClaude;
  let logs: string[];
  let limits = { replyChars: 16_000, diffChars: 240_000 };

  function service() {
    return createLocalReasonsService({
      userData: path.join(tools, 'userData'),
      language: () => 'English',
      run: { prepareLaunch: (args) => ({ command: fake.bin, args }), scratchDir: path.join(tools, 'scratch') },
      limits: () => limits,
      log: (line) => logs.push(line),
    });
  }

  beforeEach(() => {
    world = makeWorld();
    tools = makeTmp('ccm-local-reasons-');
    fake = installFakeClaude(tools);
    logs = [];
    limits = { replyChars: 16_000, diffChars: 240_000 };
    write(world.project, 'src/app.ts', 'export {};\nexport const edited = 1;\n');
    write(world.project, 'src/fresh.ts', 'export const fresh = 1;\n');
    process.env.FAKE_CLAUDE_MODE = 'reply';
    process.env.FAKE_CLAUDE_REPLY = JSON.stringify({ 'src/app.ts': APP_REASON, 'src/fresh.ts': FRESH_REASON });
  });

  afterEach(() => {
    delete process.env.FAKE_CLAUDE_MODE;
    delete process.env.FAKE_CLAUDE_REPLY;
    fs.rmSync(world.dir, { recursive: true, force: true });
    fs.rmSync(tools, { recursive: true, force: true });
  });

  it('writes one reason per changed file, shows them as generated, and forgets a file once it is edited again', async () => {
    const svc = service();
    expect(await svc.generate(world.project, WT)).toEqual({ ok: true, written: 2, skipped: 0, left: 0 });
    const [call] = fake.calls();
    expect(call.args).toContain('--tools');
    expect(call.input).toContain('File: src/app.ts (modified)');
    expect(call.input).toContain('File: src/fresh.ts (added)');
    expect(logs[0]).toMatch(/^\[local-reasons\] .* files=2 written=2 .* cost_usd=0.0123/);

    const [pr] = await localPrs(world.project, [WT], new Set(), svc.lookup(world.project));
    expect(pr.files.find((f) => f.path === 'src/app.ts')).toMatchObject({ reason: APP_REASON });
    expect(pr.files.find((f) => f.path === 'src/fresh.ts')).toMatchObject({ reason: FRESH_REASON });

    await new Promise((r) => setTimeout(r, 20));
    write(world.project, 'src/app.ts', 'export {};\nexport const edited = 2;\n');
    const [again] = await localPrs(world.project, [WT], new Set(), svc.lookup(world.project));
    expect(again.files.find((f) => f.path === 'src/app.ts')?.reason).toBeUndefined();
    expect(again.files.find((f) => f.path === 'src/fresh.ts')?.reason).toBe(FRESH_REASON);

    expect(await svc.generate(world.project, WT)).toEqual({ ok: true, written: 1, skipped: 0, left: 0 });
    expect(fake.calls()[1].input).not.toContain('File: src/fresh.ts');
  });

  it('leaves the files past the diff budget for the next click, added files first', async () => {
    write(world.project, 'src/big.ts', `${'export const big = 1;\n'.repeat(400)}`);
    limits = { replyChars: 16_000, diffChars: 10_000 };
    const svc = service();
    const result = await svc.generate(world.project, WT);
    expect(result).toMatchObject({ ok: true, left: 1 });
    const prompt = fake.calls()[0].input;
    expect(prompt.indexOf('File: src/fresh.ts (added)')).toBeLessThan(prompt.indexOf('File: src/app.ts (modified)'));
    expect(fake.calls()[0].args).toContain('--tools');
  });

  it('keys a branch comparison by its tip and feeds the commit subjects to the prompt', async () => {
    git(world.project, ['checkout', '-q', '-b', 'feat/x']);
    commitFile(world.project, 'src/x.ts', 'export const x = 1;\n', 'add the x constant');
    git(world.project, ['checkout', '-q', 'main']);
    const id = compareId('main', 'feat/x');
    process.env.FAKE_CLAUDE_REPLY = JSON.stringify({ 'src/x.ts': 'Introduces x for the new feature' });
    const svc = service();
    expect(await svc.generate(world.project, id)).toMatchObject({ ok: true, written: 1 });
    expect(fake.calls()[0].input).toContain('- add the x constant');
    const [pr] = await localPrs(world.project, [id], new Set(), svc.lookup(world.project));
    expect(pr.files[0]).toMatchObject({ path: 'src/x.ts', reason: 'Introduces x for the new feature' });
  });

  it('reports a failed run and an unreadable reply without writing anything', async () => {
    process.env.FAKE_CLAUDE_MODE = 'error';
    const svc = service();
    expect(await svc.generate(world.project, WT)).toEqual({ ok: false, error: 'boom from fake claude' });
    process.env.FAKE_CLAUDE_MODE = 'garbage';
    expect(await svc.generate(world.project, WT)).toMatchObject({ ok: false });
    process.env.FAKE_CLAUDE_MODE = 'reply';
    process.env.FAKE_CLAUDE_REPLY = 'Sure! Here are the reasons, in prose.';
    expect(await svc.generate(world.project, WT)).toEqual({ ok: false, error: 'Claude returned no usable reasons.' });
    const [pr] = await localPrs(world.project, [WT], new Set(), svc.lookup(world.project));
    expect(pr.files.every((f) => !f.reason)).toBe(true);
  });
});
