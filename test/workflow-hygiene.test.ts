import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
const PINNED_PNPM = PACKAGE.packageManager.replace(/^pnpm@/, '');

const SHA_PIN = /^[\w.-]+\/[\w.-]+(\/[\w.-]+)*@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;
const PINNED_RUNNER = /^(ubuntu-\d+\.\d+|macos-\d+|windows-\d{4})$/;

const MATRIX_RUNNER = /^\$\{\{ matrix\.os \}\}$/;

const matches =(source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[1]);

function hygieneOf(name: string, source: string) {
  return {
    name,
    uses: matches(source, /^\s*-?\s*uses:\s*(.+?)\s*$/gm),
    runners: matches(source, /^\s*runs-on:\s*(.*?)\s*$/gm),
    matrixImages: (source.match(/^\s*os:\s*\[(.+)\]\s*$/m)?.[1] ?? '').split(',').map((os) => os.trim()).filter(Boolean),
    pnpmVersions: matches(source, /^\s*version:\s*['"]?([^'"\s]+)['"]?\s*$/gm),
  };
}

const SOURCES = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, source: fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8') }));
const WORKFLOWS = SOURCES.map(({ name, source }) => hygieneOf(name, source));
const BUILD_MAC_JOB = /^ {2}build-mac:\s*\n(?:(?! {2}\S).*\n?)*/m;

const refsByAction = new Map<string, Set<string>>();
for (const { uses } of WORKFLOWS) {
  for (const ref of uses) {
    const action = ref.split('@')[0];
    refsByAction.set(action, (refsByAction.get(action) ?? new Set()).add(ref));
  }
}

describe('workflow hygiene', () => {
  it('covers every workflow file, release.yml included', () => {
    expect(WORKFLOWS.map((workflow) => workflow.name)).toEqual(
      expect.arrayContaining(['ci.yml', 'codeql.yml', 'deploy-docs.yml', 'release.yml']),
    );
  });

  it.each(WORKFLOWS)('$name pins every action to a full commit SHA with a version tag comment', ({ uses }) => {
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(SHA_PIN);
  });

  it.each(WORKFLOWS)('$name uses a pinned runner image, never a floating label', ({ runners, matrixImages }) => {
    expect(runners.length).toBeGreaterThan(0);
    for (const runner of runners) expect(runner).toMatch(MATRIX_RUNNER.test(runner) ? MATRIX_RUNNER : PINNED_RUNNER);
    if (runners.some((runner) => MATRIX_RUNNER.test(runner))) expect(matrixImages.length).toBeGreaterThan(0);
    for (const image of matrixImages) expect(image).toMatch(PINNED_RUNNER);
  });

  it.each(WORKFLOWS)('$name uses the pnpm version pinned in package.json', ({ uses, pnpmVersions }) => {
    expect(PINNED_PNPM).toMatch(/^\d+\.\d+\.\d+$/);
    if (uses.some((ref) => ref.startsWith('pnpm/action-setup@'))) expect(pnpmVersions.length).toBeGreaterThan(0);
    for (const version of pnpmVersions) expect(version).toBe(PINNED_PNPM);
  });

  it('pins each action to the same commit in every workflow', () => {
    for (const [action, refs] of refsByAction) expect([...refs], action).toHaveLength(1);
  });

  it('references a secret only in the build-mac job of release.yml', () => {
    for (const { name, source } of SOURCES) {
      const outsideBuildMac = name === 'release.yml' ? source.replace(BUILD_MAC_JOB, '') : source;
      expect(outsideBuildMac, name).not.toMatch(/\bsecrets\./);
    }
    expect(SOURCES.find(({ name }) => name === 'release.yml')?.source.match(BUILD_MAC_JOB)?.[0]).toMatch(/\bsecrets\./);
  });

  it('starts no workflow that holds a secret or write access from a pull request', () => {
    for (const { name, source } of SOURCES) {
      if (/^\s*pull_request_target:/m.test(source)) expect(source, name).not.toMatch(/\bsecrets\.|contents:\s*write/);
    }
    expect(SOURCES.find(({ name }) => name === 'release.yml')?.source).not.toMatch(/^\s*pull_request/m);
  });
});
