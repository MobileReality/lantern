import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addElectronLicences, ELECTRON_TEXTS, packagedLayout, productionPackages, renderProductionLicences, SHIPPED_LICENCE_FILES, writeLicences } from '../scripts/licenses.mjs';

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let scratch: string;

function put(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function installPackage(name: string, version: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  const directory = path.join(scratch, 'store', `${name.replace('/', '+')}@${version}`, 'node_modules', name);
  put(path.join(directory, 'package.json'), JSON.stringify({ name, version, ...manifest }));
  for (const [file, text] of Object.entries(files)) put(path.join(directory, file), text);
  return directory;
}

function listingOf(directories: string[]) {
  return () => JSON.stringify({ any: [{ name: 'ignored', versions: [], paths: directories }] });
}

function fakeProject() {
  const root = path.join(scratch, 'project');
  put(path.join(root, 'LICENSE'), 'MIT License\n\nCopyright (c) Lantern\n');
  put(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n');
  put(path.join(root, 'website', 'src', 'fonts', 'Overpass-OFL.txt'), 'SIL OPEN FONT LICENSE Version 1.1\n');
  return root;
}

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-licences-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('production dependency licences', () => {
  it('reads name, version, licence and every licence file of each package, sorted and without duplicates', () => {
    const marked = installPackage('marked', '18.0.6', { license: 'MIT', homepage: 'https://marked.js.org' }, { LICENSE: 'MIT marked\r\n' });
    const argparse = installPackage('argparse', '2.0.1', { license: 'Python-2.0' }, { LICENSE: 'PSF text\n' });
    const dompurify = installPackage('dompurify', '3.4.17', { license: '(MPL-2.0 OR Apache-2.0)' }, { LICENSE: 'dual licence\n', NOTICE: 'notice text\n' });
    const older = installPackage('vscode-jsonrpc', '8.2.0', { license: 'MIT' }, { 'License.txt': 'old\n' });
    const newer = installPackage('vscode-jsonrpc', '9.0.3', { license: 'MIT' }, { 'License.txt': 'new\n' });
    const packages = productionPackages({ root: scratch, listing: listingOf([newer, marked, dompurify, older, argparse, marked]) });
    expect(packages.map((found) => `${found.name}@${found.version}`)).toEqual(['argparse@2.0.1', 'dompurify@3.4.17', 'marked@18.0.6', 'vscode-jsonrpc@8.2.0', 'vscode-jsonrpc@9.0.3']);
    expect(packages.find((found) => found.name === 'marked')).toMatchObject({ licence: 'MIT', source: 'https://marked.js.org', texts: ['MIT marked'] });
    expect(packages.find((found) => found.name === 'dompurify')?.texts).toEqual(['dual licence', 'notice text']);
  });

  it('keeps the third-party notice files some packages ship beside their licence', () => {
    const jsonrpc = installPackage('vscode-jsonrpc', '8.2.1', { license: 'MIT' }, { 'License.txt': 'MIT\n', 'thirdpartynotices.txt': 'bundled notices\n' });
    const compiler = installPackage('typescript', '5.9.3', { license: 'Apache-2.0' }, { 'LICENSE.txt': 'Apache\n', 'ThirdPartyNoticeText.txt': 'typescript notices\n', 'README.md': 'not a licence\n' });
    const [first, second] = productionPackages({ root: scratch, listing: listingOf([jsonrpc, compiler]) });
    expect(first.texts).toEqual(['Apache', 'typescript notices']);
    expect(second.texts).toEqual(['MIT', 'bundled notices']);
  });

  it('says so when a package ships no licence file, and reads the older licence field shapes', () => {
    const bare = installPackage('bare', '1.0.0', { license: 'MIT', author: { name: 'A. Author' } });
    const typed = installPackage('typed', '2.0.0', { license: { type: 'ISC' } });
    const listed = installPackage('listed', '3.0.0', { licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] });
    const text = renderProductionLicences(productionPackages({ root: scratch, listing: listingOf([bare, typed, listed]) }));
    expect(text).toContain('bare 1.0.0\nLicence: MIT\nAuthor: A. Author');
    expect(text).toContain('This package ships no licence file; its package.json declares MIT.');
    expect(text).toContain('typed 2.0.0\nLicence: ISC');
    expect(text).toContain('listed 3.0.0\nLicence: MIT OR Apache-2.0');
  });

  it('renders the same bytes for the same packages and names no path of the machine', () => {
    const marked = installPackage('marked', '18.0.6', { license: 'MIT' }, { LICENSE: 'MIT marked\n' });
    const shiki = installPackage('shiki', '3.13.0', { license: 'MIT' }, { LICENSE: 'MIT shiki\n' });
    const first = renderProductionLicences(productionPackages({ root: scratch, listing: listingOf([marked, shiki]) }));
    const second = renderProductionLicences(productionPackages({ root: scratch, listing: listingOf([shiki, marked]) }));
    expect(second).toBe(first);
    expect(first).not.toContain(scratch);
    expect(first).toContain('2 packages in the production dependency tree');
  });

  it('writes the licence, the notices, the font licence and the generated dependency licences', () => {
    const root = fakeProject();
    const marked = installPackage('marked', '18.0.6', { license: 'MIT' }, { LICENSE: 'MIT marked\n' });
    const out = path.join(scratch, 'out', 'licenses');
    const written = writeLicences({ root, out, listing: listingOf([marked]) });
    expect(written).toEqual(SHIPPED_LICENCE_FILES);
    expect(fs.readdirSync(out).sort()).toEqual([...SHIPPED_LICENCE_FILES].sort());
    expect(fs.readFileSync(path.join(out, 'LICENSE'), 'utf8')).toContain('Copyright (c) Lantern');
    expect(fs.readFileSync(path.join(out, 'Overpass-OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    expect(fs.readFileSync(path.join(out, 'THIRD_PARTY_LICENSES.txt'), 'utf8')).toContain('marked 18.0.6');
  });

  it('replaces an earlier output instead of leaving stale files', () => {
    const root = fakeProject();
    const out = path.join(scratch, 'out', 'licenses');
    put(path.join(out, 'left-over.txt'), 'stale');
    writeLicences({ root, out, listing: listingOf([]) });
    expect(fs.existsSync(path.join(out, 'left-over.txt'))).toBe(false);
  });

  it.each(['LICENSE', 'THIRD_PARTY_NOTICES.md', path.join('website', 'src', 'fonts', 'Overpass-OFL.txt')])('refuses to build without %s', (missing) => {
    const root = fakeProject();
    fs.rmSync(path.join(root, missing));
    expect(() => writeLicences({ root, out: path.join(scratch, 'out'), listing: listingOf([]) })).toThrow(`${missing} is missing`);
  });

  it('lists the real production dependency tree of this repository with its licence texts', () => {
    const out = path.join(scratch, 'real');
    writeLicences({ root: ROOT, out });
    for (const file of SHIPPED_LICENCE_FILES) expect(fs.statSync(path.join(out, file)).size, file).toBeGreaterThan(500);
    const text = fs.readFileSync(path.join(out, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
    for (const name of ['marked', 'pixi.js', 'shiki', 'js-yaml', 'jsonc-parser', 'vscode-jsonrpc', 'dompurify', 'argparse', 'typescript', 'semver', '@vtsls/language-server']) {
      expect(text, name).toMatch(new RegExp(`^${name.replace(/[.\\/]/g, '\\$&')} \\d`, 'm'));
    }
    expect(text).not.toContain('UNKNOWN');
    expect(text).toContain('Apache License');
    expect(fs.readFileSync(path.join(out, 'Overpass-OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(fs.readFileSync(path.join(out, 'LICENSE'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
  });
});

describe('licences of the packaged app', () => {
  it('puts Electron and Chromium notices beside the generated ones in the app resources', () => {
    const darwin = packagedLayout(path.join(scratch, 'dist'), 'darwin', 'arm64');
    expect(darwin.resources).toBe(path.join(scratch, 'dist', 'Lantern-darwin-arm64', 'Lantern.app', 'Contents', 'Resources'));
    put(path.join(darwin.directory, 'LICENSE'), 'Electron MIT\n');
    put(path.join(darwin.directory, 'LICENSES.chromium.html'), '<html>chromium</html>\n');
    expect(addElectronLicences(darwin)).toEqual(ELECTRON_TEXTS.map((text) => text.to));
    expect(fs.readFileSync(path.join(darwin.resources, 'licenses', 'ELECTRON-LICENSE'), 'utf8')).toBe('Electron MIT\n');
    expect(fs.readFileSync(path.join(darwin.resources, 'licenses', 'LICENSES.chromium.html'), 'utf8')).toContain('chromium');
  });

  it('uses the resources folder of a Windows build', () => {
    expect(packagedLayout('dist', 'win32', 'x64').resources).toBe(path.join('dist', 'Lantern-win32-x64', 'resources'));
  });

  it('uses the resources folder of a Linux build', () => {
    expect(packagedLayout('dist', 'linux', 'x64').resources).toBe(path.join('dist', 'Lantern-linux-x64', 'resources'));
  });

  it('fails when the packager left the Chromium notices out', () => {
    const darwin = packagedLayout(path.join(scratch, 'dist'), 'darwin', 'arm64');
    put(path.join(darwin.directory, 'LICENSE'), 'Electron MIT\n');
    expect(() => addElectronLicences(darwin)).toThrow('LICENSES.chromium.html');
  });
});

describe('THIRD_PARTY_NOTICES.md', () => {
  const NOTICES = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');

  it('points at the font licence files that exist and at the generated dependency licences', () => {
    for (const file of ['Overpass-OFL.txt', 'OverpassMono-OFL.txt']) {
      expect(NOTICES, file).toContain(`website/src/fonts/${file}`);
      expect(fs.existsSync(path.join(ROOT, 'website', 'src', 'fonts', file)), file).toBe(true);
    }
    expect(NOTICES).not.toContain('fonts/OFL.txt');
    expect(NOTICES).not.toContain('are not listed here');
    for (const mention of ['THIRD_PARTY_LICENSES.txt', 'scripts/licenses.mjs', 'Contents/Resources/licenses/']) expect(NOTICES, mention).toContain(mention);
  });

  it('lists the language server runtime packages with the versions and licences of the lockfile', () => {
    const rows = [...NOTICES.matchAll(/^\| `([^`]+)` \| ([\w.-]+) \| ([\w.-]+)/gm)].map(([, name, version, licence]) => ({ name, version, licence }));
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['@vtsls/language-server', '@vtsls/language-service', 'typescript', 'vscode-languageserver', 'semver', 'lru-cache', 'yallist']));
    const locked = productionPackages({ root: ROOT });
    for (const row of rows) {
      const found = locked.find((candidate: { name: string; version: string }) => candidate.name === row.name && candidate.version === row.version);
      expect(found, `${row.name}@${row.version}`).toBeDefined();
      expect(found.licence, row.name).toBe(row.licence);
    }
  });

  it('names Electron, the version that is packaged, and the Chromium notices', () => {
    const electron = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'));
    expect(NOTICES).toContain('## Electron and Chromium');
    expect(NOTICES).toContain(`(version ${electron.version},`);
    expect(NOTICES).toContain('LICENSES.chromium.html');
  });
});

describe('build wiring', () => {
  const ESBUILD = fs.readFileSync(path.join(ROOT, 'scripts', 'esbuild.mjs'), 'utf8');

  it('generates the licence folder in out/ on every compile', () => {
    expect(ESBUILD).toContain("from './licenses.mjs'");
    expect(ESBUILD).toContain('writeLicences({ out: `${OUT}/licenses` })');
  });

  it.each(['build', 'build:win'])('%s ships out/licenses as a resource, keeps it out of the asar and adds the Electron notices', (name) => {
    const script: string = PACKAGE_JSON.scripts[name];
    expect(script).toContain('--extra-resource=out/licenses');
    expect(script).toMatch(/--ignore=\\?['"]\^\/licenses\(\$\|\/\)\\?['"]/);
    expect(script).toContain('node scripts/package-licences.mjs');
    expect(script.indexOf('electron-packager')).toBeLessThan(script.indexOf('package-licences.mjs'));
  });

  it('adds the Electron notices before the macOS bundle is signed or zipped', () => {
    expect(PACKAGE_JSON.scripts.dist).toMatch(/^pnpm run build && .*sign/);
    expect(PACKAGE_JSON.scripts['dist:share']).toMatch(/^pnpm run build && .*pack$/);
  });
});

describe('package.json', () => {
  it('is private, so an accidental npm publish cannot publish the app', () => {
    expect(PACKAGE_JSON.private).toBe(true);
  });

  it('has no main that points at a missing file', () => {
    if (PACKAGE_JSON.main !== undefined) expect(fs.existsSync(path.join(ROOT, PACKAGE_JSON.main)), PACKAGE_JSON.main).toBe(true);
  });
});
