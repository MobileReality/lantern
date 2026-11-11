import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SELFTEST = path.join(__dirname, '..', 'skills', 'lantern-sync', 'scripts', 'selftest.mjs');

describe('lantern-sync self-test', () => {
  it('passes every assertion and exits 0', async () => {
    const { stdout } = await run(process.execPath, [SELFTEST], { maxBuffer: 10 * 1024 * 1024 });
    expect(stdout).toMatch(/all \d+ assertions passed/);
    expect(stdout).not.toMatch(/^not ok/m);
  }, 120_000);
});

describe('Lantern mapping model policy', () => {
  const setup = path.join(__dirname, '..', 'skills', 'lantern-setup');
  const modelCli = path.join(setup, 'scripts', 'model.mjs');
  const floor = JSON.parse(fs.readFileSync(path.join(setup, 'references', 'model-floor.json'), 'utf8')) as {
    claude: { family: string; recommended?: string }[];
    allowedIds?: string[];
    codex?: { family: string }[];
  };
  const check = (id: string) => run(process.execPath, [modelCli, 'check', id]);
  const versionId = (family: string, version: string) => `claude-${family}-${version.replace('.', '-')}`;
  const bump = (version: string, by: number) => {
    const [major, minor = 0] = version.split('.').map(Number);
    return `${major}.${minor + by}`;
  };

  it('allows every family of the floor and every exact id it lists', async () => {
    expect(floor.claude.length).toBeGreaterThan(0);
    for (const id of [...(floor.allowedIds ?? []), ...floor.claude.map(({ family }) => versionId(family, '9.9'))]) {
      expect((await check(id)).stdout.trim(), id).toBe(`OK ${id}`);
    }
  });

  it('accepts the recommended version and newer without advice, and an older one with advice', async () => {
    for (const { family, recommended } of floor.claude.filter((entry) => entry.recommended)) {
      for (const version of [recommended!, bump(recommended!, 1), String(Number(recommended!.split('.')[0]) + 1)]) {
        const id = versionId(family, version);
        expect((await check(id)).stdout.trim(), id).toBe(`OK ${id}`);
      }
      const [, recommendedMinor = '0'] = recommended!.split('.');
      const olderVersions = ['1.0', ...(Number(recommendedMinor) > 0 ? [bump(recommended!, -1)] : [])];
      for (const version of olderVersions) {
        const older = versionId(family, version);
        const { stdout } = await check(older);
        expect(stdout.trim(), older).toMatch(new RegExp(`^OK ${older} \\(below the recommended ${family}`));
      }
    }
  });

  it('rejects a Codex id the Claude route does not list, an id outside the floor and an alias', async () => {
    const known = new Set([...floor.claude.map(({ family }) => family), ...(floor.allowedIds ?? [])]);
    const outside = ['haiku', 'unlisted-family'].filter((family) => !known.has(family));
    const codexOnly = (floor.codex ?? []).map(({ family }) => `gpt-6-${family}`).filter((id) => !floor.allowedIds?.includes(id));
    const codexVersioned = (floor.codex ?? []).map(({ family }) => `gpt-6.1-${family}`).filter((id) => !floor.allowedIds?.includes(id));
    const codexBare = (floor.codex ?? []).map(({ family }) => family);
    const ids = [...codexOnly, ...codexVersioned, ...codexBare, ...outside.map((family) => versionId(family, '5.5')), ...floor.claude.map(({ family }) => family), `${floor.allowedIds?.[0] ?? 'exact-id'}-preview`];
    for (const id of ids) await expect(check(id), id).rejects.toMatchObject({ code: 1 });
  });
});
