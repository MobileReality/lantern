import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const RUN_STEPS = [...WORKFLOW.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const MATRIX_OS = (WORKFLOW.match(/^\s*os:\s*\[(.+)\]\s*$/m)?.[1] ?? '').split(',').map((os) => os.trim());
const PACKAGING_STEPS = ['pnpm run dist:share', 'pnpm run build:win'];

describe('ci workflow', () => {
  it('runs on push and pull_request', () => {
    expect(WORKFLOW).toMatch(/^on:\s*\n\s+push:/m);
    expect(WORKFLOW).toMatch(/^\s+pull_request:/m);
  });

  it('grants read-only contents permission', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
  });

  it('keeps the check job and builds on ubuntu, macos and windows without failing fast', () => {
    expect(WORKFLOW).toMatch(/^ {2}check:\s*$/m);
    expect(MATRIX_OS.some((os) => os.startsWith('ubuntu-'))).toBe(true);
    expect(MATRIX_OS.some((os) => os.startsWith('macos-'))).toBe(true);
    expect(MATRIX_OS.some((os) => os.startsWith('windows-'))).toBe(true);
    expect(WORKFLOW).toMatch(/fail-fast:\s*false/);
  });

  it('packages on macos and windows with the release scripts', () => {
    for (const step of PACKAGING_STEPS) expect(RUN_STEPS).toContain(step);
  });

  it('uploads and publishes nothing', () => {
    expect(WORKFLOW).not.toMatch(/upload-artifact|gh release|contents:\s*write/);
  });

  it('launches no Electron, e2e or signing step', () => {
    for (const step of RUN_STEPS.filter((run) => !PACKAGING_STEPS.includes(run))) expect(step).not.toMatch(/playwright|test:graph|dist|sign|electron|start/);
  });
});
