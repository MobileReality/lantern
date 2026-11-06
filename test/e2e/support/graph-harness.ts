import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const appDir = path.join(root, 'test/e2e/app');

interface GraphHarness {
  app: ElectronApplication;
  page: Page;
  userData: string;
  errors: string[];
  startupMs: number;
}

async function launchGraphHarness(fixture = 'overview', pr?: string): Promise<GraphHarness> {
  const realMapPath = fixture === 'real' ? process.env.LANTERN_GRAPH_MAP : undefined;
  if (fixture === 'real' && !realMapPath) throw new Error('LANTERN_GRAPH_MAP is required for the real fixture');
  const realMap = realMapPath ? await readFile(realMapPath, 'utf8') : 'null';
  execFileSync(process.execPath, [path.join(root, 'scripts/material-file-icons.mjs'), path.join(root, 'test/e2e/assets/file-icons')]);
  await Promise.all([build({
    entryPoints: [path.join(appDir, 'renderer.ts')],
    outfile: path.join(appDir, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    loader: { '.svg': 'text' },
    define: { __LANTERN_REAL_MAP__: realMap },
  }), build({
    entryPoints: [path.join(root, 'src/renderer/lib/syntax-worker.ts')],
    outfile: path.join(appDir, 'syntax-worker.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130',
  })]);
  const userData = await mkdtemp(path.join(tmpdir(), 'lantern-graph-e2e-'));
  let app: ElectronApplication | undefined;
  try {
    const startedAt = performance.now();
    app = await electron.launch({
      args: [`--force-device-scale-factor=${process.env.LANTERN_GRAPH_DPR ?? '1'}`, path.join(appDir, 'main.cjs')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', LANTERN_GRAPH_USER_DATA: userData, LANTERN_GRAPH_FIXTURE: fixture, LANTERN_GRAPH_PR: pr ?? '', LANTERN_GRAPH_VIEWPORT: process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT ?? '1100x760' },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.locator('html[data-graph-settled="true"]').waitFor();
    return { app, page, userData, errors, startupMs: performance.now() - startedAt };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
}

async function closeGraphHarness(harness: GraphHarness) {
  try {
    await harness.app.close();
  } finally {
    await rm(harness.userData, { recursive: true, force: true });
  }
}

async function loadGraphFixture(harness: GraphHarness, fixture = 'overview', pr?: string, platform = '', extra: Record<string, string> = {}) {
  const dprMode = await harness.page.locator('html').getAttribute('data-graph-dpr-mode') ?? 'native';
  const query = new URLSearchParams({ fixture, dprMode, requestedDpr: process.env.LANTERN_GRAPH_DPR ?? '1', platform, ...extra });
  if (pr) query.set('pr', pr);
  await harness.page.goto(`${pathToFileURL(path.join(appDir, 'index.html')).href}?${query}`);
  await harness.page.locator('html[data-graph-settled="true"]').waitFor();
}

export { closeGraphHarness, launchGraphHarness, loadGraphFixture };
export type { GraphHarness };
