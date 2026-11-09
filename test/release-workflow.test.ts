import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Job {
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: { push?: { tags?: string[] }; workflow_dispatch?: unknown; [event: string]: unknown };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

const SOURCE = read('.github/workflows/release.yml');
const WORKFLOW = load(SOURCE) as Workflow;
const MAC = WORKFLOW.jobs['build-mac'];
const STEPS = MAC.steps;
const SIGN_SCRIPT = read('scripts/mac-sign-notarize.sh');
const KEYCHAIN_SCRIPT = read('scripts/mac-ci-keychain.sh');
const SECRET_NAMES = [
  'MACOS_CERTIFICATE_P12_BASE64',
  'MACOS_CERTIFICATE_PASSWORD',
  'APPLE_API_KEY_P8_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER_ID',
];
const stepIndex = (predicate: (step: Step) => boolean) => STEPS.findIndex(predicate);
const runsScript = (command: string) => (step: Step) => step.run?.trim() === command;
const usesSecrets = (step: Step) => Object.values(step.env ?? {}).some((value) => value.includes('secrets.'));

describe('release workflow, triggers', () => {
  it('starts only on a v* tag push or by hand, never on a pull request', () => {
    expect(Object.keys(WORKFLOW.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(WORKFLOW.on.push).toEqual({ tags: ['v*'] });
  });

  it('grants read-only contents by default and nothing beyond it to the signing job', () => {
    expect(WORKFLOW.permissions).toEqual({ contents: 'read' });
    expect(MAC.permissions).toEqual({ contents: 'read' });
  });
});

describe('release workflow, build-mac job', () => {
  it('runs in the release environment, the only job that does', () => {
    expect(MAC.environment).toBe('release');
    for (const [name, job] of Object.entries(WORKFLOW.jobs)) if (name !== 'build-mac') expect(job.environment, name).toBeUndefined();
  });

  it('refuses anything but a v* tag before it fetches code or touches a secret', () => {
    const guard = STEPS[0];
    expect(guard.run).toContain('refs/tags/v*');
    expect(guard.run).toMatch(/exit 1/);
    expect(guard.env).toEqual({ REF: '${{ github.ref }}', REF_NAME: '${{ github.ref_name }}', TAG_INPUT: '${{ inputs.tag }}' });
    expect(guard.run).toContain('"$TAG_INPUT" != "$REF_NAME"');
    expect(guard.uses).toBeUndefined();
    expect(STEPS.findIndex(usesSecrets)).toBeGreaterThan(0);
  });

  it('checks out the ref the environment rule judged, not the tag input, and keeps no token in the clone', () => {
    const checkout = STEPS.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toEqual({ ref: '${{ github.ref }}', 'persist-credentials': false });
    expect(SOURCE.slice(SOURCE.indexOf('build-mac:'), SOURCE.indexOf('build-windows:'))).not.toContain('inputs.tag ||');
  });

  it('builds with the package scripts and zips with pack, without dist:share or its ad hoc signature', () => {
    const runs = STEPS.map((step) => step.run?.trim()).filter(Boolean);
    for (const command of ['pnpm install --frozen-lockfile', 'pnpm run build', 'pnpm run fuses', 'pnpm run pack']) expect(runs).toContain(command);
    expect(runs.join('\n')).not.toMatch(/dist:share|sign:adhoc|pnpm run sign|pnpm run dist\b/);
    const order = ['pnpm run build', 'pnpm run fuses', 'bash scripts/mac-sign-notarize.sh sign', 'bash scripts/mac-sign-notarize.sh notarize', 'bash scripts/mac-sign-notarize.sh verify', 'pnpm run pack'].map((command) => stepIndex(runsScript(command)));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('makes the keychain first and deletes it in a last step that runs even after a failure', () => {
    const create = stepIndex(runsScript('bash scripts/mac-ci-keychain.sh create'));
    const sign = stepIndex(runsScript('bash scripts/mac-sign-notarize.sh sign'));
    expect(create).toBeGreaterThan(stepIndex(runsScript('pnpm run fuses')));
    expect(create).toBeLessThan(sign);
    const last = STEPS[STEPS.length - 1];
    expect(last.run?.trim()).toBe('bash scripts/mac-ci-keychain.sh delete');
    expect(last.if).toBe('always()');
  });

  it('uploads the same artifact as before, so releases/latest/download/Lantern-mac.zip stays valid', () => {
    const upload = STEPS.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.with).toMatchObject({ name: 'Lantern-mac', path: 'dist/Lantern-mac.zip', 'if-no-files-found': 'error' });
    expect(stepIndex((step) => step === upload)).toBeGreaterThan(stepIndex(runsScript('pnpm run pack')));
  });

  it('notarizes and staples, then checks the result', () => {
    expect(STEPS.some(runsScript('bash scripts/mac-sign-notarize.sh notarize'))).toBe(true);
    expect(SIGN_SCRIPT).toMatch(/xcrun notarytool submit .*--wait/);
    expect(SIGN_SCRIPT).toContain('xcrun stapler staple');
    expect(SIGN_SCRIPT).toContain('xcrun stapler validate');
    expect(SIGN_SCRIPT).toContain('spctl --assess');
    expect(SIGN_SCRIPT).toContain('codesign --verify --deep --strict');
    expect(SIGN_SCRIPT).toContain('"Accepted"');
  });

  it('signs with the Developer ID identity, hardened runtime and a secure timestamp, from a variable that is no secret', () => {
    expect(MAC.env?.MACOS_SIGNING_IDENTITY).toMatch(/^Developer ID Application: .+ \(D8226MY2E7\)$/);
    expect(SIGN_SCRIPT).toContain('--options runtime');
    expect(SIGN_SCRIPT).toContain('+=(--timestamp)');
    expect(SIGN_SCRIPT).toContain('MACOS_SIGNING_IDENTITY');
    expect(SIGN_SCRIPT).not.toMatch(/--deep.*--sign|--sign.*--deep/);
  });
});

describe('release workflow, secrets', () => {
  it('references each secret once, in the env of the one step that needs it, never in a run line', () => {
    const referenced = [...SOURCE.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
    expect(referenced.sort()).toEqual([...SECRET_NAMES].sort());
    for (const step of STEPS) {
      expect(step.run ?? '', step.name).not.toContain('${{');
      expect(step.with ? JSON.stringify(step.with) : '', step.name).not.toContain('secrets.');
    }
    for (const [name, secrets] of [['bash scripts/mac-ci-keychain.sh create', SECRET_NAMES.slice(0, 2)], ['bash scripts/mac-sign-notarize.sh notarize', SECRET_NAMES.slice(2)]] as const) {
      const step = STEPS.find(runsScript(name));
      expect(Object.keys(step?.env ?? {}).sort(), name).toEqual([...secrets].sort());
    }
  });

  it('never turns on shell tracing or prints a secret in the scripts', () => {
    for (const script of [SIGN_SCRIPT, KEYCHAIN_SCRIPT]) {
      expect(script).not.toMatch(/set -[a-z]*x|xtrace/);
      for (const line of script.split('\n').filter((text) => /\b(echo|cat|printenv)\b/.test(text))) {
        for (const name of SECRET_NAMES) expect(line).not.toContain(name);
        if (line.includes('$password')) expect(line).toContain('::add-mask::');
      }
    }
  });

  it('masks the random keychain password and keeps the key files private and short-lived', () => {
    expect(KEYCHAIN_SCRIPT).toContain('openssl rand');
    expect(KEYCHAIN_SCRIPT).toContain('::add-mask::$password');
    expect(KEYCHAIN_SCRIPT).toContain('security set-key-partition-list');
    expect(KEYCHAIN_SCRIPT).toContain('security delete-keychain');
    expect(KEYCHAIN_SCRIPT).toMatch(/umask 077/);
    expect(SIGN_SCRIPT).toMatch(/umask 077/);
    expect(SIGN_SCRIPT).toContain('chmod 600 "$key_file"');
    expect(SIGN_SCRIPT).toContain('trap cleanup EXIT');
    expect(SIGN_SCRIPT).toContain('rm -rf "$WORK_DIR"');
  });
});

describe('mac entitlements', () => {
  const keysOf = (file: string) => [...read(file).matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);

  it('gives the app JIT plus the devices and Apple events it uses, and its helpers JIT only', () => {
    expect(keysOf('build/entitlements.mac.plist').sort()).toEqual([
      'com.apple.security.automation.apple-events',
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input',
      'com.apple.security.device.camera',
    ]);
    expect(keysOf('build/entitlements.mac.inherit.plist')).toEqual(['com.apple.security.cs.allow-jit']);
  });

  it('weakens nothing further: no library validation or executable memory exception', () => {
    for (const file of ['build/entitlements.mac.plist', 'build/entitlements.mac.inherit.plist']) {
      expect(read(file), file).not.toMatch(/disable-library-validation|allow-unsigned-executable-memory|disable-executable-page-protection|allow-dyld-environment-variables|get-task-allow/);
    }
  });

  it('is applied to the app, its helper apps and the bundled node', () => {
    expect(SIGN_SCRIPT).toContain('--entitlements "$ENTITLEMENTS_APP"');
    expect(SIGN_SCRIPT.match(/--entitlements "\$ENTITLEMENTS_INHERIT"/g)).toHaveLength(2);
    expect(SIGN_SCRIPT).toContain('BUNDLED_NODE="Contents/Resources/lsp-runtime/node"');
  });
});
