import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const RUN_STEPS = [...WORKFLOW.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);

describe('ci workflow', () => {
  it('runs on push and pull_request', () => {
    expect(WORKFLOW).toMatch(/^on:\s*\n\s+push:/m);
    expect(WORKFLOW).toMatch(/^\s+pull_request:/m);
  });

  it('grants read-only contents permission', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
  });

  it('launches no Electron, e2e or signing step', () => {
    expect(RUN_STEPS.length).toBeGreaterThan(0);
    for (const step of RUN_STEPS) expect(step).not.toMatch(/playwright|test:graph|dist|sign|electron|start/);
  });
});
