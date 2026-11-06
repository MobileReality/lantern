import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const appDir = path.join(root, 'test/e2e/app');

export interface SkillsHarnessSpec {
  project: boolean;
  homeSkills: string[];
  projectSkills: string[];
  globalExtras?: Record<string, string[]>;
  projectExtras?: Record<string, string[]>;
  viewport?: string;
}

export interface SkillsHarness {
  app: ElectronApplication;
  page: Page;
  home: string;
  project: string;
  errors: string[];
  close(): Promise<void>;
}

async function writeSkills(base: string, names: string[]) {
  for (const name of names) {
    await mkdir(path.join(base, '.claude', 'skills', name), { recursive: true });
    await writeFile(path.join(base, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
}

async function buildBundles() {
  const { nodeBundle } = (await import(pathToFileURL(path.join(root, 'scripts/node-bundle.mjs')).href)) as { nodeBundle: Record<string, unknown> };
  const node = { ...nodeBundle, logLevel: 'silent' as const };
  const web = { bundle: true, platform: 'browser' as const, format: 'iife' as const, target: 'chrome130', loader: { '.svg': 'text' as const }, alias: nodeBundle.alias as Record<string, string>, logLevel: 'silent' as const };
  await Promise.all([
    build({ ...web, entryPoints: [path.join(appDir, 'skills-extras-renderer.ts')], outfile: path.join(appDir, 'skills-extras-renderer.js') }),
    build({ ...node, entryPoints: [path.join(appDir, 'skills-extras-main.ts')], outfile: path.join(appDir, 'skills-extras-main.cjs') }),
    build({ ...node, entryPoints: [path.join(root, 'src/preload/workspace.ts')], outfile: path.join(appDir, 'skills-extras-preload.cjs') }),
  ]);
}

export async function launchSkillsHarness(spec: SkillsHarnessSpec): Promise<SkillsHarness> {
  await buildBundles();
  const work = await mkdtemp(path.join(tmpdir(), 'lantern-skills-e2e-'));
  const home = path.join(work, 'home');
  const project = path.join(work, 'northwind');
  const userData = path.join(work, 'user-data');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(project, { recursive: true }), mkdir(userData)]);
  execFileSync('git', ['init', '-q', project]);
  await writeSkills(home, spec.homeSkills);
  await writeSkills(project, spec.projectSkills);
  if (spec.globalExtras) {
    await mkdir(path.join(home, '.claude'), { recursive: true });
    await writeFile(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify(spec.globalExtras));
  }
  if (spec.projectExtras) {
    await mkdir(path.join(project, '.claude'), { recursive: true });
    await writeFile(path.join(project, '.claude', 'lantern-extensions.json'), JSON.stringify(spec.projectExtras));
  }
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.join(appDir, 'skills-extras-main.cjs')],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        HOME: home,
        LANTERN_HARNESS_USER_DATA: userData,
        LANTERN_HARNESS_HOME: home,
        LANTERN_HARNESS_PROJECT: spec.project ? project : '',
        LANTERN_HARNESS_VIEWPORT: spec.viewport ?? '1100x800',
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
      home,
      project,
      errors,
      async close() {
        try {
          await app?.close();
        } finally {
          await rm(work, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}
