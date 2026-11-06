import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-docs.yml'), 'utf8');
const CI = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
const SITE_PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'website/package.json'), 'utf8')) as { packageManager: string };
const PINNED_PNPM = PACKAGE.packageManager.replace(/^pnpm@/, '');
const RUN_STEPS = [...WORKFLOW.matchAll(/^\s*-?\s*run:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const USES_REFS = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const CI_USES_REFS = [...CI.matchAll(/^\s*-?\s*uses:\s*(.+?)\s*$/gm)].map((match) => match[1]);
const RUNNERS = [...WORKFLOW.matchAll(/^\s*runs-on:\s*(\S+)\s*$/gm)].map((match) => match[1]);
const WATCHED_PATHS = ['website/**', 'docs/**', 'README.md', 'TROUBLESHOOTING.md', 'CONTRIBUTING.md', '.github/workflows/deploy-docs.yml'];

const CI_ACTIONS = new Set(CI_USES_REFS.map((ref) => ref.split('@')[0]));

describe('deploy-docs workflow', () => {
  it('deploys on push to main, builds on pull requests, and can be started by hand', () => {
    expect(WORKFLOW).toMatch(/^on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/m);
    expect(WORKFLOW).toMatch(/^\s+pull_request:/m);
    expect(WORKFLOW).toMatch(/^\s+workflow_dispatch:/m);
  });

  it('watches the website, the docs and the three root documents on push and on pull requests', () => {
    for (const watched of WATCHED_PATHS) {
      const occurrences = WORKFLOW.split(`- '${watched}'`).length - 1;
      expect(occurrences, watched).toBe(2);
    }
  });

  it('installs in website/ with a frozen lockfile and builds', () => {
    expect(WORKFLOW).toMatch(/working-directory:\s*website/);
    expect(RUN_STEPS).toContain('pnpm install --frozen-lockfile');
    expect(RUN_STEPS).toContain('pnpm run build');
    expect(RUN_STEPS).toContain('pnpm run typecheck');
  });

  it('uses the pnpm version pinned in both manifests and Node 22', () => {
    expect(SITE_PACKAGE.packageManager).toBe(PACKAGE.packageManager);
    const versions = [...WORKFLOW.matchAll(/^\s*version:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1]);
    expect(versions).toEqual([PINNED_PNPM]);
    expect(WORKFLOW).toMatch(/node-version:\s*22\s*$/m);
    expect(WORKFLOW).toMatch(/cache-dependency-path:\s*website\/pnpm-lock\.yaml/);
  });

  it('pins every action to a full commit SHA with a version tag comment, matching the pins CI uses', () => {
    expect(USES_REFS.length).toBeGreaterThan(0);
    for (const ref of USES_REFS) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    const shared = USES_REFS.filter((ref) => CI_ACTIONS.has(ref.split('@')[0]));
    expect(shared.length).toBeGreaterThanOrEqual(3);
    for (const ref of shared) expect(CI_USES_REFS).toContain(ref);
  });

  it('uses a pinned runner image, never a floating label', () => {
    expect(RUNNERS).toHaveLength(2);
    for (const runner of RUNNERS) expect(runner).toMatch(/^ubuntu-\d+\.\d+$/);
  });

  it('grants read-only contents by default and Pages rights only to the deploy job', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    expect(WORKFLOW.match(/pages:\s*write/g)).toHaveLength(1);
    expect(WORKFLOW.match(/id-token:\s*write/g)).toHaveLength(1);
    const deploy = WORKFLOW.slice(WORKFLOW.indexOf('\n  deploy:'));
    expect(deploy).toMatch(/pages:\s*write/);
    expect(deploy).toMatch(/id-token:\s*write/);
  });

  it('uploads website/dist and deploys only from main, never from a pull request', () => {
    expect(WORKFLOW).toMatch(/path:\s*website\/dist/);
    const deploy = WORKFLOW.slice(WORKFLOW.indexOf('\n  deploy:'));
    expect(deploy).toMatch(/needs:\s*build/);
    expect(deploy).toMatch(/if:\s*github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
    expect(deploy).toMatch(/group:\s*pages/);
    expect(deploy).toMatch(/actions\/deploy-pages@/);
    expect(WORKFLOW).toMatch(/^ {2}build:/m);
  });

  it('reads the base and the site URL from repository variables, not secrets', () => {
    expect(WORKFLOW).toMatch(/DOCS_BASE:\s*\$\{\{\s*vars\.DOCS_BASE\s*\}\}/);
    expect(WORKFLOW).toMatch(/DOCS_SITE_URL:\s*\$\{\{\s*vars\.DOCS_SITE_URL \|\| 'https:\/\/docs\.thelantern\.dev\/'\s*\}\}/);
    expect(WORKFLOW).not.toMatch(/secrets\./);
  });
});
