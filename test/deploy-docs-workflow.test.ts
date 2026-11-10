import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-docs.yml'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
const SITE_PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'website/package.json'), 'utf8')) as { packageManager: string };

describe('deploy-docs workflow', () => {
  it('pins the same pnpm version in the site manifest as in the root manifest', () => {
    expect(SITE_PACKAGE.packageManager).toBe(PACKAGE.packageManager);
  });

  it('deploys on push to main, builds on pull requests, and can be started by hand', () => {
    expect(WORKFLOW).toMatch(/^on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/m);
    expect(WORKFLOW).toMatch(/^\s+pull_request:/m);
    expect(WORKFLOW).toMatch(/^\s+workflow_dispatch:/m);
  });

  it('grants read-only contents by default and Pages rights only to the deploy job', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    const deployAt = WORKFLOW.indexOf('\n  deploy:');
    expect(deployAt).toBeGreaterThan(0);
    expect(WORKFLOW.slice(0, deployAt)).not.toMatch(/pages:\s*write|id-token:\s*write/);
    const deploy = WORKFLOW.slice(deployAt);
    expect(deploy).toMatch(/pages:\s*write/);
    expect(deploy).toMatch(/id-token:\s*write/);
  });

  it('deploys only from main, never from a pull request', () => {
    const deploy = WORKFLOW.slice(WORKFLOW.indexOf('\n  deploy:'));
    expect(deploy).toMatch(/needs:\s*build/);
    expect(deploy).toMatch(/if:\s*github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
  });

  it('reads the base and the site URL from repository variables, not secrets', () => {
    expect(WORKFLOW).toMatch(/DOCS_BASE:\s*\$\{\{\s*vars\.DOCS_BASE\s*\}\}/);
    expect(WORKFLOW).toMatch(/DOCS_SITE_URL:\s*\$\{\{\s*vars\.DOCS_SITE_URL/);
    expect(WORKFLOW).not.toMatch(/secrets\./);
  });
});
