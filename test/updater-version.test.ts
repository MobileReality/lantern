import { describe, expect, it } from 'vitest';
import { compareVersions, displayVersion, isNewerVersion, parseVersion } from '../src/main/updater/version';

describe('parseVersion', () => {
  it('reads major, minor and patch, with or without a leading v', () => {
    expect(parseVersion('0.3.0')).toEqual({ major: 0, minor: 3, patch: 0, prerelease: [] });
    expect(parseVersion('v12.4.19')).toEqual({ major: 12, minor: 4, patch: 19, prerelease: [] });
  });

  it('reads a pre-release and ignores build metadata', () => {
    expect(parseVersion('1.0.0-rc.1+build.5')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ['rc', '1'] });
  });

  it.each(['', 'latest', '1.2', '1.2.3.4', 'v1.2.x', '1.2.3-', '01.2.3 beta'])('rejects %j', (text) => {
    expect(parseVersion(text)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch, comparing numbers and not text', () => {
    expect(compareVersions('0.3.0', '0.2.2')).toBe(1);
    expect(compareVersions('0.2.2', '0.3.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.3.10', '0.3.9')).toBe(1);
    expect(compareVersions('v0.3.0', '0.3.0')).toBe(0);
  });

  it('puts a pre-release below its release and orders pre-releases by identifier', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
  });

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('answers null when either side is not a version', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', '')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('is true only for a strictly newer version', () => {
    expect(isNewerVersion('v0.3.1', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.2.9', '0.3.0')).toBe(false);
    expect(isNewerVersion('nonsense', '0.3.0')).toBe(false);
  });
});

describe('displayVersion', () => {
  it('drops a leading v', () => {
    expect(displayVersion('v0.3.0')).toBe('0.3.0');
    expect(displayVersion(' 0.3.0 ')).toBe('0.3.0');
  });
});
