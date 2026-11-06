import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts', 'lint-reviewer.mjs');

const agent = (id: string, subagent_type: string, description: string, prompt: string) => ({
  message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type, description, prompt } }] },
});
const result = (id: string, content: string) => ({ message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function run(entries: object[], extra: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-reviewer-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const res = spawnSync('node', [SCRIPT, ...extra, '--agent-id', 'a1', dir], { encoding: 'utf8' });
  return { status: res.status, out: res.stdout };
}

const REVIEW_PROMPT = 'Run lantern-code-reviewer against HEAD. End with VERDICT lines.';

describe('lint-reviewer', () => {
  it('passes a review done by reviewer', () => {
    const r = run([agent('t1', 'reviewer', 'Review the branch', REVIEW_PROMPT), result('t1', 'VERDICT: merge')]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('0 review problem(s) out of 1 review(s)');
  });

  it('fails a review done by general-purpose', () => {
    const r = run([agent('t1', 'general-purpose', 'Review the branch', REVIEW_PROMPT)]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/agent-a1\.jsonl:1 review-not-by-reviewer general-purpose/);
  });

  it('fails a review with no subagent_type', () => {
    const r = run([agent('t1', '', 'check it', REVIEW_PROMPT)]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('review-not-by-reviewer general-purpose');
  });

  it('reports reviewer-missing when the type was not found', () => {
    const r = run([
      agent('t1', 'reviewer', 'Review the branch', REVIEW_PROMPT),
      result('t1', "Agent type 'reviewer' not found. Available agents: general-purpose, Explore"),
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/agent-a1\.jsonl:1 reviewer-missing/);
  });

  it('passes a non-review Agent call by general-purpose', () => {
    const r = run([agent('t1', 'general-purpose', 'Find usages', 'Search the repo for foo')]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('0 review problem(s) out of 0 review(s)');
  });

  it('treats "review" anywhere in the description, or as a word in the prompt, as a review', () => {
    expect(run([agent('t1', 'general-purpose', 'Code review of branch', 'look at the diff')]).status).toBe(1);
    expect(run([agent('t1', 'general-purpose', 'check branch', 'Please do a code review of HEAD')]).status).toBe(1);
  });

  it('does not take VERDICT alone, or a word like "preview", for a review', () => {
    expect(run([agent('t1', 'general-purpose', 'Search', 'grep the logs for VERDICT lines')]).status).toBe(0);
    expect(run([agent('t1', 'general-purpose', 'Find files', 'list the preview components')]).status).toBe(0);
  });

  it('prints JSON with --json', () => {
    const r = run([agent('t1', 'general-purpose', 'Review it', REVIEW_PROMPT)], ['--json']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.out).violations[0]).toMatchObject({ rule: 'review-not-by-reviewer', subagentType: 'general-purpose' });
  });
});
