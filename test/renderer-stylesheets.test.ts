import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');

function linkedStylesheets(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
}

describe('renderer stylesheets', () => {
  it('are all copied into out/ by the build script', () => {
    const build = fs.readFileSync(path.join(ROOT, 'scripts/esbuild.mjs'), 'utf8');
    for (const page of ['workspace.html', 'overlay.html']) {
      const html = fs.readFileSync(path.join(ROOT, 'src/renderer', page), 'utf8');
      const missing = linkedStylesheets(html).filter((file) => !build.includes(`'${file}'`));
      expect(missing, `${page} links stylesheets the build never copies`).toEqual([]);
    }
  });
});
