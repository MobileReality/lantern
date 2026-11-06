import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readProjectFile } from '../src/main/filecontent';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES } from '../src/shared/code-preview';

let base = '';
let project = '';

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-filecontent-')));
  project = path.join(base, 'proj');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'top secret');
  fs.symlinkSync(path.join(base, 'secret.txt'), path.join(project, 'src/leak.txt'));
  fs.symlinkSync(path.join(project, 'src/a.ts'), path.join(project, 'src/alias.ts'));
  fs.writeFileSync(path.join(project, 'many.txt'), 'x\n'.repeat(CODE_VIEW_MAX_LINES + 50));
  fs.writeFileSync(path.join(project, 'big.txt'), `${'y'.repeat(99)}\n`.repeat(Math.ceil(CODE_HL_MAX_BYTES / 100) + 500));
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('readProjectFile', () => {
  it('reads a file inside the project', () => {
    expect(readProjectFile(project, 'src/a.ts')).toMatchObject({ exists: true, text: 'export const a = 1;\n', truncated: 0 });
  });

  it('follows a symlink that stays inside the project', () => {
    expect(readProjectFile(project, 'src/alias.ts').exists).toBe(true);
  });

  it.each(['../secret.txt', 'src/../../secret.txt', '/etc/passwd', '/tmp/secret.txt', 'C:\\Windows\\win.ini', '..\\secret.txt', '', 'src/a.ts\0'])('refuses %j', (rel) => {
    expect(readProjectFile(project, rel)).toMatchObject({ exists: false, refused: true, text: '' });
  });

  it('refuses a symlink pointing out of the project', () => {
    expect(readProjectFile(project, 'src/leak.txt')).toMatchObject({ exists: false, refused: true, text: '' });
  });

  it('refuses non-string input', () => {
    expect(readProjectFile(project, undefined).refused).toBe(true);
    expect(readProjectFile(undefined, 'src/a.ts').refused).toBe(true);
  });

  it('reports a missing file or a directory without refusing', () => {
    expect(readProjectFile(project, 'nope.ts')).toMatchObject({ exists: false });
    expect(readProjectFile(project, 'nope.ts').refused).toBeUndefined();
    expect(readProjectFile(project, 'src').exists).toBe(false);
  });

  it('caps lines and reports how many were cut', () => {
    const r = readProjectFile(project, 'many.txt');
    expect(r.text.split('\n')).toHaveLength(CODE_VIEW_MAX_LINES);
    expect(r.truncated).toBeGreaterThan(0);
  });

  it('caps bytes and flags the file as clipped', () => {
    const r = readProjectFile(project, 'big.txt');
    expect(r.clipped).toBe(true);
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(CODE_HL_MAX_BYTES);
  });
});
