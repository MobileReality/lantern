import { commandForInput, resolveUserKeymap } from '../../shared/commands/keymap';
import type { KeyBinding, KeyInput, Keymap } from '../../shared/commands/keymap';
import type { PlatformName } from '../../shared/platform';

const SHARED_WITH_MENU = new Set(['editor.devtools']);

export interface CommandTarget {
  send(channel: string, ...args: unknown[]): void;
}

export interface KeyedContents extends CommandTarget {
  hostWebContents?: CommandTarget | null;
  on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: KeyInput) => void): unknown;
}

export interface CommandKeysDeps<T extends CommandTarget> {
  platform: PlatformName;
  bindings: () => readonly KeyBinding[];
  isTrusted: (target: T) => boolean;
}

export function createCommandKeys<T extends CommandTarget>({ platform, bindings, isTrusted }: CommandKeysDeps<T>) {
  let resolved: Keymap | undefined;
  const keymap = () => (resolved ??= resolveUserKeymap(bindings()));

  return {
    refresh() {
      resolved = undefined;
    },
    keymap,
    attach(contents: KeyedContents & T) {
      contents.on('before-input-event', (event, input) => {
        if (contents.hostWebContents) return;
        const id = commandForInput(input, keymap().byKey, platform);
        if (!id || !isTrusted(contents)) return;
        if (!SHARED_WITH_MENU.has(id)) event.preventDefault();
        contents.send('command:run', id);
      });
    },
  };
}
