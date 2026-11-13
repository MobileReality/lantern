import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkOutputs, expectedOutputs, installerOptions, missingOutputs, readManifest, usageText } from '../scripts/build-windows-installer.mjs';

const ROOT = path.resolve(__dirname, '..');
const manifest = { name: 'lantern', version: '1.2.3', description: 'A description', author: { name: 'Mobile Reality', email: 'hello@example.com' } };
let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-installer-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('installerOptions', () => {
  it('takes the metadata from the manifest and ignores the packaged package.json', () => {
    const options = installerOptions(manifest);
    expect(options).toMatchObject({ name: 'lantern', version: '1.2.3', description: 'A description', authors: 'Mobile Reality', usePackageJson: false });
  });

  it('names the setup file and the main executable and points at the repo icon', () => {
    const options = installerOptions(manifest);
    expect(options.setupExe).toBe('Lantern-Setup.exe');
    expect(options.exe).toBe('Lantern.exe');
    expect(fs.existsSync(path.join(ROOT, options.setupIcon))).toBe(true);
  });

  it('accepts a string author', () => {
    expect(installerOptions({ ...manifest, author: 'Someone' }).authors).toBe('Someone');
  });

  it('builds from the real package.json', () => {
    const options = installerOptions(readManifest(ROOT));
    expect(options.name).toBe('lantern');
    expect(options.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('output check', () => {
  it('lists the installer, the index and the full package', () => {
    expect(expectedOutputs(manifest)).toEqual(['Lantern-Setup.exe', 'RELEASES', 'lantern-1.2.3-full.nupkg']);
  });

  it('reports every missing output', () => {
    expect(missingOutputs(manifest, ['RELEASES'])).toEqual(['Lantern-Setup.exe', 'lantern-1.2.3-full.nupkg']);
    expect(missingOutputs(manifest, expectedOutputs(manifest))).toEqual([]);
  });

  it('fails on a folder without the outputs and passes with them', () => {
    expect(() => checkOutputs(manifest, path.join(scratch, 'absent'))).toThrow(/Lantern-Setup\.exe, RELEASES, lantern-1\.2\.3-full\.nupkg/);
    for (const file of expectedOutputs(manifest).slice(0, 2)) fs.writeFileSync(path.join(scratch, file), '');
    expect(() => checkOutputs(manifest, scratch)).toThrow(/lantern-1\.2\.3-full\.nupkg/);
    fs.writeFileSync(path.join(scratch, 'lantern-1.2.3-full.nupkg'), '');
    expect(checkOutputs(manifest, scratch)).toHaveLength(3);
  });
});

describe('usage', () => {
  it('documents the three output names', () => {
    const text = usageText();
    expect(text).toContain('Lantern-Setup.exe');
    expect(text).toContain('RELEASES');
    expect(text).toContain('-full.nupkg');
  });
});
