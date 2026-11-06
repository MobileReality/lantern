import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeNotice, readTranscript, transcriptPath, type Entry } from '../src/main/session-context';

const ROOT = '/work/lantern';
const said = (text: string): Entry => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const calls = (id: string, name: string, input: Record<string, unknown>): Entry => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const answered = (id: string): Entry => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id }] } });

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('describeNotice', () => {
  it('describes a pending shell command for a permission card', () => {
    const entries = [said('Installing.'), calls('t1', 'Bash', { command: 'pnpm install', description: 'Install dependencies' })];
    expect(describeNotice('permission', entries, ROOT)).toEqual({ title: 'Run a shell command?', context: 'Install dependencies: pnpm install' });
  });

  it('names the edited file relative to the project', () => {
    const entries = [calls('t1', 'Edit', { file_path: '/work/lantern/src/a.ts', new_string: 'const a = 1;' })];
    expect(describeNotice('permission', entries, ROOT)).toEqual({ title: 'Edit src/a.ts?', context: 'const a = 1;' });
  });

  it('tells creating a file apart from overwriting one', () => {
    const exists = (file: string) => file.endsWith('old.md');
    expect(describeNotice('permission', [calls('t1', 'Write', { file_path: '/work/lantern/old.md', content: 'y' })], ROOT, exists).title).toBe('Overwrite old.md?');
    expect(describeNotice('permission', [calls('t1', 'Write', { file_path: '/work/lantern/new.md', content: 'y' })], ROOT, exists).title).toBe('Create new.md?');
  });

  it('ignores a tool call that already has a result', () => {
    const entries = [calls('t1', 'Bash', { command: 'ls' }), answered('t1'), said('All **done**: tests pass.')];
    expect(describeNotice('permission', entries, ROOT)).toEqual({ context: 'All done: tests pass.' });
  });

  it('shows the question for a waiting card that asks something', () => {
    const entries = [calls('t1', 'AskUserQuestion', { questions: [{ question: 'Which layout should I keep?' }] })];
    expect(describeNotice('waiting', entries, ROOT)).toEqual({ title: 'Claude is asking you', context: 'Which layout should I keep?' });
  });

  it('summarises a finished session with its last message, without markdown', () => {
    const entries = [said('First.'), said('## Result\n- Added `theme.css`\n- See [the docs](https://x)')];
    expect(describeNotice('finished', entries, ROOT)).toEqual({ context: 'Result Added theme.css See the docs' });
  });

  it('cuts a long summary to 180 characters', () => {
    const context = describeNotice('failed', [said('word '.repeat(100))], ROOT).context!;
    expect(context.length).toBeLessThanOrEqual(180);
    expect(context.endsWith('…')).toBe(true);
  });

  it('returns nothing when the transcript is empty', () => {
    expect(describeNotice('finished', [], ROOT)).toEqual({});
  });
});

describe('transcripts', () => {
  it('maps a working folder to the Claude projects path', () => {
    expect(transcriptPath('/Users/me/my.app/src', 'abc', '/Users/me')).toBe('/Users/me/.claude/projects/-Users-me-my-app-src/abc.jsonl');
  });

  it('reads JSON lines, skipping broken ones, and a missing file as empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-ctx-'));
    temps.push(dir);
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, `${JSON.stringify(said('a'))}\nnot json\n${JSON.stringify(said('b'))}\n`);
    expect(readTranscript(file)).toHaveLength(2);
    expect(readTranscript(path.join(dir, 'missing.jsonl'))).toEqual([]);
  });
});
