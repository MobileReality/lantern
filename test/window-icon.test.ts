import { describe, expect, it } from 'vitest';
import { windowIconPath } from '../src/main/window-icon';

describe('windowIconPath', () => {
  it('gives the packaged Linux window the icon shipped in resources', () => {
    expect(windowIconPath('linux', true, '/opt/Lantern/resources', '/opt/Lantern/resources/app')).toBe('/opt/Lantern/resources/icon.png');
  });

  it('gives the Linux window in dev the icon beside the main bundle', () => {
    expect(windowIconPath('linux', false, '/electron/resources', '/repo/out')).toBe('/repo/out/assets/appicon.png');
  });

  it.each(['darwin', 'win32'] as const)('leaves %s windows without an icon of their own', (platform) => {
    expect(windowIconPath(platform, true, '/res', '/main')).toBeUndefined();
    expect(windowIconPath(platform, false, '/res', '/main')).toBeUndefined();
  });
});
