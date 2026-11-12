import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
}
interface Job {
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

const WORKFLOW = load(read('.github/workflows/release.yml')) as Workflow;
const MAC = WORKFLOW.jobs['build-mac'];
const STEPS = MAC.steps;
const KEYCHAIN_STEP = 'bash scripts/mac-ci-keychain.sh create';
const NOTARIZE_STEP = 'bash scripts/mac-sign-notarize.sh notarize';
const SECRETS_BY_STEP = new Map([
  [KEYCHAIN_STEP, ['MACOS_CERTIFICATE_P12_BASE64', 'MACOS_CERTIFICATE_PASSWORD']],
  [NOTARIZE_STEP, ['APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'APPLE_API_KEY_P8_BASE64']],
]);
const indexOfRun = (command: string) => STEPS.findIndex((step) => step.run?.trim() === command);
const readsSecret = (step: Step) => JSON.stringify(step).includes('secrets.');

describe('release workflow, who can start it and what it may do', () => {
  it('starts only on a v* tag push or by hand, never on a pull request', () => {
    expect(Object.keys(WORKFLOW.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(WORKFLOW.on.push).toEqual({ tags: ['v*'] });
  });

  it('grants read-only contents, and the signing job nothing more', () => {
    expect(WORKFLOW.permissions).toEqual({ contents: 'read' });
    expect(MAC.permissions).toEqual({ contents: 'read' });
  });

  it('puts only the signing job in the release environment, where the approvers and the secrets are', () => {
    expect(MAC.environment).toBe('release');
    for (const [name, job] of Object.entries(WORKFLOW.jobs)) if (name !== 'build-mac') expect(job.environment, name).toBeUndefined();
  });
});

describe('release workflow, the signing job', () => {
  it('refuses a ref that is not a v* tag first, before it fetches code or a secret exists', () => {
    const [guard] = STEPS;
    expect(guard.env).toEqual({ REF: '${{ github.ref }}', REF_NAME: '${{ github.ref_name }}', TAG_INPUT: '${{ inputs.tag }}' });
    expect(guard.run).toContain('refs/tags/v*');
    expect(guard.uses).toBeUndefined();
    expect(STEPS.findIndex(readsSecret)).toBeGreaterThan(0);
  });

  it('checks out the ref the environment rule judged and keeps no token in the clone', () => {
    const checkout = STEPS.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toEqual({ ref: '${{ github.ref }}', 'persist-credentials': false });
  });

  it('keeps each secret in the env of the step that needs it, never in a command line or an action input', () => {
    for (const step of STEPS) {
      expect(step.run ?? '', step.name).not.toContain('${{');
      expect(JSON.stringify(step.with ?? {}), step.name).not.toContain('secrets.');
    }
    const secretSteps = STEPS.filter(readsSecret);
    expect(secretSteps.map((step) => step.run?.trim())).toEqual([KEYCHAIN_STEP, NOTARIZE_STEP]);
    for (const step of secretSteps) {
      const names = SECRETS_BY_STEP.get(step.run?.trim() ?? '') ?? [];
      expect(Object.keys(step.env ?? {}).sort()).toEqual([...names].sort());
      for (const name of names) expect(step.env?.[name]).toBe(`\${{ secrets.${name} }}`);
    }
  });

  it('signs from a public identity, not from a secret', () => {
    expect(MAC.env?.MACOS_SIGNING_IDENTITY).toMatch(/^Developer ID Application: .+ \(D8226MY2E7\)$/);
  });

  it('builds with the package scripts in order, never with the ad hoc dist:share', () => {
    const commands = ['pnpm run build', 'pnpm run fuses', KEYCHAIN_STEP, 'bash scripts/mac-sign-notarize.sh sign', NOTARIZE_STEP, 'bash scripts/mac-sign-notarize.sh verify', 'pnpm run pack'];
    const positions = commands.map(indexOfRun);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(STEPS.map((step) => step.run ?? '').join('\n')).not.toMatch(/dist:share|sign:adhoc|pnpm run sign|pnpm run dist\b/);
  });

  it('deletes the keychain in the last step, which runs even after a failure', () => {
    const last = STEPS[STEPS.length - 1];
    expect(last.run?.trim()).toBe('bash scripts/mac-ci-keychain.sh delete');
    expect(last.if).toBe('always()');
  });

  it('uploads the artifact under the name and path the public download link depends on', () => {
    const upload = STEPS.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.with).toMatchObject({ name: 'Lantern-mac', path: 'dist/Lantern-mac.zip', 'if-no-files-found': 'error' });
  });
});

describe('release workflow, the publish job', () => {
  const PUBLISH = WORKFLOW.jobs.publish.steps;
  const copyIndex = PUBLISH.findIndex((step) => step.run?.includes('Lantern-mac-arm64.zip') && step.run.includes('cp '));
  const uploadIndex = PUBLISH.findIndex((step) => step.run?.includes('gh release upload'));

  it('copies Lantern-mac.zip to Lantern-mac-arm64.zip before the upload, and fails when the source is missing', () => {
    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(copyIndex).toBeLessThan(uploadIndex);
    const copy = PUBLISH[copyIndex].run ?? '';
    expect(copy).toContain('cp release-assets/Lantern-mac.zip release-assets/Lantern-mac-arm64.zip');
    expect(copy).toMatch(/\[ ! -f release-assets\/Lantern-mac\.zip \]/);
    expect(copy).toContain('exit 1');
  });

  it('uploads everything in the assets folder with --clobber, so the stable names and the arm64 copy all go up', () => {
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    expect(PUBLISH[uploadIndex].run).toContain('release-assets/* --clobber');
    const uploadedByBuilds = Object.values(WORKFLOW.jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
      .map((step) => step.with?.path);
    expect(uploadedByBuilds.sort()).toEqual(['dist/Lantern-linux-x64.zip', 'dist/Lantern-mac.zip', 'dist/Lantern-win-x64.zip']);
  });

  it('builds and signs nothing in the publish job', () => {
    expect(PUBLISH.map((step) => step.run ?? '').join('\n')).not.toMatch(/pnpm|mac-sign-notarize|codesign|notarytool/);
    expect(PUBLISH.some(readsSecret)).toBe(false);
  });
});

describe('mac entitlements', () => {
  const keysOf = (file: string) => [...read(file).matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort();

  it('give the app JIT, the devices and Apple events it uses, and its helpers JIT only', () => {
    expect(keysOf('build/entitlements.mac.plist')).toEqual([
      'com.apple.security.automation.apple-events',
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input',
      'com.apple.security.device.camera',
    ]);
    expect(keysOf('build/entitlements.mac.inherit.plist')).toEqual(['com.apple.security.cs.allow-jit']);
  });

  it('weaken nothing further', () => {
    for (const file of ['build/entitlements.mac.plist', 'build/entitlements.mac.inherit.plist']) {
      expect(read(file), file).not.toMatch(/disable-library-validation|allow-unsigned-executable-memory|disable-executable-page-protection|allow-dyld-environment-variables|get-task-allow/);
    }
  });
});

describe('mac-sign-notarize.sh notarize, with stub tools', () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function runNotarize(status: 'Accepted' | 'Invalid') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notarize-'));
    scratch.push(dir);
    const bin = path.join(dir, 'bin');
    const app = path.join(dir, 'Lantern.app');
    const calls = path.join(dir, 'calls');
    const keyMode = path.join(dir, 'key-mode');
    const keyPath = path.join(dir, 'key-path');
    fs.mkdirSync(bin);
    fs.mkdirSync(app);
    fs.mkdirSync(path.join(dir, 'tmp'));
    const stub = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    stub('ditto', ':');
    stub(
      'xcrun',
      `echo "$1 $2" >> "${calls}"
if [ "$1 $2" = "notarytool submit" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "--key" ]; then
      echo "$2" > "${keyPath}"
      (stat -c %a "$2" 2>/dev/null || stat -f %Lp "$2") > "${keyMode}"
    fi
    shift
  done
  echo '{"id": "abc", "status": "${status}"}'
fi`,
    );
    const result = spawnSync('bash', [path.join(ROOT, 'scripts/mac-sign-notarize.sh'), 'notarize', '--app', app], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: path.join(dir, 'tmp'),
        APPLE_API_KEY_P8_BASE64: Buffer.from('not a real key').toString('base64'),
        APPLE_API_KEY_ID: 'KEYID',
        APPLE_API_ISSUER_ID: 'ISSUER',
      },
    });
    const callLog = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
    return { result, callLog, mode: fs.readFileSync(keyMode, 'utf8').trim(), keyFileLeft: fs.existsSync(fs.readFileSync(keyPath, 'utf8').trim()) };
  }

  it('staples and succeeds when Apple accepts, and keeps the API key private and short-lived', () => {
    const { result, callLog, mode, keyFileLeft } = runNotarize('Accepted');
    expect(result.status, result.stderr).toBe(0);
    expect(callLog).toContain('stapler staple');
    expect(mode).toBe('600');
    expect(keyFileLeft).toBe(false);
  });

  it('fails without stapling when Apple rejects, and still removes the API key', () => {
    const { result, callLog, keyFileLeft } = runNotarize('Invalid');
    expect(result.status).not.toBe(0);
    expect(callLog).not.toContain('stapler staple');
    expect(keyFileLeft).toBe(false);
  });
});
