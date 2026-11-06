import { describe, expect, it } from 'vitest';
import { parseExplain, parseQuiz } from '../src/renderer/lib/explain';

const DOC = `---
mrexplain: 1
title: Add a Redis cache to the user fetch
summary: Caches getUser behind Redis
slug: add-user-cache
base: main
files:
  - path: src/api/users.ts
    symbol: getUser
    note: checks cache first
  - path: src/cache/redis.ts
---

## Background

### Primer

Redis is an in-memory store.

### Context

The user fetch hits the API every time.

## Intuition

Read-through: check cache, fall back to API.

## Code

The read now happens in [getUser](src/api/users.ts#getUser).

## Quiz

\`\`\`quiz
- q: Why did the first fetch still hit the API?
  options:
    - text: The read happens after the API call.
      correct: true
      why: getUser awaits the API first, so the read is dead code.
    - text: The cache key omitted the tenant id.
      correct: false
      why: The key includes the tenant — that would be a collision, not a skip.
\`\`\`
`;

describe('parseExplain — frontmatter', () => {
  it('extracts scalar metadata', () => {
    const ex = parseExplain(DOC);
    expect(ex.meta).toMatchObject({
      title: 'Add a Redis cache to the user fetch',
      summary: 'Caches getUser behind Redis',
      slug: 'add-user-cache',
      base: 'main',
    });
    expect(ex.error).toBeUndefined();
  });

  it('extracts the files list with optional symbol and note', () => {
    const ex = parseExplain(DOC);
    expect(ex.meta.files).toEqual([
      { path: 'src/api/users.ts', symbol: 'getUser', note: 'checks cache first' },
      { path: 'src/cache/redis.ts', symbol: undefined, note: undefined },
    ]);
  });

  it('errors when the frontmatter block is absent', () => {
    const ex = parseExplain('# just markdown\n\nno frontmatter here');
    expect(ex.error).toBeTruthy();
  });

  it('errors on malformed yaml frontmatter', () => {
    const ex = parseExplain('---\ntitle: "unterminated\n---\n\n## Background\n');
    expect(ex.error).toBeTruthy();
  });
});

describe('parseExplain — sections', () => {
  it('splits Background into a collapsible primer and always-shown context', () => {
    const ex = parseExplain(DOC);
    expect(ex.primer).toBe('Redis is an in-memory store.');
    expect(ex.context).toBe('The user fetch hits the API every time.');
  });

  it('captures intuition and code sections as markdown', () => {
    const ex = parseExplain(DOC);
    expect(ex.intuition).toContain('Read-through');
    expect(ex.code).toContain('[getUser](src/api/users.ts#getUser)');
  });

  it('does not treat a ### heading as a new top-level section', () => {
    const ex = parseExplain(DOC);
    expect(ex.context).not.toContain('##');
    expect(ex.intuition).not.toContain('Primer');
  });

  it('ignores heading-like lines inside fenced code blocks', () => {
    const doc = [
      '---',
      'title: T',
      'summary: S',
      '---',
      '',
      '## Intuition',
      '',
      'Example of the file shape:',
      '',
      '```',
      '## Background',
      '### Primer',
      '## Quiz',
      '```',
      '',
      'That block above is illustrative.',
      '',
      '## Code',
      '',
      'real code section',
    ].join('\n');
    const ex = parseExplain(doc);
    expect(ex.intuition).toContain('## Background');
    expect(ex.intuition).toContain('illustrative');
    expect(ex.code).toBe('real code section');
    expect(ex.primer).toBe('');
  });

  it('leaves sections empty when absent rather than throwing', () => {
    const ex = parseExplain('---\ntitle: T\nsummary: S\n---\n\n## Intuition\n\nonly this\n');
    expect(ex.primer).toBe('');
    expect(ex.code).toBe('');
    expect(ex.intuition).toBe('only this');
  });
});

describe('parseQuiz', () => {
  it('parses questions with options, correctness and explanations', () => {
    const ex = parseExplain(DOC);
    expect(ex.quiz).toHaveLength(1);
    expect(ex.quiz[0].q).toContain('first fetch');
    expect(ex.quiz[0].options).toHaveLength(2);
    const correct = ex.quiz[0].options.filter((o) => o.correct);
    expect(correct).toHaveLength(1);
    expect(correct[0].why).toContain('dead code');
  });

  it('returns an empty array when there is no quiz fence', () => {
    expect(parseQuiz('## Quiz\n\nno fence here')).toEqual([]);
  });

  it('returns an empty array on malformed quiz yaml', () => {
    expect(parseQuiz('```quiz\n- q: [unbalanced\n```')).toEqual([]);
  });

  it('drops options without text and questions without options', () => {
    const q = parseQuiz('```quiz\n- q: Has one good option\n  options:\n    - text: ok\n      correct: true\n      why: yes\n    - correct: false\n      why: no text\n- q: No options at all\n```');
    expect(q).toHaveLength(1);
    expect(q[0].options).toHaveLength(1);
  });
});
