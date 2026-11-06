import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REASON_MAX_CHARS, REASON_RULE } from '../src/shared/reason';

const REFERENCE = path.join(__dirname, '..', 'skills', 'lantern-setup', 'references', 'reason.md');

describe('the why rule has one source', () => {
  it('states the same three rules in the reference the skills read and in the constant the app prompt reads', () => {
    const bullets = fs
      .readFileSync(REFERENCE, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2));
    expect(bullets).toEqual(REASON_RULE);
  });

  it('caps a reason at the same length the record scripts enforce', async () => {
    const prs = await import(pathToFileURL(path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'prs.mjs')).href);
    expect(prs.REASON_MAX_CHARS).toBe(REASON_MAX_CHARS);
  });
});
