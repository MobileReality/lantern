import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceAliases } from '../scripts/aliases.cjs';

const root = path.resolve(__dirname, '..');
const ALIASES = { '@shared': 'src/shared', '@main': 'src/main', '@renderer': 'src/renderer', '@skills': 'skills' };
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

const ENTRY = [
  "import { AUTH_STATUS_CHANNEL } from '@shared/auth';",
  "import { BindingError } from '@main/auth/errors';",
  "import { trapTab } from '@renderer/lib/modal-focus';",
  'console.log(AUTH_STATUS_CHANNEL, BindingError, trapTab);',
].join('\n');

async function bundle(alias?: Record<string, string>) {
  const result = await build({ stdin: { contents: ENTRY, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'neutral', logLevel: 'silent', ...(alias ? { alias } : {}) });
  return result.outputFiles[0].text;
}

describe('path aliases', () => {
  it('declares one alias per source folder in tsconfig', () => {
    const { paths } = readJson('tsconfig.json').compilerOptions;
    expect(paths).toEqual(Object.fromEntries(Object.entries(ALIASES).map(([name, dir]) => [`${name}/*`, [`./${dir}/*`]])));
  });

  it('points every alias at a real folder', () => {
    for (const dir of Object.values(sourceAliases())) expect(existsSync(dir)).toBe(true);
    expect(Object.keys(sourceAliases()).sort()).toEqual(Object.keys(ALIASES).sort());
  });

  it('is inherited by the e2e tsconfig', () => {
    const e2e = readJson('test/e2e/tsconfig.json');
    expect(e2e.extends).toBe('../../tsconfig.json');
    expect(e2e.compilerOptions.paths).toBeUndefined();
  });

  it('resolves in vitest', async () => {
    const shared = await import('@shared/auth');
    expect(shared.AUTH_STATUS_CHANNEL).toBe('auth:status');
    const main = await import('@main/auth/errors');
    expect(typeof main.BindingError).toBe('function');
  });

  it('resolves in esbuild through the shared alias map', async () => {
    expect(await bundle(sourceAliases())).toContain('auth:status');
  });

  it('resolves in esbuild through tsconfig alone', async () => {
    expect(await bundle()).toContain('auth:status');
  });

  it('reaches the plan format through @skills in vitest and esbuild', async () => {
    const format = await import('@skills/lantern-plan/scripts/plan-format.mjs');
    expect(format.TARGET_KIND.NEW).toBe('new');
    const entry = { contents: "import { TARGET_KIND } from '@skills/lantern-plan/scripts/plan-format.mjs';\nconsole.log(TARGET_KIND);", resolveDir: root, loader: 'ts' as const };
    const result = await build({ stdin: entry, bundle: true, write: false, platform: 'neutral', logLevel: 'silent' });
    expect(result.outputFiles[0].text).toContain('"new"');
  });

  it.each(['lanternplanimpact', 'lanternplanfiles', 'lanternplanfocus', 'lanternplanpanel', 'lanternpronly', 'lantern-pixi/index', 'lantern-pixi/node-graphics'])('imports across source folders through aliases in %s', (name) => {
    const source = readFileSync(path.join(root, `src/renderer/lib/${name}.ts`), 'utf8');
    expect(source).not.toMatch(/from '(\.\.\/){2,}/);
  });
});
