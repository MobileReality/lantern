// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformName } from '../src/shared/platform';
import { currentPlatform } from '../src/renderer/lib/util';

afterEach(() => vi.restoreAllMocks());

describe('platform names', () => {
  it('maps the Node platform to the VS Code platform name', () => {
    expect(platformName('darwin')).toBe('mac');
    expect(platformName('win32')).toBe('windows');
    expect(platformName('linux')).toBe('linux');
  });

  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/33', 'mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/33', 'windows'],
    ['Mozilla/5.0 (X11; Linux x86_64) Electron/33', 'linux'],
  ])('reads %s as %s in the page', (agent, expected) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
    expect(currentPlatform()).toBe(expected);
  });
});
