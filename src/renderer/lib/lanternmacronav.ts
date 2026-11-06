import { blockKey } from './lanternmacro';
import { levelAnnouncement } from './lanternmacrocrumbs';
import type { MacroMode } from './lanternmacroview';

interface MacroNavOptions {
  macro: MacroMode;
  main: HTMLElement;
  live: HTMLElement;
  focus: (key: string) => void;
  repaint: () => void;
}

interface MacroNav {
  enter(key: string, byKeyboard?: boolean): boolean;
  leave(): boolean;
  backspace(ev: KeyboardEvent): boolean;
  announce(): void;
  silence(): void;
}

const TYPING = 'input, textarea, select, [contenteditable="true"]';

function createMacroNav({ macro, main, live, focus, repaint }: MacroNavOptions): MacroNav {
  let announced = '';

  function changed(focusKey: string | null) {
    main.scrollTop = 0;
    main.scrollLeft = 0;
    repaint();
    if (focusKey) focus(focusKey);
  }

  function firstCard() {
    return macro.frame().shape?.graph.blocks.find((block) => block.kind === 'feature')?.key ?? null;
  }

  function leave() {
    const left = macro.isOn() ? macro.leave() : null;
    if (left === null) return false;
    changed(blockKey(left));
    return true;
  }

  return {
    enter(key, byKeyboard = false) {
      if (!macro.isOn() || !macro.enter(key)) return false;
      changed(byKeyboard ? firstCard() : null);
      return true;
    },
    leave,
    backspace(ev) {
      if (ev.key !== 'Backspace' || ev.altKey || ev.ctrlKey || ev.metaKey || (ev.target as Element | null)?.closest?.(TYPING) || !leave()) return false;
      ev.preventDefault();
      return true;
    },
    announce() {
      const text = levelAnnouncement(macro.frame().shape?.graph ?? null);
      if (text === announced) return;
      announced = text;
      live.textContent = text;
    },
    silence() {
      announced = '';
      live.textContent = '';
    },
  };
}

export { createMacroNav };
export type { MacroNav };
