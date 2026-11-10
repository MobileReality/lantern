import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installMainCapture } from '../src/main/diagnostics/capture';
import { EDITOR_MESSAGE_CHARS, editorConsoleInput, editorLoadFailureInput, isBenignEditorMessage, redactEditorUrl } from '../src/main/diagnostics/editor';
import { createThrottle } from '../src/main/diagnostics/throttle';
import { isQuietEditorEntry } from '../src/shared/diagnostics';
import { makeLogDir, startService } from './helpers/diagnostics-world';

const TOKEN = 'a1b2c3-secret-token';
const EDITOR_URL = `http://127.0.0.1:8123/?tkn=${TOKEN}&folder=%2FUsers%2Fjane%2Fwork%2Fsecret-client`;

function world() {
  const service = startService(makeLogDir());
  const app = new EventEmitter();
  installMainCapture({ proc: new EventEmitter(), app, report: (input) => service.record(input) });
  const host = new EventEmitter();
  const guest = new EventEmitter();
  app.emit('web-contents-created', {}, host);
  app.emit('web-contents-created', {}, guest);
  host.emit('did-attach-webview', {}, guest);
  const baseline = service.listing().entries.length;
  return { service, app, guest, recorded: () => service.listing().entries.slice(baseline) };
}

describe('the connection token in the editor address', () => {
  it('is removed from the address, from a message and from a launch command', () => {
    expect(redactEditorUrl(EDITOR_URL)).not.toContain(TOKEN);
    expect(redactEditorUrl(EDITOR_URL)).toContain('tkn=[redacted]');
    expect(redactEditorUrl(`not a url --connection-token ${TOKEN}`)).not.toContain(TOKEN);
    expect(redactEditorUrl(`/?tkn=${TOKEN}`)).not.toContain(TOKEN);
  });
});

describe('benign editor noise', () => {
  it.each(['ResizeObserver loop completed with undelivered notifications.', 'Uncaught (in promise) Canceled', 'Failed to load resource: net::ERR_ABORTED http://x/y', 'GET http://127.0.0.1:8123/favicon.ico 404'])(
    'drops %s',
    (message) => expect(isBenignEditorMessage(message)).toBe(true),
  );

  it('keeps a real failure', () => {
    expect(isBenignEditorMessage('TypeError: Cannot read properties of undefined')).toBe(false);
  });
});

describe('mapping an editor event to an entry', () => {
  it('maps a console error to an editor warning, capped and without the token', () => {
    const input = editorConsoleInput({ level: 'error', message: `fetch ${EDITOR_URL} failed ${'x'.repeat(2000)}`, sourceId: `http://127.0.0.1:8123/out/main.js?tkn=${TOKEN}`, lineNumber: 7 })!;
    expect(input).toMatchObject({ source: 'editor', severity: 'warning' });
    expect(input.message.length).toBeLessThanOrEqual(EDITOR_MESSAGE_CHARS);
    expect(JSON.stringify(input)).not.toContain(TOKEN);
    expect(input.detail).toContain(':7');
  });

  it('ignores levels below error and benign messages', () => {
    expect(editorConsoleInput({ level: 'warning', message: 'slow' })).toBeNull();
    expect(editorConsoleInput({ level: 'info', message: 'hello' })).toBeNull();
    expect(editorConsoleInput({ level: 'error', message: 'Canceled' })).toBeNull();
  });

  it('maps a load failure to an error and ignores aborted loads and sub-frames', () => {
    expect(editorLoadFailureInput(-3, 'ERR_ABORTED', EDITOR_URL, true)).toBeNull();
    expect(editorLoadFailureInput(-102, 'ERR_CONNECTION_REFUSED', EDITOR_URL, false)).toBeNull();
    const input = editorLoadFailureInput(-102, 'ERR_CONNECTION_REFUSED', EDITOR_URL, true)!;
    expect(input).toMatchObject({ source: 'editor', severity: 'error', message: 'The editor failed to load: ERR_CONNECTION_REFUSED (-102)' });
    expect(JSON.stringify(input)).not.toContain(TOKEN);
  });

  it('treats only quiet editor entries as hidden by default', () => {
    expect(isQuietEditorEntry({ source: 'editor', severity: 'warning' })).toBe(true);
    expect(isQuietEditorEntry({ source: 'editor', severity: 'error' })).toBe(false);
    expect(isQuietEditorEntry({ source: 'main', severity: 'warning' })).toBe(false);
  });
});

describe('capturing the editor webview', () => {
  it('records a console error of the guest as an editor warning with the token redacted', () => {
    const { guest, recorded } = world();
    guest.emit('console-message', { level: 'error', message: `request to ${EDITOR_URL} failed`, lineNumber: 1, sourceId: '' });
    const entry = recorded().at(-1)!;
    expect(entry).toMatchObject({ source: 'editor', severity: 'warning' });
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
    expect(JSON.stringify(entry)).not.toContain('secret-client');
  });

  it('understands the older console-message arguments', () => {
    const { guest, recorded } = world();
    guest.emit('console-message', {}, 3, 'old style failure', 4, 'http://x/main.js');
    expect(recorded().at(-1)).toMatchObject({ source: 'editor', message: 'old style failure' });
  });

  it('records nothing for an aborted load and an error for a refused one', () => {
    const { guest, recorded } = world();
    guest.emit('did-fail-load', {}, -3, 'ERR_ABORTED', EDITOR_URL, true);
    expect(recorded()).toHaveLength(0);
    guest.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', EDITOR_URL, true);
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchObject({ source: 'editor', severity: 'error' });
    expect(JSON.stringify(recorded())).not.toContain(TOKEN);
  });

  it('throttles identical console errors', () => {
    const { guest, recorded } = world();
    for (let i = 0; i < 20; i++) guest.emit('console-message', { level: 'error', message: 'same failure' });
    expect(recorded()).toHaveLength(1);
    guest.emit('console-message', { level: 'error', message: 'another failure' });
    expect(recorded()).toHaveLength(2);
  });

  it('records the editor freezing once, as an error, and not also as a window', () => {
    const { guest, recorded } = world();
    guest.emit('unresponsive');
    guest.emit('responsive');
    expect(recorded().map((e) => [e.source, e.severity, e.message])).toEqual([
      ['editor', 'error', 'The editor stopped responding'],
      ['editor', 'info', 'The editor responds again'],
    ]);
  });

  it('keeps recording an ordinary window that freezes as before', () => {
    const { service, app } = world();
    const other = new EventEmitter();
    app.emit('web-contents-created', {}, other);
    other.emit('unresponsive');
    expect(service.listing().entries.at(-1)).toMatchObject({ source: 'render-process', message: 'A window stopped responding' });
  });
});

describe('the repeat throttle', () => {
  it('allows one identical message per window and lets it through again after', () => {
    let at = 0;
    const throttle = createThrottle({ limit: 1, windowMs: 60_000, now: () => at });
    expect(throttle.allow('k')).toBe(true);
    expect(throttle.allow('k')).toBe(false);
    at = 61_000;
    expect(throttle.allow('k')).toBe(true);
  });
});
