import { describe, expect, it } from 'vitest';
import { isPermissionGranted, isServeWebUrl, withMicrophonePolicy } from '../src/main/webview-permissions';

const PORT = 8123;
const SERVE = `http://127.0.0.1:${PORT}/?folder=%2Ftmp%2Fproject`;
const FOREIGN = 'https://evil.example.com/page';

describe('isPermissionGranted', () => {
  it('grants the microphone to the serve-web origin', () => {
    expect(isPermissionGranted('media', PORT, SERVE, `http://127.0.0.1:${PORT}/`)).toBe(true);
    expect(isPermissionGranted('microphone', PORT, SERVE)).toBe(true);
    expect(isPermissionGranted('clipboard-read', PORT, SERVE)).toBe(true);
    expect(isPermissionGranted('notifications', PORT, SERVE)).toBe(true);
  });

  it('refuses the microphone to a foreign origin', () => {
    expect(isPermissionGranted('media', PORT, FOREIGN)).toBe(false);
    expect(isPermissionGranted('microphone', PORT, FOREIGN, FOREIGN)).toBe(false);
    expect(isPermissionGranted('videoCapture', PORT, FOREIGN)).toBe(false);
  });

  it('refuses when either the page or the requesting frame is foreign', () => {
    expect(isPermissionGranted('media', PORT, SERVE, FOREIGN)).toBe(false);
    expect(isPermissionGranted('media', PORT, FOREIGN, SERVE)).toBe(false);
  });

  it('grants a VS Code webview frame only inside a serve-web page', () => {
    const cdn = 'https://0a1b2c.vscode-cdn.net/stable/abc/out/pre/index.html';
    expect(isPermissionGranted('clipboard-read', PORT, SERVE, cdn)).toBe(true);
    expect(isPermissionGranted('clipboard-read', PORT, FOREIGN, cdn)).toBe(false);
    expect(isPermissionGranted('clipboard-read', PORT, SERVE, 'https://vscode-cdn.net.evil.example.com/')).toBe(false);
    expect(isPermissionGranted('clipboard-read', PORT, SERVE, 'http://x.vscode-cdn.net/')).toBe(false);
  });

  it('refuses a missing url, another loopback port, localhost and a lookalike host', () => {
    expect(isPermissionGranted('media', PORT, undefined)).toBe(false);
    expect(isPermissionGranted('media', PORT, '')).toBe(false);
    expect(isPermissionGranted('media', PORT, undefined, SERVE)).toBe(false);
    expect(isPermissionGranted('media', PORT, 'http://127.0.0.1:9999/')).toBe(false);
    expect(isPermissionGranted('media', PORT, `http://localhost:${PORT}/`)).toBe(false);
    expect(isPermissionGranted('media', PORT, `http://127.0.0.1.evil.example.com:${PORT}/`)).toBe(false);
    expect(isPermissionGranted('media', PORT, `https://127.0.0.1:${PORT}/`)).toBe(false);
  });

  it('refuses permissions outside the list even on the serve-web origin', () => {
    expect(isPermissionGranted('geolocation', PORT, SERVE)).toBe(false);
  });
});

describe('isServeWebUrl', () => {
  it('rejects text that is not a url', () => {
    expect(isServeWebUrl('not a url', PORT)).toBe(false);
  });
});

describe('withMicrophonePolicy', () => {
  it('keeps a Permissions-Policy header the server sent', () => {
    const headers = { 'permissions-policy': ['camera=()'], 'content-type': ['text/html'] };
    expect(withMicrophonePolicy(headers, SERVE, PORT)).toEqual(headers);
  });

  it('adds the policy to a serve-web response that has none', () => {
    const out = withMicrophonePolicy({ 'content-type': ['text/html'] }, SERVE, PORT);
    expect(out['Permissions-Policy']).toEqual(['microphone=*, camera=*, display-capture=*']);
  });

  it('never touches a foreign response', () => {
    const headers = { 'permissions-policy': ['microphone=()'] };
    expect(withMicrophonePolicy(headers, FOREIGN, PORT)).toBe(headers);
    expect(withMicrophonePolicy({}, FOREIGN, PORT)).toEqual({});
  });
});
