import { describe, expect, it } from 'vitest';
import { FLOW_MAX_FILES, FLOW_MAX_STEPS, FLOW_MAX_STORIES, FLOW_TEXT_MAX } from '../src/main/lantern-flow-parse';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { FILES_MAX, FLOW_STORY, FLOW_STORY_VALUE, REF_FILE_LINES, REF_PATHS, REF_STORY, REF_STORY_VALUE, REJECTED_FLOWS, REJECTED_REFERENCES, refLines } from './helpers/lantern-flow-cases';

const HEAD = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
const VALID = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${HEAD}`];

function parse(...flowLines: string[]) {
  return parsePrRecord(`${[...VALID, '+ src/a.ts', ...flowLines].join('\n')}\n`, '7.pr');
}

describe('a record with a flow', () => {
  it('reads every step with its kind, in the order written', () => {
    const { pr, error } = parse(...FLOW_STORY);
    expect(error).toBeNull();
    expect(pr?.flowError).toBeUndefined();
    expect(pr?.flow).toEqual([FLOW_STORY_VALUE]);
  });

  it('reads several stories, a story with no row below, and flow lines placed before the file lines', () => {
    const text = `${[...VALID, '#story One', '#step actor A', '+ src/a.ts', '#story Two', '#step consequence x => y'].join('\n')}\n`;
    const { pr } = parsePrRecord(text, '7.pr');
    expect(pr?.flow?.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(pr?.flow?.[0].below).toEqual([]);
    expect(pr?.flow?.[1].steps).toEqual([{ kind: 'consequence', old: 'x', new: 'y' }]);
    expect(pr?.files).toEqual([{ kind: 'added', path: 'src/a.ts' }]);
  });

  it('keeps a consequence whose new text holds an arrow, and the text at the exact cap', () => {
    const text = 'x'.repeat(FLOW_TEXT_MAX);
    const { pr } = parse('#story ' + text, '#step actor ' + text, '#step consequence a => b => c');
    expect(pr?.flow?.[0].title).toHaveLength(FLOW_TEXT_MAX);
    expect(pr?.flow?.[0].steps[1]).toEqual({ kind: 'consequence', old: 'a', new: 'b => c' });
  });

  it('accepts six steps in a row and five stories, the most allowed', () => {
    const row = Array.from({ length: FLOW_MAX_STEPS }, (_, i) => `#step actor n${i}`);
    expect(parse('#story full', ...row).pr?.flow?.[0].steps).toHaveLength(FLOW_MAX_STEPS);
    const stories = Array.from({ length: FLOW_MAX_STORIES }, (_, i) => [`#story s${i}`, '#step actor a']).flat();
    expect(parse(...stories).pr?.flow).toHaveLength(FLOW_MAX_STORIES);
  });
});

function parseRefs(...flowLines: string[]) {
  return parsePrRecord(`${[...VALID, ...REF_FILE_LINES, ...flowLines].join('\n')}\n`, '7.pr');
}

describe('a flow whose steps point at files of the record (#file)', () => {
  it('attaches each #file line to the step above it, in the order written, as decoded paths', () => {
    const { pr, error } = parseRefs(...REF_STORY);
    expect(error).toBeNull();
    expect(pr?.flowError).toBeUndefined();
    expect(pr?.flow).toEqual([REF_STORY_VALUE]);
  });

  it('leaves a step without #file lines with no files key at all', () => {
    const step = parseRefs(...REF_STORY).pr?.flow?.[0].steps[1];
    expect(step).not.toHaveProperty('files');
  });

  it('accepts six files on a step, the same file on two steps, and a removed file', () => {
    expect(FLOW_MAX_FILES).toBe(FILES_MAX);
    const six = parseRefs('#story s', '#step actor A', ...refLines(...REF_PATHS.slice(0, FILES_MAX)), '#step action b', ...refLines('src/a.ts'));
    expect(six.pr?.flow?.[0].steps[0].files).toEqual(REF_PATHS.slice(0, FILES_MAX));
    expect(six.pr?.flow?.[0].steps[1].files).toEqual(['src/a.ts']);
    const gone = parsePrRecord(`${[...VALID, '- src/old.ts', '#story s', '#step actor A', '#file src/old.ts'].join('\n')}\n`, '7.pr');
    expect(gone.pr?.flow?.[0].steps[0].files).toEqual(['src/old.ts']);
  });

  it('decodes an encoded path before it looks for it among the file lines', () => {
    const text = `${[...VALID, '+ docs/my%20notes%231.md', '#story s', '#step actor A', '#file docs/my%20notes%231.md'].join('\n')}\n`;
    expect(parsePrRecord(text, '7.pr').pr?.flow?.[0].steps[0].files).toEqual(['docs/my notes#1.md']);
  });

  it('reads a record with no #file line exactly as before', () => {
    const { pr } = parseRefs(...FLOW_STORY);
    expect(pr?.flow).toEqual([FLOW_STORY_VALUE]);
  });

  it.each(REJECTED_REFERENCES)('drops the flow and says why for %s', (_label, lines, pattern) => {
    const { pr, error } = parseRefs(...lines);
    expect(error).toBeNull();
    expect(pr?.flow).toBeUndefined();
    expect(pr?.flowError).toMatch(pattern);
    expect(pr?.files).toHaveLength(REF_PATHS.length);
  });

  it('does not blame a #file for a step that was itself refused', () => {
    const { pr } = parseRefs('#story s', '#step person A', '#file src/a.ts');
    expect(pr?.flowError).toMatch(/unknown kind "person"/);
  });
});

describe('a record without a flow', () => {
  it('is unchanged: no flow key and no flow error', () => {
    const { pr, error } = parse();
    expect(error).toBeNull();
    expect(pr).not.toHaveProperty('flow');
    expect(pr).not.toHaveProperty('flowError');
  });
});

describe('a malformed flow: the record is still shown, without the flow, and says why', () => {
  it.each(REJECTED_FLOWS)('%s', (_label, lines, pattern) => {
    const { pr, error } = parse(...lines);
    expect(error).toBeNull();
    expect(pr?.flow).toBeUndefined();
    expect(pr?.flowError).toMatch(pattern);
    expect(pr?.files).toHaveLength(1);
  });

  it('drops the whole flow when only one story is bad, never half of it', () => {
    const { pr } = parse(...FLOW_STORY, '#story broken', '#step person nobody');
    expect(pr?.flow).toBeUndefined();
    expect(pr?.flowError).toMatch(/unknown kind/);
  });

  it('names the line of the problem', () => {
    expect(parse('#story s', '#step person x').pr?.flowError).toMatch(/^line 11: #step unknown kind/);
  });
});
