import { describe, expect, it } from 'vitest';
import { formatFixRequests } from '../src/renderer/lib/fixrequests/format';
import type { FixItem } from '../src/renderer/lib/fixrequests/model';
import { copyTexts } from '../src/shared/lang/fix-requests';

const PR = { id: '7', title: 'LAN-62: Add repo caching', branch: 'feat/repo-cache' };
const HEADER = 'Review comments for PR #7: LAN-62: Add repo caching (feat/repo-cache)';
const SCOPE = 'Work within this pull request only: stay on its branch and inside the code it changes.';
const FIX_LINE = 'Intent: Fix. Change the code to address this comment.';
const EXPLAIN_LINE = 'Intent: Explain. Explain this without changing any code.';
const QUESTION_LINE = 'Intent: Question. Answer this question without changing any code.';
const TOP = `${HEADER}\n${SCOPE}`;
const FIX_WORD = /\bfix\b/i;

const fixItem: FixItem = { id: '1', path: 'src/a.ts', start: 3, end: 3, code: 'a()', comment: 'Handle null.' };
const explainItem: FixItem = { id: '2', path: 'src/b.ts', start: 1, end: 1, code: 'b()', comment: 'What does this do?', intent: 'explain' };
const questionItem: FixItem = { id: '3', path: 'src/c.ts', comment: 'Why do we have this flow?', intent: 'question' };

describe('the text copied for an agent', () => {
  it('writes the header, the pull request scope, then path:lines, the fenced code, the comment and the instruction, per item, exactly', () => {
    const items: FixItem[] = [
      { id: '1', path: 'src/a.ts', start: 3, end: 5, code: 'const a = 1;\nconst b = 2;\nreturn a + b;', comment: 'Fix this.' },
    ];

    expect(formatFixRequests(PR, items)).toBe([TOP, '', 'src/a.ts:3-5', '```', 'const a = 1;', 'const b = 2;', 'return a + b;', '```', 'Comment: Fix this.', FIX_LINE].join('\n'));
  });

  it('writes a single line as start-start and a whole file as just its path', () => {
    const items: FixItem[] = [
      { id: '1', path: 'src/a.ts', start: 9, end: 9, code: 'let x;', comment: 'Remove this.' },
      { id: '2', path: 'src/b.ts', comment: 'Rename the module.' },
    ];

    expect(formatFixRequests(PR, items, { order: ['src/a.ts', 'src/b.ts'] })).toBe(
      [TOP, '', 'src/a.ts:9-9', '```', 'let x;', '```', 'Comment: Remove this.', FIX_LINE, '', 'src/b.ts', 'Comment: Rename the module.', FIX_LINE].join('\n'),
    );
  });

  it('puts the items in file order: the review order first, then path, then first line', () => {
    const items: FixItem[] = [
      { id: '1', path: 'test/z.test.ts', comment: 'last by review order' },
      { id: '2', path: 'src/b.ts', start: 20, end: 21, code: 'b2', comment: 'b later' },
      { id: '3', path: 'src/b.ts', start: 2, end: 3, code: 'b1', comment: 'b earlier' },
      { id: '4', path: 'src/c.ts', comment: 'not in the order list' },
      { id: '5', path: 'src/a.ts', comment: 'not in the order list, alphabetically first' },
    ];

    const text = formatFixRequests(PR, items, { order: ['src/b.ts', 'test/z.test.ts'] });

    expect(text.split('\n\n').slice(1).map((block) => block.split('\n')[0])).toEqual(['src/b.ts:2-3', 'src/b.ts:20-21', 'test/z.test.ts', 'src/a.ts', 'src/c.ts']);
  });

  it('keeps a multi-line comment whole and trims trailing blank space', () => {
    const items: FixItem[] = [{ id: '1', path: 'a.ts', start: 1, end: 1, code: 'x   \n\n', comment: '  first line\nsecond line  ' }];

    expect(formatFixRequests(PR, items)).toContain(`a.ts:1-1\n\`\`\`\nx\n\`\`\`\nComment: first line\nsecond line\n${FIX_LINE}`);
  });

  it('uses a longer fence when the code itself holds backticks', () => {
    const items: FixItem[] = [{ id: '1', path: 'a.md', start: 1, end: 3, code: '```ts\nx\n```', comment: 'Fix.' }];

    expect(formatFixRequests(PR, items)).toContain('a.md:1-3\n````\n```ts\nx\n```\n````\nComment: Fix.');
  });

  it('names a pull request without a title or branch, and one header line at most', () => {
    expect(formatFixRequests({ id: '9', title: '', branch: '' }, [])).toBe(`Review comments for PR #9\n${SCOPE}`);
    expect(formatFixRequests({ id: '9', title: 'Two\nlines  here', branch: 'feat/x' }, [])).toBe(`Review comments for PR #9: Two lines here (feat/x)\n${SCOPE}`);
  });

  it('leaves the comment line out of an item whose comment is empty but keeps its instruction', () => {
    const items: FixItem[] = [{ id: '1', path: 'a.ts', comment: '   ' }];

    expect(formatFixRequests(PR, items)).toBe(`${TOP}\n\na.ts\n${FIX_LINE}`);
  });
});

describe('the instruction a comment carries', () => {
  it('reads a comment without an intent as a request to fix', () => {
    const { intent: _own, ...plain } = fixItem;

    const text = formatFixRequests(PR, [plain]);

    expect(text).toContain(FIX_LINE);
    expect(text).not.toContain('These comments differ');
  });

  it('asks only to change the code when every comment says fix', () => {
    const text = formatFixRequests(PR, [{ ...fixItem, intent: 'fix' }, { id: '4', path: 'src/d.ts', comment: 'Rename.' }]);

    expect(text.match(/^Intent: /gm)).toHaveLength(2);
    expect(text).not.toContain(EXPLAIN_LINE);
    expect(text).not.toContain(QUESTION_LINE);
    expect(text).not.toContain('These comments differ');
  });

  it('never says fix when every comment is a question', () => {
    const text = formatFixRequests(PR, [questionItem, { ...questionItem, id: '4', path: 'src/d.ts', start: 2, end: 2, code: 'd()' }]);

    expect(text).toContain(QUESTION_LINE);
    expect(text.match(/^Intent: /gm)).toHaveLength(2);
    expect(text).not.toMatch(FIX_WORD);
    expect(text).not.toContain('These comments differ');
  });

  it('never says fix when every comment asks for an explanation', () => {
    const text = formatFixRequests(PR, [explainItem, { ...explainItem, id: '4', path: 'src/d.ts' }]);

    expect(text).toContain(EXPLAIN_LINE);
    expect(text).not.toMatch(FIX_WORD);
  });

  it('gives each comment its own line and a short preamble for the intents present, when they differ', () => {
    const text = formatFixRequests(PR, [fixItem, questionItem], { order: ['src/a.ts', 'src/c.ts'] });

    expect(text).toBe(
      [
        TOP,
        '',
        'These comments differ. Follow the instruction on each one:\n- Fix: Change the code to address this comment.\n- Question: Answer this question without changing any code.',
        '',
        'src/a.ts:3-3\n```\na()\n```\nComment: Handle null.\n' + FIX_LINE,
        '',
        'src/c.ts\nComment: Why do we have this flow?\n' + QUESTION_LINE,
      ].join('\n'),
    );
  });

  it('lists all three behaviours when all three occur', () => {
    const text = formatFixRequests(PR, [fixItem, explainItem, questionItem]);

    expect(text).toContain('- Fix: ');
    expect(text).toContain('- Explain: ');
    expect(text).toContain('- Question: ');
  });

  it('uses the chosen default for comments that have no intent of their own', () => {
    const { intent: _own, ...plain } = fixItem;

    const text = formatFixRequests(PR, [plain, { id: '4', path: 'src/d.ts', comment: 'Hm.' }], { choice: 'question' });

    expect(text.split(QUESTION_LINE)).toHaveLength(3);
    expect(text).not.toMatch(FIX_WORD);
  });

  it('lets a comment keep its own intent over the chosen default, which then makes the copy mixed', () => {
    const { intent: _own, ...plain } = fixItem;

    const text = formatFixRequests(PR, [plain, explainItem], { choice: 'question', order: ['src/a.ts', 'src/b.ts'] });

    expect(text).toContain(`Comment: Handle null.\n${QUESTION_LINE}`);
    expect(text).toContain(`Comment: What does this do?\n${EXPLAIN_LINE}`);
    expect(text).toContain('These comments differ');
    expect(text).not.toContain('- Fix: ');
  });

  it('keeps an explicit fix when the default is a question', () => {
    const text = formatFixRequests(PR, [{ ...fixItem, intent: 'fix' }], { choice: 'question' });

    expect(text).toContain(FIX_LINE);
    expect(text).not.toContain(QUESTION_LINE);
  });

  it('follows each comment with the per-comment choice and falls back to fix for one without an intent', () => {
    const { intent: _own, ...plain } = fixItem;

    const text = formatFixRequests(PR, [plain, questionItem], { choice: 'per-comment', order: ['src/a.ts', 'src/c.ts'] });

    expect(text).toContain(`Comment: Handle null.\n${FIX_LINE}`);
    expect(text).toContain(`Comment: Why do we have this flow?\n${QUESTION_LINE}`);
  });

  it('tells the agent to stay within the pull request in every kind of copy', () => {
    const copies = [
      formatFixRequests(PR, [fixItem]),
      formatFixRequests(PR, [explainItem]),
      formatFixRequests(PR, [questionItem]),
      formatFixRequests(PR, [fixItem, explainItem, questionItem]),
      formatFixRequests(PR, [fixItem], { choice: 'question' }),
      formatFixRequests(PR, []),
      formatFixRequests(PR, [questionItem], { texts: copyTexts('pl') }),
    ];

    for (const text of copies.slice(0, -1)) expect(text, text).toContain(SCOPE);
    expect(copies[copies.length - 1]).toContain(copyTexts('pl').scope);
  });
});

describe('the language of the copied text', () => {
  it('writes the header, scope, preamble and instructions in the chosen language', () => {
    const texts = copyTexts('pl');

    const text = formatFixRequests(PR, [fixItem, questionItem], { texts, order: ['src/a.ts', 'src/c.ts'] });

    expect(text.split('\n')[0]).toBe('Komentarze z review dla PR #7: LAN-62: Add repo caching (feat/repo-cache)');
    expect(text).toContain(texts.scope);
    expect(text).toContain(texts.mixed);
    expect(text).toContain(`${texts.intentWord}: ${texts.intents.question.label}. ${texts.intents.question.instruction}`);
    expect(text).not.toContain('Review comments for');
    expect(text).not.toContain('Intent:');
  });

  it('falls back to the English text for a key the language lacks, and to English for an unknown language', () => {
    const tables = {
      en: { copy: { header: 'EN header', scope: 'EN scope', mixed: 'EN mixed', intent: 'EN intent' }, intent: { fix: { label: 'EN fix', instruction: 'EN fix do' }, explain: { label: 'EN explain', instruction: 'EN explain do' }, question: { label: 'EN question', instruction: 'EN question do' } } },
      zz: { copy: { header: 'ZZ header', scope: '  ' }, intent: { fix: { label: 'ZZ fix' }, question: 7 } },
    };

    const zz = copyTexts('zz', tables);

    expect(zz.header).toBe('ZZ header');
    expect(zz.scope).toBe('EN scope');
    expect(zz.intents.fix).toEqual({ label: 'ZZ fix', instruction: 'EN fix do' });
    expect(zz.intents.question).toEqual({ label: 'EN question', instruction: 'EN question do' });
    expect(copyTexts('xx', tables)).toEqual(copyTexts('en', tables));
    expect(copyTexts(undefined)).toEqual(copyTexts('en'));
    expect(copyTexts('__proto__')).toEqual(copyTexts('en'));
  });
});
