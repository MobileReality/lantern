import { execFile } from 'node:child_process';
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
  const modelCli = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'model.mjs');

  it('allows exact Astra and the supported Sonnet, Opus and Fable ids, accepting older versions, rejecting aliases and Haiku', async () => {
    for (const id of ['gpt-6-astra', 'claude-sonnet-5-5', 'claude-sonnet-5-6', 'claude-sonnet-6', 'claude-opus-5-5', 'claude-fable-5-1']) {
      const { stdout } = await run(process.execPath, [modelCli, 'check', id]);
      expect(stdout.trim()).toBe(`OK ${id}`);
    }
    for (const id of ['claude-sonnet-5-4', 'claude-opus-5-0', 'claude-fable-5-0']) {
      const { stdout } = await run(process.execPath, [modelCli, 'check', id]);
      expect(stdout.trim()).toMatch(new RegExp(`^OK ${id} \\(below the recommended `));
    }
    for (const id of ['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-terra', 'gpt-6-astra-preview', 'astra', 'terra', 'claude-haiku-5-5']) {
      await expect(run(process.execPath, [modelCli, 'check', id])).rejects.toMatchObject({ code: 1 });
    }
    const { stdout } = await run(process.execPath, [modelCli, 'floor']);
    expect(stdout.trim()).toBe('sonnet, opus or fable of any version, or the exact id gpt-6-astra (recommended: sonnet 5.5, opus 5.5, fable 5.1 or newer)');
  });
});
