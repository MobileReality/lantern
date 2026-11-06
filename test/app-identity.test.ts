import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appManifest } from '../scripts/app-manifest.mjs';
import { APP_NAME, userDataDir } from '@shared/app-identity';

const APP_DATA = path.join('/Users/someone', 'Library', 'Application Support');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');

function electronDefaultUserData(appData: string, manifest: { name: string; productName?: string }) {
  return path.join(appData, manifest.productName ?? manifest.name);
}

describe('app identity', () => {
  it('keeps the user-data folder where existing installs have it', () => {
    expect(APP_NAME).toBe('Lantern');
    expect(userDataDir(APP_DATA)).toBe(path.join(APP_DATA, 'Lantern'));
  });

  it('builds a manifest whose default user-data folder is the pinned one', () => {
    const manifest = appManifest('45.0.0');
    expect(manifest.productName).toBe(APP_NAME);
    expect(electronDefaultUserData(APP_DATA, manifest)).toBe(userDataDir(APP_DATA));
  });

  it('pins the user-data folder before the dev profile derives its own from it', () => {
    const pinned = MAIN.indexOf("app.setPath('userData', userDataDir(app.getPath('appData')))");
    expect(pinned).toBeGreaterThan(-1);
    expect(pinned).toBeLessThan(MAIN.indexOf('const INSTANCE ='));
    expect(MAIN).toContain('app.setName(APP_NAME)');
  });

  it('keeps the package name out of the data folder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.name).toBe('lantern');
    expect(appManifest('45.0.0').name).toBe(pkg.name);
  });
});
