import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'model.mjs');

const CODEX_ENV = { ...process.env, LANTERN_PROVIDER: 'codex' };

function check(model: string, env: NodeJS.ProcessEnv = CODEX_ENV) {
  return spawnSync(process.execPath, [SCRIPT, 'check', model], { encoding: 'utf8', env });
}

describe('Lantern model policy', () => {
  it('lets only the Codex route write with a Sol model', () => {
    const claudeEnv = { ...process.env, LANTERN_PROVIDER: '' };
    expect(check('gpt-6.1-sol', claudeEnv).status).toBe(1);
    expect(check('gpt-7-sol', claudeEnv).status).toBe(1);
    expect(check('claude-sonnet-5-5', claudeEnv).status).toBe(0);
  });

  it('allows the Codex Sol floor and the existing Claude floor on the Codex route', () => {
    expect(check('gpt-6.1-sol').status).toBe(0);
    expect(check('gpt-6.2-sol').status).toBe(0);
    expect(check('gpt-7-sol').status).toBe(0);
    expect(check('claude-sonnet-5-5').status).toBe(0);
    expect(check('claude-sonnet-6-0').status).toBe(0);
  });

  it.each(['claude-sonnet-5-5', 'claude-sonnet-5-6', 'claude-opus-5-5', 'claude-opus-5-6', 'claude-opus-6', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-fable-6', 'claude-opus-5-5-20260301', 'gpt-6-astra'])(
    'lets the Claude route map with %s',
    (model) => {
      const claudeEnv = { ...process.env, LANTERN_PROVIDER: '' };
      expect(check(model, claudeEnv).status).toBe(0);
      expect(check(model, claudeEnv).stdout).toBe(`OK ${model}\n`);
    },
  );

  it.each(['claude-sonnet-4-5', 'claude-sonnet-5-4', 'claude-opus-4-1', 'claude-opus-5-0', 'claude-opus-4-8', 'claude-fable-5', 'claude-fable-5-0', 'claude-opus-4-1-20250805'])(
    'accepts the older %s with the advisory',
    (model) => {
      const result = check(model, { ...process.env, LANTERN_PROVIDER: '' });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`^OK ${model} \\(below the recommended (sonnet 5\\.5|opus 5\\.5|fable 5\\.1)\\)\n$`));
    },
  );

  it('names the family and version it recommends', () => {
    const claudeEnv = { ...process.env, LANTERN_PROVIDER: '' };
    expect(check('claude-sonnet-4-5', claudeEnv).stdout).toBe('OK claude-sonnet-4-5 (below the recommended sonnet 5.5)\n');
    expect(check('claude-opus-4-1', claudeEnv).stdout).toBe('OK claude-opus-4-1 (below the recommended opus 5.5)\n');
    expect(check('claude-fable-5-0', claudeEnv).stdout).toBe('OK claude-fable-5-0 (below the recommended fable 5.1)\n');
  });

  it.each(['claude-haiku-5-5', 'claude-haiku-6', 'claude-haiku-3-5', 'claude-opus', 'opus', 'fable', 'gpt-4o', 'gpt-6-astra-preview', 'astra'])(
    'refuses %s on the Claude route',
    (model) => {
      const result = check(model, { ...process.env, LANTERN_PROVIDER: '' });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe(`NOT ALLOWED ${model}\n`);
    },
  );

  it.each(['gpt-6.1', 'gpt-6.1-sol-latest', 'GPT-6.1-SOL', 'claude-haiku-5-5', 'gpt-4o'])(
    'rejects unlisted model %s on the Codex route',
    (model) => expect(check(model).status).toBe(1),
  );

  it('describes both provider policies', () => {
    expect(execFileSync(process.execPath, [SCRIPT, 'floor'], { encoding: 'utf8' })).toBe('sonnet, opus or fable of any version, or the exact id gpt-6-astra (recommended: sonnet 5.5, opus 5.5, fable 5.1 or newer)\n');
    expect(execFileSync(process.execPath, [SCRIPT, 'floor', 'codex'], { encoding: 'utf8' })).toBe(
      'gpt-<version>-sol, gpt-<version>-astra or gpt-<version>-terra of any version (recommended: sol 6.1, astra 6 or newer; terra has no recommended version), or sonnet, opus or fable of any version, or the exact id gpt-6-astra (recommended: sonnet 5.5, opus 5.5, fable 5.1 or newer)\n',
    );
  });
});

const CLAUDE_ENV = { ...process.env, LANTERN_PROVIDER: '' };

const CODEX_FAMILIES = [
  { family: 'sol', current: ['gpt-6.1-sol', 'gpt-6.2-sol', 'gpt-7-sol'], older: ['gpt-6-sol', 'gpt-6.0-sol', 'gpt-5-sol'], recommended: 'sol 6.1' },
  { family: 'astra', current: ['gpt-6-astra', 'gpt-6.1-astra', 'gpt-7-astra'], older: ['gpt-5-astra', 'gpt-5.9-astra'], recommended: 'astra 6' },
];

const FAMILIES_WITHOUT_RECOMMENDATION = [
  { family: 'terra', models: ['gpt-5-terra', 'gpt-6-terra', 'gpt-6.1-terra', 'gpt-7-terra'] },
];

describe.each(FAMILIES_WITHOUT_RECOMMENDATION)('Codex route, family $family without a recommended version', ({ models }) => {
  it.each(models)('accepts %s with no advisory', (model) => {
    const result = check(model);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`OK ${model}\n`);
  });

  it.each(models)('refuses %s on the Claude route', (model) => {
    const result = check(model, CLAUDE_ENV);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`NOT ALLOWED ${model}\n`);
  });

  it('is listed in the Codex label without a recommended version', () => {
    const label = execFileSync(process.execPath, [SCRIPT, 'floor', 'codex'], { encoding: 'utf8' });
    expect(label).toContain('gpt-<version>-terra');
    expect(label).toContain('terra has no recommended version');
    expect(label).not.toMatch(/terra \d/);
  });
});

describe.each(CODEX_FAMILIES)('Codex route, family $family', ({ current, older, recommended }) => {
  it.each(current)('accepts the current %s with no advisory', (model) => {
    const result = check(model);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`OK ${model}\n`);
  });

  it.each(older)('accepts the older %s with the advisory', (model) => {
    const result = check(model);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`OK ${model} (below the recommended ${recommended})\n`);
  });

  it.each(current.concat(older).filter((model) => model !== 'gpt-6-astra'))('refuses %s on the Claude route', (model) => {
    const result = check(model, CLAUDE_ENV);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`NOT ALLOWED ${model}\n`);
  });
});

describe('Codex route, wrong shapes and the exact id', () => {
  it.each(['gpt-6-sol-preview', 'gpt-6-astra-preview', 'gpt-sol', 'gpt-astra', 'gpt--sol', 'GPT-6.1-SOL', 'GPT-6-ASTRA', 'gpt-6-terra-preview', 'gpt-terra', 'gpt--terra', 'GPT-6-TERRA', 'gpt-6.1.1-terra', 'gpt-6-terra-latest', ' gpt-6-terra', 'astra', 'sol', 'terra', 'gpt-6.1.1-sol', ' gpt-6.1-sol', 'gpt-6.1-sol ', 'gpt-4o'])(
    'refuses %j',
    (model) => {
      expect(check(model).status).toBe(1);
      expect(check(model, CLAUDE_ENV).status).toBe(1);
    },
  );

  it('refuses an empty id and a missing one', () => {
    expect(check('').status).toBe(2);
    expect(spawnSync(process.execPath, [SCRIPT, 'check'], { encoding: 'utf8', env: CODEX_ENV }).status).toBe(2);
  });

  it('keeps the exact gpt-6-astra id accepted on both routes', () => {
    expect(check('gpt-6-astra').stdout).toBe('OK gpt-6-astra\n');
    expect(check('gpt-6-astra', CLAUDE_ENV).stdout).toBe('OK gpt-6-astra\n');
  });

  it('applies the Codex policy by the .agents/skills location and leaves Claude ids as they are', () => {
    const lib = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'lib.mjs');
    const probe = "import(process.argv[1]).then((l) => console.log(JSON.stringify([l.isCodexRoute(), l.modelAllowed('gpt-6.1-sol'), l.modelAllowed(undefined), l.modelAllowed('claude-sonnet-5-5'), l.modelAdvisory(undefined)])))";
    const run = (script: string, env: NodeJS.ProcessEnv) => JSON.parse(execFileSync(process.execPath, ['-e', probe, script], { encoding: 'utf8', env }).trim());
    expect(run(lib, CLAUDE_ENV)).toEqual([false, false, false, true, null]);
    expect(run(lib, CODEX_ENV)).toEqual([true, true, false, true, null]);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-route-'));
    try {
      const copy = path.join(tmp, '.agents', 'skills', 'lantern-setup');
      fs.cpSync(path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts'), path.join(copy, 'scripts'), { recursive: true });
      fs.cpSync(path.join(__dirname, '..', 'skills', 'lantern-setup', 'references'), path.join(copy, 'references'), { recursive: true });
      const out = spawnSync(process.execPath, [path.join(copy, 'scripts', 'model.mjs'), 'check', 'gpt-6-sol'], { encoding: 'utf8', env: CLAUDE_ENV });
      expect(out.stdout).toBe('OK gpt-6-sol (below the recommended sol 6.1)\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('pins the model Lantern launches Codex with to one the policy accepts without advice', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'agent-codex.ts'), 'utf8');
    const pinned = /LANTERN_CODEX_MODEL = '([^']+)'/.exec(source)?.[1] ?? '';
    expect(check(pinned).stdout).toBe(`OK ${pinned}\n`);
  });
});
