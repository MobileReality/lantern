import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'skills', 'lantern-setup', 'example-web');
const VALIDATE = path.join(ROOT, 'skills', 'lantern-setup', 'scripts', 'validate.mjs');
const TOOLING = ['locales.json', 'render.mjs', 'sections.html', 'template.html'];
const FICTIONAL = ['demo-ai', 'demo-platforms', 'demo-sections', 'demo-skills'];
const SETTLED = ['demo-sections', 'demo-skills'];
const INTERNAL = new RegExp(['hr-mr', '-app', '|mobilereality', '\\.pl', '|ADMIN_', 'USERS', '|sendSlack', 'MessageProxy', '|leave', 'Service|leave-man', 'agement'].join(''), 'i');
const NOT_SCANNED = ['.ai/runs/', '.lantern/prs/', '.lantern/plans/', 'test/example-web.test.ts'];

function trackedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return listing.split('\0').filter(Boolean);
}

describe('skills/lantern-setup/example-web', () => {
  it('holds only fictional demos and the renderer', () => {
    const names = fs.readdirSync(EXAMPLES).sort();
    const expected = [...TOOLING, ...FICTIONAL, ...FICTIONAL.map((name) => `${name}.html`)].sort();
    expect(names).toEqual(expected);
  });

  it('titles every rendered page as fictional', () => {
    for (const name of FICTIONAL) {
      const html = fs.readFileSync(path.join(EXAMPLES, `${name}.html`), 'utf8');
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1], name).toBe(`${name} (fictional) map`);
    }
  });

  it.each(SETTLED)('%s is a settled map of the source files beside it', (name) => {
    const run = spawnSync(process.execPath, [VALIDATE, path.join(EXAMPLES, name), '--settled'], { encoding: 'utf8' });
    expect(run.stdout + run.stderr).toMatch(/\nOK\n$/);
    expect(run.status).toBe(0);
  });

  it('demo-sections carries one section of each type', () => {
    const files = fs.readdirSync(path.join(EXAMPLES, 'demo-sections', '.lantern', 'sections')).sort();
    expect(files).toEqual(['db.section', 'facts.section', 'rbac.section', 'states.section']);
  });

  it('names no internal project, domain or identifier anywhere in the tracked tree', () => {
    const offenders = trackedFiles()
      .filter((file) => !NOT_SCANNED.some((skip) => file === skip || file.startsWith(skip)))
      .filter((file) => {
        const absolute = path.join(ROOT, file);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
        const content = fs.readFileSync(absolute);
        return !content.includes(0) && INTERNAL.test(content.toString('utf8'));
      });
    expect(offenders).toEqual([]);
  });
});
