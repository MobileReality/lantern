import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const ENTRIES = { main: 'src/main/main.ts', 'preload-workspace': 'src/preload/workspace.ts', 'preload-overlay': 'src/preload/overlay.ts' };

const LOADER = `
const Module = require('node:module');
const stub = () => new Proxy(function () {}, {
  get: (_target, key) => (key === '__esModule' ? true : key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : stub()),
  apply: () => stub(),
  construct: () => stub(),
});
const source = require('node:fs').readFileSync(process.argv[2], 'utf8');
const electron = {};
for (const [, member] of source.matchAll(/\\b(?:import_)?electron\\d*\\.(\\w+)/g)) electron[member] = stub();
for (const [, names] of source.matchAll(/\\{([^}]*)\\}\\s*=\\s*(?:import_)?electron\\d*\\b/g)) {
  for (const name of names.split(',')) if (name.trim()) electron[name.split(':')[0].trim()] = stub();
}
const appValues = { getPath: () => process.env.BUNDLE_USER_DATA, getName: () => 'Lantern', getVersion: () => '0.0.0', isPackaged: false, requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}) };
electron.app = new Proxy({}, { get: (_target, key) => (key in appValues ? appValues[key] : stub()) });
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? electron : load.call(this, request, ...rest);
};
process.exit = () => {};
try {
  require(process.argv[2]);
} catch (error) {
  console.log('LOAD_ERROR ' + (error && error.name) + ': ' + (error && error.message));
}
console.log('LOAD_DONE');
`;

describe('built bundles', () => {
  let dir = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lantern-bundle-'));
    const { default: esbuild } = await import('esbuild');
    const { nodeBundle } = await import('../scripts/node-bundle.mjs');
    for (const [name, entry] of Object.entries(ENTRIES)) {
      await esbuild.build({ ...nodeBundle, logLevel: 'silent', absWorkingDir: ROOT, entryPoints: [entry], outfile: path.join(dir, `${name}.js`) });
    }
    writeFileSync(path.join(dir, 'loader.cjs'), LOADER);
  }, 120_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(Object.keys(ENTRIES))('%s evaluates without a module-load error', (name) => {
    const output = execFileSync(process.execPath, [path.join(dir, 'loader.cjs'), path.join(dir, `${name}.js`)], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', BUNDLE_USER_DATA: path.join(dir, 'user-data') } });
    expect(output).not.toMatch(/LOAD_ERROR/);
    expect(output).toContain('LOAD_DONE');
  });
});
