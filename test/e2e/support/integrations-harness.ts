import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceAliases } from '../../../scripts/aliases.cjs';
import { startFakeProviders } from '../../helpers/fake-providers';
import type { FakeProviders } from '../../helpers/fake-providers';

const root = process.cwd();
const appDir = path.join(root, 'test/e2e/app');

interface HarnessProjectSpec {
  name: string;
  remote: string | null;
  envFile?: string;
}

interface IntegrationsHarness {
  app: ElectronApplication;
  page: Page;
  fake: FakeProviders;
  projects: { path: string; name: string }[];
  errors: string[];
  close(): Promise<void>;
}

function makeProject(parent: string, spec: HarnessProjectSpec) {
  const dir = path.join(parent, spec.name);
  execFileSync('git', ['init', '-q', dir]);
  if (spec.remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', spec.remote]);
  return dir;
}

async function launchIntegrationsHarness(specs: HarnessProjectSpec[], viewport = '1280x800', harnessEnv: Record<string, string> = {}): Promise<IntegrationsHarness> {
  const bundle = { bundle: true, alias: sourceAliases(), logLevel: 'silent' as const };
  await Promise.all([
    build({ ...bundle, entryPoints: [path.join(appDir, 'integrations-renderer.ts')], outfile: path.join(appDir, 'integrations-renderer.js'), platform: 'browser', format: 'iife', target: 'chrome130', loader: { '.svg': 'text' } }),
    build({ ...bundle, entryPoints: [path.join(appDir, 'integrations-main.ts')], outfile: path.join(appDir, 'integrations-main.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
    build({ ...bundle, entryPoints: [path.join(root, 'src/preload/workspace.ts')], outfile: path.join(appDir, 'integrations-preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  ]);

  const work = await mkdtemp(path.join(tmpdir(), 'lantern-integrations-e2e-'));
  const userData = path.join(work, 'user-data');
  await mkdir(userData);
  const projects = await Promise.all(
    specs.map(async (spec) => {
      const dir = makeProject(work, spec);
      if (spec.envFile) {
        await mkdir(path.join(dir, '.ai'));
        await writeFile(path.join(dir, '.ai', '.env'), spec.envFile);
      }
      return { path: dir, name: spec.name };
    }),
  );
  const fake = await startFakeProviders();
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.join(appDir, 'integrations-main.cjs')],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        LANTERN_HARNESS_USER_DATA: userData,
        LANTERN_HARNESS_VIEWPORT: viewport,
        LANTERN_HARNESS_PROJECTS: JSON.stringify(projects),
        LANTERN_STUB_PROVIDERS: fake.baseUrl,
        ...harnessEnv,
      },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.locator('html[data-harness-ready="true"]').waitFor();
    return {
      app,
      page,
      fake,
      projects,
      errors,
      async close() {
        try {
          await app?.close();
        } finally {
          await fake.close();
          await rm(work, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await fake.close();
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

export { launchIntegrationsHarness };
export type { IntegrationsHarness, HarnessProjectSpec };
