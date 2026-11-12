import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const RUN_STEPS = [...WORKFLOW.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const USES_LINES = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const MATRIX_OS = (WORKFLOW.match(/^\s*os:\s*\[(.+)\]\s*$/m)?.[1] ?? '').split(',').map((os) => os.trim());
const PACKAGING_STEPS = ['pnpm run dist:share', 'pnpm run build:win', 'pnpm run build:linux'];
const JOBS_SECTION = WORKFLOW.slice(WORKFLOW.search(/^jobs:\s*$/m));
const JOBS = new Map(
  JOBS_SECTION.split(/^(?= {2}[\w-]+:\s*$)/m)
    .slice(1)
    .map((block) => [block.match(/^ {2}([\w-]+):/)?.[1] ?? '', block] as const),
);
const runStepsOf = (job: string) => [...(JOBS.get(job) ?? '').matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const USES_ALLOWED = /^(actions\/checkout|pnpm\/action-setup|actions\/setup-node|actions\/upload-artifact)@/;
const E2E_SCRIPTS = ['test:integrations:e2e', 'test:tray:e2e', 'test:pr-host:e2e', 'test:skills:e2e'];
const E2E_XVFB = 'xvfb-run -a --server-args="-screen 0 1920x1080x24"';
const E2E_ALLOWED_RUN = [/^pnpm install --frozen-lockfile$/, /^sudo apt-get (update|install -y --no-install-recommends [\w .+-]+)$/, /^sudo sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0$/];

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

  it('packages on macos, windows and linux with the release scripts', () => {
    for (const step of PACKAGING_STEPS) expect(RUN_STEPS).toContain(step);
  });

  it('publishes no release and uses no secret, token or third-party coverage service', () => {
    expect(WORKFLOW).not.toMatch(/gh release|contents:\s*write|secrets\.|GITHUB_TOKEN|codecov|coveralls|sonar/i);
  });

  it('uses only the four known actions', () => {
    for (const line of USES_LINES) expect(line).toMatch(USES_ALLOWED);
  });

  it('uploads artifacts only from the e2e and coverage jobs', () => {
    for (const [job, text] of JOBS) if (!['e2e', 'coverage'].includes(job)) expect(text, job).not.toMatch(/upload-artifact/);
    for (const job of ['e2e', 'coverage']) expect(JOBS.get(job)).toMatch(/actions\/upload-artifact@/);
  });

  it('launches no Electron, e2e or signing step outside the e2e job and the packaging steps', () => {
    for (const job of JOBS.keys()) {
      if (job === 'e2e') continue;
      for (const step of runStepsOf(job).filter((run) => !PACKAGING_STEPS.includes(run))) expect(step, job).not.toMatch(/playwright|test:graph|dist|sign|electron|start|xvfb/);
    }
  });

  it('hides no command in a block run step except the coverage summary', () => {
    for (const [job, text] of JOBS) {
      const blocks = [...text.matchAll(/^\s*-?\s*run:\s*[|>][-+]?\s*$/gm)];
      expect(blocks.length, job).toBe(job === 'coverage' ? 1 : 0);
    }
  });

  it('never lets a failing step pass', () => {
    expect(WORKFLOW).not.toMatch(/continue-on-error|\|\|\s*true/);
  });
});

describe('ci workflow, e2e job', () => {
  const steps = runStepsOf('e2e');
  const e2eRuns = steps.filter((step) => step.startsWith('xvfb-run'));

  it('runs on ubuntu with a timeout', () => {
    expect(JOBS.get('e2e')).toMatch(/^\s+runs-on:\s*ubuntu-24\.04\s*$/m);
    expect(JOBS.get('e2e')).toMatch(/^\s+timeout-minutes:\s*\d+\s*$/m);
  });

  it('runs every stable e2e script under a virtual display, none of them twice', () => {
    expect(e2eRuns.map((step) => step.replace(`${E2E_XVFB} pnpm run `, '').split(' ')[0])).toEqual(E2E_SCRIPTS);
    for (const step of e2eRuns) expect(step.startsWith(`${E2E_XVFB} pnpm run test:`)).toBe(true);
  });

  it('shows the harness windows, which Electron on Linux does not paint while hidden', () => {
    const job = JOBS.get('e2e') ?? '';
    expect(job).toMatch(/^ {4}env:\s*\n {6}LANTERN_GRAPH_VISIBLE: "1"\n {6}LANTERN_HARNESS_VISIBLE: "1"\n {4}steps:/m);
  });

  it('runs only scripts that exist in package.json', () => {
    for (const script of E2E_SCRIPTS) expect(PACKAGE.scripts[script]).toMatch(/^playwright test /);
  });

  it('leaves out the suites that cannot pass on the headless runner: the graph canvas, pixel snapshots, performance and flow layout', () => {
    expect(steps.join('\n')).not.toMatch(/test:graph|test:flow:layout|update-snapshots|--update/);
  });

  it('allows nothing else to run in it', () => {
    for (const step of steps.filter((run) => !run.startsWith('xvfb-run'))) expect(E2E_ALLOWED_RUN.some((allowed) => allowed.test(step))).toBe(true);
  });

  it('keeps going after one suite fails so every suite reports, and still fails the job', () => {
    const job = JOBS.get('e2e') ?? '';
    for (const script of E2E_SCRIPTS.slice(1)) {
      const step = job.match(new RegExp(`- name: [^\\n]+\\n\\s+if: \\$\\{\\{ !cancelled\\(\\) \\}\\}\\n\\s+run: [^\\n]*${script}\\b`));
      expect(step, script).not.toBeNull();
    }
  });

  it('uploads the Playwright results only when something failed', () => {
    const job = JOBS.get('e2e') ?? '';
    expect(job).toMatch(/if: \$\{\{ failure\(\) \}\}\n\s+uses: actions\/upload-artifact@/);
    expect(job).toMatch(/path: test-results\/playwright/);
  });
});

describe('ci workflow, coverage job', () => {
  const job = JOBS.get('coverage') ?? '';

  it('runs on ubuntu with a timeout', () => {
    expect(job).toMatch(/^\s+runs-on:\s*ubuntu-24\.04\s*$/m);
    expect(job).toMatch(/^\s+timeout-minutes:\s*\d+\s*$/m);
  });

  it('runs the coverage script, so a failing run fails the job', () => {
    expect(PACKAGE.scripts.coverage).toBe('vitest run --coverage');
    expect(runStepsOf('coverage').some((step) => /^pnpm coverage(\s|$)/.test(step))).toBe(true);
  });

  it('asks vitest for the json summary the job summary reads', () => {
    expect(job).toMatch(/pnpm coverage .*--coverage\.reporter=json-summary/);
    expect(job).toMatch(/coverage\/coverage-summary\.json/);
  });

  it('writes the totals to the job summary', () => {
    expect(job).toContain('$GITHUB_STEP_SUMMARY');
  });

  it('uploads the coverage folder as an artifact even when the run failed', () => {
    expect(job).toMatch(/if: \$\{\{ !cancelled\(\) \}\}\n\s+uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+\n\s+with:\n\s+name: coverage\n\s+path: coverage\n/);
  });
});
