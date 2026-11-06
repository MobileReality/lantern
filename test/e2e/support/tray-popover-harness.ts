import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Frame, Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceAliases } from '../../../scripts/aliases.cjs';
import type { TrayModel } from '../../../src/shared/tray-model';

const appDir = path.join(process.cwd(), 'test/e2e/app');

interface TrayHarness {
  app: ElectronApplication;
  page: Page;
  frame: Frame;
  errors: string[];
  show(model: TrayModel, maxHeight?: number): Promise<void>;
  update(model: TrayModel): Promise<void>;
  calls(): Promise<string[]>;
  close(): Promise<void>;
}

async function launchTrayHarness(viewport = '460x820', scale = 1): Promise<TrayHarness> {
  await build({
    entryPoints: [path.join(appDir, 'tray-popover-renderer.ts')],
    outfile: path.join(appDir, 'tray-popover-renderer.js'),
    bundle: true,
    alias: sourceAliases(),
    loader: { '.svg': 'text' },
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    logLevel: 'silent',
  });
  const userData = await mkdtemp(path.join(tmpdir(), 'lantern-tray-e2e-'));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [`--force-device-scale-factor=${scale}`, path.join(appDir, 'tray-popover-main.cjs')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', LANTERN_HARNESS_USER_DATA: userData, LANTERN_HARNESS_VIEWPORT: viewport },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const frameReady = async () => {
      for (const frame of page.frames()) if (frame.url().endsWith('tray-popover-frame.html') && (await frame.locator('html[data-harness-ready="true"]').count())) return frame;
      return null;
    };
    await page.waitForFunction(() => document.getElementById('window') !== null);
    let frame: Frame | null = null;
    while (!frame) {
      frame = await frameReady();
      if (!frame) await page.waitForTimeout(50);
    }
    const ready = frame;
    const settle = async () => {
      await ready.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => {
        const host = document.getElementById('window') as HTMLElement;
        return host.style.height !== '' || host.offsetHeight > 0;
      });
    };
    return {
      app,
      page,
      frame: ready,
      errors,
      async show(model, maxHeight = 720) {
        await ready.evaluate(({ m, max }) => (window as unknown as { __tray: { open(model: unknown, max: number): void } }).__tray.open(m, max), { m: model, max: maxHeight });
        await settle();
      },
      async update(model) {
        await ready.evaluate((m) => (window as unknown as { __tray: { update(model: unknown): void } }).__tray.update(m), model);
        await settle();
      },
      calls: () => ready.evaluate(() => (window as unknown as { __calls: string[] }).__calls.slice()),
      async close() {
        try {
          await app?.close();
        } finally {
          await rm(userData, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
}

export { launchTrayHarness };
export type { TrayHarness };
