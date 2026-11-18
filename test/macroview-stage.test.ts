// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { MacroViewContext, MountedMacroView } from '../src/renderer/lib/macroview/types';

const updates: MacroViewContext[] = [];

vi.mock('../src/renderer/lib/macroview/mount', () => ({
  mountMacroView(host: HTMLElement, ctx: MacroViewContext): MountedMacroView {
    const shell = document.createElement('div');
    shell.className = 'mv-shell';
    host.appendChild(shell);
    ctx.enter('area');
    return { update: (next) => updates.push(next), destroy: () => shell.remove() };
  },
}));

const { createMacroViewStage } = await import('../src/renderer/lib/macroview/stage');

describe('macro view stage', () => {
  it('keeps one map when the view enters an area while it is still being mounted', () => {
    const canvasHost = document.createElement('div');
    const ownHost = document.createElement('div');
    const stage = createMacroViewStage({ canvasHost, ownHost });
    const entered = { enter: () => false } as unknown as MacroViewContext;
    const first = {
      enter: () => {
        stage.paint(entered);
        return true;
      },
    } as unknown as MacroViewContext;

    stage.paint(first);

    expect(ownHost.querySelectorAll('.mv-shell')).toHaveLength(1);
    expect(updates).toEqual([entered]);
    expect(canvasHost.hidden).toBe(true);
    expect(ownHost.hidden).toBe(false);
  });
});
