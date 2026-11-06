import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const outputs: string[] = [];

afterEach(() => {
  for (const output of outputs.splice(0)) rmSync(output, { recursive: true, force: true });
});

describe('material file icon build assets', () => {
  it('copies mapped icons and the upstream license for offline use', () => {
    const output = mkdtempSync(path.join(tmpdir(), 'lantern-file-icons-'));
    outputs.push(output);
    const manifestPath = path.resolve('src/renderer/lib/file-icon-manifest.json');
    const before = statSync(manifestPath).mtimeMs;
    execFileSync(process.execPath, [path.resolve('scripts/material-file-icons.mjs'), output]);

    expect(readFileSync(path.join(output, 'typescript.svg'), 'utf8')).toContain('<svg');
    expect(readFileSync(path.join(output, 'nodejs.svg'), 'utf8')).toContain('<svg');
    expect(readFileSync(path.join(output, 'file.svg'), 'utf8')).toContain('<svg');
    expect(readFileSync(path.join(output, 'LICENSE'), 'utf8')).toContain('MIT License');
    expect(statSync(manifestPath).mtimeMs).toBe(before);
  });

  it('accepts a manifest checked out with CRLF line endings', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'lantern-icon-manifest-crlf-')));
    outputs.push(root);
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'src/renderer/lib'), { recursive: true });
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
    const script = path.join(root, 'scripts/material-file-icons.mjs');
    copyFileSync(path.resolve('scripts/material-file-icons.mjs'), script);
    const manifest = readFileSync(path.resolve('src/renderer/lib/file-icon-manifest.json'), 'utf8');
    writeFileSync(path.join(root, 'src/renderer/lib/file-icon-manifest.json'), manifest.replace(/\n/g, '\r\n'));
    const output = path.join(root, 'assets');

    execFileSync(process.execPath, [script, output]);
    expect(readFileSync(path.join(output, 'typescript.svg'), 'utf8')).toContain('<svg');
  });

  it.each(['missing', 'outdated'])('rejects a %s manifest without rewriting it, until explicitly updated', (state) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'lantern-icon-manifest-')));
    outputs.push(root);
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'src/renderer/lib'), { recursive: true });
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
    const script = path.join(root, 'scripts/material-file-icons.mjs');
    copyFileSync(path.resolve('scripts/material-file-icons.mjs'), script);
    const manifestPath = path.join(root, 'src/renderer/lib/file-icon-manifest.json');
    if (state === 'outdated') writeFileSync(manifestPath, '{"stale":true}\n');
    const output = path.join(root, 'assets');

    const result = spawnSync(process.execPath, [script, output], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pnpm icons:update');
    expect(existsSync(output)).toBe(false);
    if (state === 'missing') expect(existsSync(manifestPath)).toBe(false);
    else expect(readFileSync(manifestPath, 'utf8')).toBe('{"stale":true}\n');

    execFileSync(process.execPath, [script, '--update-manifest']);
    expect(readFileSync(manifestPath, 'utf8')).toBe(readFileSync(path.resolve('src/renderer/lib/file-icon-manifest.json'), 'utf8'));
    execFileSync(process.execPath, [script, output]);
    expect(readFileSync(path.join(output, 'typescript.svg'), 'utf8')).toContain('<svg');
  }, 60_000);
});
