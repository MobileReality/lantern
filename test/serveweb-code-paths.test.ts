import { describe, expect, it } from 'vitest';
import { codeCandidates, findCodeBin } from '../src/main/serveweb-code-paths';

const HOME = '/home/dev';
const linux = (env: Record<string, string | undefined> = {}) => codeCandidates({ platform: 'linux', home: HOME, env });
const onlyExisting = (file: string) => (candidate: string) => candidate === file;

const LINUX_LOCATIONS = [
  '/usr/bin/code',
  '/snap/bin/code',
  '/usr/share/code/bin/code',
  '/opt/visual-studio-code/bin/code',
  `${HOME}/.local/bin/code`,
  '/var/lib/flatpak/exports/bin/com.visualstudio.code',
  `${HOME}/.local/share/flatpak/exports/bin/com.visualstudio.code`,
  '/opt/custom/bin/code',
];

describe('code lookup on linux', () => {
  it.each(LINUX_LOCATIONS)('finds %s when only it exists', (location) => {
    const candidates = linux({ PATH: '/opt/custom/bin' });
    expect(findCodeBin(candidates, onlyExisting(location))).toBe(location);
  });

  it('prefers the first existing candidate in a fixed order', () => {
    const candidates = linux({ PATH: '/opt/custom/bin' });
    const present = new Set(['/snap/bin/code', '/usr/share/code/bin/code', `${HOME}/.local/bin/code`]);
    expect(findCodeBin(candidates, (file) => present.has(file))).toBe('/snap/bin/code');
  });

  it('puts the deb path ahead of a code on PATH', () => {
    const present = new Set(['/usr/bin/code', '/opt/custom/bin/code']);
    expect(findCodeBin(linux({ PATH: '/opt/custom/bin' }), (file) => present.has(file))).toBe('/usr/bin/code');
  });

  it('lists each candidate once', () => {
    const candidates = linux({ PATH: '/usr/bin:/usr/bin:/snap/bin' });
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('finds nothing when no candidate exists', () => {
    expect(findCodeBin(linux({ PATH: '/opt/custom/bin' }), () => false)).toBeUndefined();
  });

  it('treats a throwing existence check as missing', () => {
    const throwing = (file: string) => {
      if (file === '/usr/bin/code') throw new Error('EACCES');
      return file === '/snap/bin/code';
    };
    expect(findCodeBin(linux(), throwing)).toBe('/snap/bin/code');
  });
});

describe('code lookup off linux', () => {
  const linuxOnly = LINUX_LOCATIONS.filter((file) => file !== '/usr/local/bin/code');

  it('does not consult the linux paths on darwin', () => {
    const candidates = codeCandidates({ platform: 'darwin', home: HOME, env: { PATH: '/opt/custom/bin' } });
    for (const file of linuxOnly) expect(candidates).not.toContain(file);
    expect(candidates).toContain('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
    expect(candidates).toContain('/usr/local/bin/code');
  });

  it('does not consult the linux paths on win32', () => {
    const candidates = codeCandidates({
      platform: 'win32',
      home: 'C:\\Users\\dev',
      env: { PATH: '/opt/custom/bin', ProgramFiles: 'C:\\Program Files' },
    });
    for (const file of linuxOnly) expect(candidates).not.toContain(file);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatch(/Microsoft VS Code/);
  });
});
