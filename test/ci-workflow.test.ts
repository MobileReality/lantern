import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
const PINNED_PNPM = PACKAGE.packageManager.replace(/^pnpm@/, '');
const RUN_STEPS = [...WORKFLOW.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const USES_LINES = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const RUNNERS = [...WORKFLOW.matchAll(/^\s*runs-on:\s*(\S+)\s*$/gm)].map((match) => match[1]);
const MATRIX_OS = (WORKFLOW.match(/^\s*os:\s*\[(.+)\]\s*$/m)?.[1] ?? '').split(',').map((os) => os.trim());
const PACKAGING_STEPS = ['pnpm run dist:share', 'pnpm run build:win'];

describe('ci workflow', () => {
  it('runs on push and pull_request', () => {
    expect(WORKFLOW).toMatch(/^on:\s*\n\s+push:/m);
    expect(WORKFLOW).toMatch(/^\s+pull_request:/m);
  });

  it('runs typecheck and the unit tests', () => {
    expect(RUN_STEPS).toContain('pnpm run typecheck');
    expect(RUN_STEPS).toContain('pnpm test');
  });

  it('runs the lint step before the unit tests', () => {
    expect(RUN_STEPS).toContain('pnpm run lint');
    expect(RUN_STEPS.indexOf('pnpm run lint')).toBeLessThan(RUN_STEPS.indexOf('pnpm test'));
  });

  it('installs with a frozen lockfile', () => {
    expect(RUN_STEPS).toContain('pnpm install --frozen-lockfile');
  });

  it('uses the pnpm version pinned in package.json', () => {
    expect(PINNED_PNPM).toMatch(/^\d+\.\d+\.\d+$/);
    const versions = [...WORKFLOW.matchAll(/^\s*version:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) expect(version).toBe(PINNED_PNPM);
  });

  it('grants read-only contents permission', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
  });

  it('pins every action to a full commit SHA with a version tag comment', () => {
    expect(USES_LINES.length).toBeGreaterThan(0);
    for (const line of USES_LINES) expect(line).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  it('uses a pinned runner image, never a floating label', () => {
    expect(RUNNERS.length).toBeGreaterThan(0);
    for (const runner of RUNNERS) expect(runner).toMatch(/^(ubuntu-\d+\.\d+|\$\{\{ matrix\.os \}\})$/);
    for (const os of MATRIX_OS) expect(os).toMatch(/^(ubuntu-\d+\.\d+|macos-\d+|windows-\d{4})$/);
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
