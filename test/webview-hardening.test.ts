import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {} }));
vi.mock('../src/main/bundle', () => ({ installOnOpen: vi.fn() }));
vi.mock('../src/main/settings', () => ({ provider: () => 'claude' }));

import { hardenWebContents, isServeWebUrl, onAttachWebview } from '../src/main/windows';

function attach(src: unknown) {
  const event = { preventDefault: vi.fn() };
  const webPreferences: Record<string, unknown> = { preload: '/x.js', preloadURL: 'file:///x.js', nodeIntegration: true };
  onAttachWebview(event, webPreferences, { src });
  return { event, webPreferences };
}

describe('will-attach-webview', () => {
  it('strips preload and node integration and keeps a serve-web src', () => {
    const { event, webPreferences } = attach('http://127.0.0.1:8123/?folder=%2Ftmp');
    expect(webPreferences.preload).toBeUndefined();
    expect(webPreferences.preloadURL).toBeUndefined();
    expect(webPreferences.nodeIntegration).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example/', 'http://localhost:8123/', 'file:///etc/passwd', 'http://127.0.0.1/', 'not a url', undefined])(
    'rejects src %s',
    (src) => {
      const { event, webPreferences } = attach(src);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(webPreferences.preload).toBeUndefined();
      expect(webPreferences.nodeIntegration).toBe(false);
    },
  );
});

describe('will-navigate', () => {
  function blocked(url: string) {
    const handlers = new Map<string, (...args: never[]) => void>();
    hardenWebContents({ on: (name: string, fn: (...args: never[]) => void) => handlers.set(name, fn) } as never, '/app/renderer');
    const event = { preventDefault: vi.fn() };
    (handlers.get('will-navigate') as (e: unknown, u: string) => void)(event, url);
    return event.preventDefault.mock.calls.length > 0;
  }

  it('allows only the app pages', () => {
    expect(blocked('file:///app/renderer/workspace.html?project=x')).toBe(false);
  });

  it('blocks the serve-web origin and anything else at the top level', () => {
    expect(blocked('http://127.0.0.1:9000/')).toBe(true);
    expect(blocked('https://evil.example/')).toBe(true);
    expect(blocked('file:///etc/passwd')).toBe(true);
    expect(blocked('file:///app/renderer-other/x.html')).toBe(true);
  });

  it('only accepts a loopback http url with a port', () => {
    expect(isServeWebUrl('http://127.0.0.1:1/')).toBe(true);
    expect(isServeWebUrl('https://127.0.0.1:1/')).toBe(false);
  });
});
