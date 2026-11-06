import { _electron as electron, expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('renders real semantic spans through the production preload and IPC contract', async ({}, testInfo) => {
  const root = process.cwd();
  const appDir = path.join(root, 'test/e2e/lsp-app');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-lsp-project-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-lsp-electron-'));
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src/types.ts'), 'export interface User { name: string }\n');
  const lines = ["import type { User } from './types';", '// keep lexical comment', "const user: User = { name: 'Ada' };", ...Array.from({ length: 70 }, (_, index) => `const value${index} = ${index};`), 'console.log(user.name);'];
  fs.writeFileSync(path.join(project, 'src/main.ts'), `${lines.join('\n')}\n`);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['add', '.'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: project });
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
  lines[35] = 'const changedValue = user.name;';
  fs.writeFileSync(path.join(project, 'src/main.ts'), `${lines.join('\n')}\n`);
  await Promise.all([
    build({ entryPoints: [path.join(appDir, 'main.ts')], outfile: path.join(appDir, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
    build({ entryPoints: [path.join(appDir, 'renderer.ts')], outfile: path.join(appDir, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife' }),
    build({ entryPoints: [path.join(root, 'src/renderer/lib/syntax-worker.ts')], outfile: path.join(appDir, 'syntax-worker.js'), bundle: true, platform: 'browser', format: 'iife' }),
  ]);
  const app = await electron.launch({ args: [path.join(appDir, 'main.cjs')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '', LANTERN_LSP_PROJECT: project, LANTERN_LSP_BEFORE: before, LANTERN_LSP_USER_DATA: userData, LANTERN_LSP_RUNTIME: path.join(root, 'out/lsp-runtime'), LANTERN_LSP_PRELOAD: path.join(root, 'out/preload/workspace.js') } });
  try {
    const page = await app.firstWindow();
    await page.goto(`file://${path.join(appDir, 'index.html')}?project=${encodeURIComponent(project)}`);
    await page.locator('html[data-ready="true"]').waitFor();
    await expect(page.locator('.lt-code-modal [data-semantic="true"]')).not.toHaveCount(0);
    const comment = page.locator('.lt-code-modal .code span', { hasText: 'keep lexical comment' });
    await expect(comment).toHaveCSS('color', 'rgb(139, 148, 173)');
    await expect(comment).toHaveCSS('font-style', 'italic');
    await page.screenshot({ path: testInfo.outputPath('real-semantic-preview.png') });
    await page.goto(`file://${path.join(appDir, 'index.html')}?project=${encodeURIComponent(project)}&diff=1`);
    await expect(page.locator('.lt-diff-modal .df-more').first()).toBeVisible();
    await page.locator('.lt-diff-modal .df-more').first().click();
    const revealed = await page.locator('.lt-diff-modal .df-fold .cl.ctx').count();
    await expect(page.locator('.lt-diff-modal [data-semantic="true"]')).not.toHaveCount(0);
    for (const kind of ['add', 'del']) {
      const row = page.locator(`.lt-diff-modal .cl.${kind}`).first();
      await expect(row.locator('.code span').first()).toHaveCSS('color', /rgb\(/);
      await expect(row).toHaveCSS('background-color', /rgba?\(/);
    }
    expect(await page.locator('.lt-diff-modal .df-fold .cl.ctx').count()).toBe(revealed);
    await page.screenshot({ path: testInfo.outputPath('real-semantic-diff.png') });
  } finally {
    await app.close();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
