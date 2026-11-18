import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {} }));
vi.mock('../src/main/bundle', () => ({ installOnOpen: vi.fn() }));
vi.mock('../src/main/settings', () => ({ provider: () => 'claude' }));

import { hardenGuestContents, hardenWebContents, isServeWebUrl, onAttachWebview } from '../src/main/windows';

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

describe('guest navigation on a file drop', () => {
  function guest() {
    const handlers = new Map<string, (...args: never[]) => void>();
    const onBlocked = vi.fn();
    let clock = 0;
    hardenGuestContents({ on: (name: string, fn: (...args: never[]) => void) => handlers.set(name, fn) } as never, onBlocked, () => clock);
    const willFrameNavigate = (url: string) => {
      const event = { preventDefault: vi.fn(), url };
      (handlers.get('will-frame-navigate') as (e: unknown) => void)(event);
      return event.preventDefault;
    };
    return { handlers, willFrameNavigate, onBlocked, advance: (ms: number) => (clock += ms) };
  }

  it('listens to will-frame-navigate only', () => {
    expect([...guest().handlers.keys()]).toEqual(['will-frame-navigate']);
  });

  it('blocks a dropped file from opening in the editor and says so', () => {
    const { willFrameNavigate, onBlocked } = guest();
    expect(willFrameNavigate('file:///Users/me/Desktop/Screenshot.png')).toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('says so again only after a pause', () => {
    const { willFrameNavigate, onBlocked, advance } = guest();
    willFrameNavigate('file:///a.png');
    advance(1000);
    willFrameNavigate('file:///b.png');
    expect(onBlocked).toHaveBeenCalledTimes(1);
    advance(3000);
    willFrameNavigate('file:///c.png');
    expect(onBlocked).toHaveBeenCalledTimes(2);
  });

  it('leaves editor navigation alone', () => {
    const { willFrameNavigate, onBlocked } = guest();
    for (const url of ['http://127.0.0.1:9000/?folder=%2Ftmp', 'https://abc.vscode-cdn.net/index.html', 'about:blank', 'not a url']) {
      expect(willFrameNavigate(url)).not.toHaveBeenCalled();
    }
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
