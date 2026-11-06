import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrExplainDone, PrExplainSections } from '../src/shared/pr-explain';
import { PR_EXPLAIN_NEW_FILE_BEFORE, explanationPlainText } from '../src/shared/pr-explain';
import { createPrExplainService } from '../src/main/pr-explain';
import { PR_EXPLAIN_INSTRUCTIONS, buildPrExplainPrompt } from '../src/main/pr-explain-prompt';
import { resolveExplanation } from '../src/main/pr-explain-sections';
import { createPrExplainStore, storeFileFor } from '../src/main/pr-explain-store';
import { installFakeClaude } from './helpers/fake-claude';
import type { FakeClaude } from './helpers/fake-claude';
import { branchOff, commitFile, commitRecord, git, makeTmp, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const FULL: PrExplainSections = {
  summary: 'It rejects a negative pid. This keeps kill() safe.',
  before: 'Any number reached kill().',
  after: 'A negative number is refused.',
  example: 'kill(-1) -> refused',
};

describe('the prompt', () => {
  it('asks for a JSON object with the four fixed keys and a Before for a new file', () => {
    for (const key of ['"summary"', '"before"', '"after"', '"example"']) expect(PR_EXPLAIN_INSTRUCTIONS).toContain(key);
    expect(PR_EXPLAIN_INSTRUCTIONS).toContain('For a new file this must say that the file is new; it is never empty');
    expect(PR_EXPLAIN_INSTRUCTIONS).toContain('No section is longer than 3 sentences');
    expect(PR_EXPLAIN_INSTRUCTIONS).toContain('At most 3 lines');
    expect(buildPrExplainPrompt({ language: 'Polish', title: 't', reason: '', path: 'a.ts', kind: 'added', otherPaths: [], content: { kind: 'file', text: 'x' } })).toContain('Write the answer in Polish.');
  });
});

describe('resolveExplanation', () => {
  it('reads a valid JSON reply into four sections and a plain text with headings', () => {
    const out = resolveExplanation(JSON.stringify(FULL), false);
    expect(out.sections).toEqual(FULL);
    expect(out.text).toBe(explanationPlainText(FULL));
    expect(out.text).toContain('What changes\nIt rejects a negative pid.');
    expect(out.text).toContain('Before\nAny number reached kill().');
  });

  it('accepts a reply wrapped in a markdown fence or in prose', () => {
    expect(resolveExplanation(`\`\`\`json\n${JSON.stringify(FULL)}\n\`\`\``, false).sections).toEqual(FULL);
    expect(resolveExplanation(`Here you go: ${JSON.stringify(FULL)} Done.`, false).sections).toEqual(FULL);
  });

  it('falls back to a plain text block when keys are missing, keeping what is there', () => {
    const out = resolveExplanation(JSON.stringify({ summary: 'It guards kill().', after: 'Refuses negatives.' }), false);
    expect(out.sections).toBeUndefined();
    expect(out.text).toBe('What changes\nIt guards kill().\n\nAfter\nRefuses negatives.');
  });

  it('falls back to the reply itself on invalid JSON, never an error', () => {
    const broken = '{"summary": "It guards kill().", "before": "Any';
    expect(resolveExplanation(broken, false)).toEqual({ text: broken });
    const closed = '{"summary": "It guards kill().", "before": }';
    expect(resolveExplanation(closed, false)).toEqual({ text: closed });
    expect(resolveExplanation('It adds a guard. It affects callers.', true)).toEqual({ text: 'It adds a guard. It affects callers.' });
    expect(resolveExplanation('{}', false)).toEqual({ text: '{}' });
    expect(resolveExplanation('[1,2]', false)).toEqual({ text: '[1,2]' });
  });

  it('falls back when the values are not strings', () => {
    const out = resolveExplanation(JSON.stringify({ summary: 1, before: null, after: [], example: {} }), false);
    expect(out.sections).toBeUndefined();
  });

  it('never leaves Before empty for a new file', () => {
    const out = resolveExplanation(JSON.stringify({ ...FULL, before: '  ' }), true);
    expect(out.sections?.before).toBe(PR_EXPLAIN_NEW_FILE_BEFORE);
    expect(out.sections?.before).not.toBe('');
    expect(out.text).toContain(`Before\n${PR_EXPLAIN_NEW_FILE_BEFORE}`);
  });

  it('keeps a Before the agent wrote for a new file', () => {
    expect(resolveExplanation(JSON.stringify({ ...FULL, before: 'This file is new, so nothing ran before.' }), true).sections?.before).toBe('This file is new, so nothing ran before.');
  });

  it('leaves an empty Before out of a changed file instead of inventing one', () => {
    const out = resolveExplanation(JSON.stringify({ ...FULL, before: '' }), false);
    expect(out.sections?.before).toBe('');
    expect(out.text).not.toContain('Before');
  });

  it('caps every section', () => {
    const out = resolveExplanation(JSON.stringify({ ...FULL, summary: 'x'.repeat(5000) }), false);
    expect(out.sections?.summary.length).toBeLessThanOrEqual(700);
  });
});

describe('the store', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp('ccm-pr-explain-sections-');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const HEAD = 'a'.repeat(40);

  it('round-trips the sections under a format version', () => {
    const file = path.join(dir, 's.json');
    createPrExplainStore(file).save('7', 'a.ts', HEAD, explanationPlainText(FULL), FULL);
    expect(createPrExplainStore(file).lookup('7', 'a.ts', HEAD)?.sections).toEqual(FULL);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ version: 1, entries: [{ format: 2 }] });
  });

  it('counts the sections toward the byte bound', () => {
    const file = path.join(dir, 'bound.json');
    const bytes = 2 * (explanationPlainText(FULL).length + 'a.ts'.length + HEAD.length + 1) - 10;
    const store = createPrExplainStore(file, { entries: 10, bytes });
    store.save('7', 'a.ts', HEAD, explanationPlainText(FULL), FULL);
    store.save('8', 'a.ts', HEAD, explanationPlainText(FULL), FULL);
    expect(store.lookup('7', 'a.ts', HEAD)).toBeNull();
    expect(store.lookup('8', 'a.ts', HEAD)).not.toBeNull();
  });

  it('still returns an explanation saved before the change, as one block', () => {
    const file = path.join(dir, 'old.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ pr: '7', path: 'a.ts', head: HEAD, text: 'It adds a guard.', at: 5 }] }));
    const found = createPrExplainStore(file).lookup('7', 'a.ts', HEAD);
    expect(found).toMatchObject({ text: 'It adds a guard.', stale: false });
    expect(found?.sections).toBeUndefined();
  });

  it('drops malformed sections but keeps the text', () => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ pr: '7', path: 'a.ts', head: HEAD, text: 'Kept.', at: 5, format: 2, sections: { summary: 1 } }] }));
    const found = createPrExplainStore(file).lookup('7', 'a.ts', HEAD);
    expect(found?.text).toBe('Kept.');
    expect(found?.sections).toBeUndefined();
  });
});

describe('through the service', () => {
  let world: World;
  let tools: string;
  let userData: string;
  let fake: FakeClaude;

  beforeEach(() => {
    world = makeWorld();
    tools = makeTmp('ccm-pr-explain-svc-');
    userData = path.join(tools, 'userData');
    fake = installFakeClaude(tools);
    branchOff(world.project, 'feat/explain');
    commitFile(world.project, 'src/app.ts', 'export {};\n// guarded\n', 'edit app');
    commitFile(world.project, 'src/fresh.ts', 'export const fresh = 1;\n', 'add fresh');
    const head = git(world.project, ['rev-parse', 'HEAD']);
    commitRecord(world.project, { id: 7, branch: 'feat/explain', head, title: 'Guard', files: ['~ src/app.ts', '+ src/fresh.ts'] });
    git(world.project, ['push', '-q', 'origin', 'feat/explain']);
    git(world.project, ['checkout', '-q', 'main']);
    process.env.FAKE_CLAUDE_MODE = 'reply';
  });

  afterEach(() => {
    delete process.env.FAKE_CLAUDE_MODE;
    delete process.env.FAKE_CLAUDE_REPLY;
    fs.rmSync(world.dir, { recursive: true, force: true });
    fs.rmSync(tools, { recursive: true, force: true });
  });

  async function explain(file: string, reply: string) {
    process.env.FAKE_CLAUDE_REPLY = reply;
    const svc = createPrExplainService({
      projectPaths: () => [world.project],
      userData,
      language: () => 'English',
      run: { prepareLaunch: (args) => ({ command: fake.bin, args }), scratchDir: path.join(tools, 'scratch') },
      log: () => {},
      enabled: true,
    });
    let resolve: (done: PrExplainDone) => void = () => {};
    const done = new Promise<PrExplainDone>((r) => (resolve = r));
    expect(await svc.start({ project: world.project, pr: '7', path: file }, resolve)).toEqual({ ok: true });
    const result = await done;
    if (!result.ok) throw new Error(result.error);
    return result.explanation;
  }

  it('delivers and stores the sections of a valid reply', async () => {
    const got = await explain('src/app.ts', JSON.stringify(FULL));
    expect(got.sections).toEqual(FULL);
    const head = got.head;
    expect(createPrExplainStore(storeFileFor(userData, world.project)).lookup('7', 'src/app.ts', head)?.sections).toEqual(FULL);
  });

  it('says the file is new when the reply leaves Before empty for an added file', async () => {
    const got = await explain('src/fresh.ts', JSON.stringify({ ...FULL, before: '' }));
    expect(got.sections?.before).toBe(PR_EXPLAIN_NEW_FILE_BEFORE);
  });

  it('delivers an unreadable reply as a single text block', async () => {
    const got = await explain('src/app.ts', '{"summary": "cut off');
    expect(got.sections).toBeUndefined();
    expect(got.text).toBe('{"summary": "cut off');
  });
});
