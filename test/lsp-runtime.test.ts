import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLspRuntime, pnpmInvocation } from '../scripts/lsp-runtime.mjs';

let root = '';
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = ''; });

describe('LSP runtime package manager launch', () => {
  it('runs JavaScript CLIs through Node and native binaries directly', () => {
    expect(pnpmInvocation('/tools/pnpm.cjs', ['deploy'])).toEqual({ file: process.execPath, args: ['/tools/pnpm.cjs', 'deploy'] });
    expect(pnpmInvocation('/tools/pnpm', ['deploy'])).toEqual({ file: '/tools/pnpm', args: ['deploy'] });
  });

  it('rejects Windows command shims with an actionable error', () => {
    expect(() => pnpmInvocation('C:\\tools\\pnpm.cmd', ['deploy'])).toThrow('set npm_execpath to pnpm.cjs or the native pnpm executable');
  });
});

describe('LSP runtime build cache', () => {
  function fixture() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-runtime-cache-'));
    for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/lsp-runtime/package.json', 'scripts/lsp-runtime.mjs']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), file);
    }
    const pnpm = path.join(root, 'pnpm.cjs');
    fs.writeFileSync(pnpm, '');
    return { pnpm, out: path.join(root, 'out/lsp-runtime') };
  }

  it('reuses a complete runtime and invalidates it when build inputs change', () => {
    const { pnpm, out } = fixture();
    let deployments = 0;
    const run = (_file: string, args: string[]) => {
      deployments++;
      const app = args.at(-1)!;
      const entry = path.join(app, 'node_modules/@vtsls/language-server/bin/vtsls.js');
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, 'server');
    };
    expect(buildLspRuntime({ root, out, pnpmCli: pnpm, run })).toBe(true);
    expect(buildLspRuntime({ root, out, pnpmCli: pnpm, run })).toBe(false);
    fs.appendFileSync(path.join(root, 'pnpm-lock.yaml'), 'changed');
    expect(buildLspRuntime({ root, out, pnpmCli: pnpm, run })).toBe(true);
    expect(deployments).toBe(2);
  });

  it('deploys hoisted and ships no symlinks, since Windows cannot copy them unprivileged', () => {
    const { pnpm, out } = fixture();
    const run = (_file: string, args: string[]) => {
      expect(args).toContain('--config.node-linker=hoisted');
      const app = args.at(-1)!;
      const entry = path.join(app, 'node_modules/@vtsls/language-server/bin/vtsls.js');
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, 'server');
      fs.mkdirSync(path.join(app, 'node_modules/.bin'));
      fs.symlinkSync('../@vtsls/language-server/bin/vtsls.js', path.join(app, 'node_modules/.bin/vtsls'));
    };
    expect(buildLspRuntime({ root, out, pnpmCli: pnpm, run })).toBe(true);
    const links = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((entry) => entry.isSymbolicLink());
    expect(links).toEqual([]);
  });

  it('does not reuse an incomplete deployment', () => {
    const { pnpm, out } = fixture();
    expect(() => buildLspRuntime({ root, out, pnpmCli: pnpm, run: () => {} })).toThrow('incomplete');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('redeploys when cached metadata omits the required server entry', () => {
    const { pnpm, out } = fixture();
    let deployments = 0;
    const deploy = (_file: string, args: string[]) => {
      deployments++;
      const entry = path.join(args.at(-1)!, 'node_modules/@vtsls/language-server/bin/vtsls.js');
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, 'server');
    };
    buildLspRuntime({ root, out, pnpmCli: pnpm, run: deploy });
    const metadataPath = path.join(out, 'runtime.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, entries: {} }));
    expect(buildLspRuntime({ root, out, pnpmCli: pnpm, run: deploy })).toBe(true);
    expect(deployments).toBe(2);
  });

  it('keeps the previous complete runtime when a refresh fails', () => {
    const { pnpm, out } = fixture();
    const deploy = (_file: string, args: string[]) => {
      const entry = path.join(args.at(-1)!, 'node_modules/@vtsls/language-server/bin/vtsls.js');
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, 'server');
    };
    buildLspRuntime({ root, out, pnpmCli: pnpm, run: deploy });
    const metadata = fs.readFileSync(path.join(out, 'runtime.json'), 'utf8');
    fs.appendFileSync(path.join(root, 'scripts/lsp-runtime.mjs'), 'changed');
    expect(() => buildLspRuntime({ root, out, pnpmCli: pnpm, run: () => {} })).toThrow('incomplete');
    expect(fs.readFileSync(path.join(out, 'runtime.json'), 'utf8')).toBe(metadata);
  });
});
