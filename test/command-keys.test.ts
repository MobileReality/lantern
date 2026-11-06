import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createCommandKeys } from '../src/main/commands';
import type { KeyBinding, KeyInput } from '../src/shared/commands/keymap';

class FakeContents extends EventEmitter {
  sent: unknown[][] = [];
  constructor(public hostWebContents?: FakeContents) {
    super();
  }
  send(...args: unknown[]) {
    this.sent.push(args);
  }
}

function press(contents: FakeContents, key: string, code: string, mods: Partial<KeyInput> = {}) {
  const preventDefault = vi.fn();
  const input: KeyInput = { type: 'keyDown', key, code, alt: false, shift: false, meta: false, control: false, isAutoRepeat: false, ...mods };
  contents.emit('before-input-event', { preventDefault }, input);
  return preventDefault;
}

function setup(user: KeyBinding[] = [], untrusted: FakeContents[] = []) {
  let bindings = user;
  const keys = createCommandKeys<FakeContents>({
    platform: 'mac',
    bindings: () => bindings,
    isTrusted: (wc) => !untrusted.includes(wc),
  });
  return { keys, setBindings: (next: KeyBinding[]) => (bindings = next) };
}

describe('createCommandKeys', () => {
  it('sends command:run to a trusted host and keeps the key from the page', () => {
    const host = new FakeContents();
    setup().keys.attach(host);
    const prevented = press(host, 'L', 'KeyL', { meta: true, shift: true });
    expect(prevented).toHaveBeenCalled();
    expect(host.sent).toEqual([['command:run', 'lantern.open']]);
  });

  it('runs editor devtools but leaves the key to the menu role that toggles the host devtools', () => {
    const host = new FakeContents();
    setup().keys.attach(host);
    const prevented = press(host, 'i', 'KeyI', { meta: true, alt: true });
    expect(prevented).not.toHaveBeenCalled();
    expect(host.sent).toEqual([['command:run', 'editor.devtools']]);
  });

  it('leaves a miss to the page', () => {
    const host = new FakeContents();
    setup().keys.attach(host);
    const prevented = press(host, 'k', 'KeyK', { meta: true });
    expect(prevented).not.toHaveBeenCalled();
    expect(host.sent).toEqual([]);
  });

  it('leaves every key to the embedded editor', () => {
    const host = new FakeContents();
    const guest = new FakeContents(host);
    setup().keys.attach(guest);
    const prevented = press(guest, 'L', 'KeyL', { meta: true, shift: true });
    expect(prevented).not.toHaveBeenCalled();
    expect(host.sent).toEqual([]);
    expect(guest.sent).toEqual([]);
  });

  it('sends nothing to an untrusted target and leaves it the key', () => {
    const host = new FakeContents();
    setup([], [host]).keys.attach(host);
    const prevented = press(host, ',', 'Comma', { meta: true });
    expect(prevented).not.toHaveBeenCalled();
    expect(host.sent).toEqual([]);
  });

  it('ignores keyUp and auto-repeat', () => {
    const host = new FakeContents();
    setup().keys.attach(host);
    expect(press(host, ',', 'Comma', { meta: true, type: 'keyUp' })).not.toHaveBeenCalled();
    expect(press(host, ',', 'Comma', { meta: true, isAutoRepeat: true })).not.toHaveBeenCalled();
    expect(host.sent).toEqual([]);
  });

  it('picks up user overrides and removals on refresh', () => {
    const host = new FakeContents();
    const { keys, setBindings } = setup();
    keys.attach(host);
    expect(keys.keymap().byKey.get('mod+,')).toBe('settings.open');

    setBindings([
      { key: 'mod+k', command: 'settings.open' },
      { key: 'mod+,', command: '-settings.open' },
    ]);
    expect(keys.keymap().byKey.get('mod+,')).toBe('settings.open');
    keys.refresh();

    expect(press(host, ',', 'Comma', { meta: true })).not.toHaveBeenCalled();
    expect(press(host, 'k', 'KeyK', { meta: true })).toHaveBeenCalled();
    expect(host.sent).toEqual([['command:run', 'settings.open']]);
  });
});
