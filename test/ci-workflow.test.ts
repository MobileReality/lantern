import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
const PINNED_PNPM = PACKAGE.packageManager.replace(/^pnpm@/, '');
const RUN_STEPS = [...WORKFLOW.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const USES_REFS = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);

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
    expect(versions).toEqual([PINNED_PNPM]);
  });

  it('grants read-only contents permission', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
  });

  it('pins every action to a full tag', () => {
    expect(USES_REFS.length).toBeGreaterThan(0);
    for (const ref of USES_REFS) expect(ref).toMatch(/@v\d+\.\d+\.\d+$/);
  });

  it('launches no Electron, e2e or signing step', () => {
    for (const step of RUN_STEPS) expect(step).not.toMatch(/playwright|test:graph|dist|sign|electron|start/);
  });
});
