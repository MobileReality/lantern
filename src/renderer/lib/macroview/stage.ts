import type { MountedMacroView, MacroViewContext } from './types';
import { mountMacroView } from './mount';

interface MacroViewStage {
  paint(ctx: MacroViewContext): void;
  drop(): void;
}

interface StageHosts {
  canvasHost: HTMLElement;
  ownHost: HTMLElement;
}

function createMacroViewStage({ canvasHost, ownHost }: StageHosts): MacroViewStage {
  let mounted: MountedMacroView | null = null;
  let mounting = false;
  let pending: MacroViewContext | null = null;

  function mount(ctx: MacroViewContext) {
    mounting = true;
    try {
      mounted = mountMacroView(ownHost, ctx);
    } finally {
      mounting = false;
    }
    const next = pending;
    pending = null;
    if (next) mounted.update(next);
  }

  function showCanvas(canvas: boolean) {
    canvasHost.hidden = !canvas;
    ownHost.hidden = canvas;
  }

  function drop() {
    mounted?.destroy();
    mounted = null;
    ownHost.replaceChildren();
    showCanvas(true);
  }

  return {
    paint(ctx) {
      if (mounting) {
        pending = ctx;
        return;
      }
      if (mounted) mounted.update(ctx);
      else mount(ctx);
      showCanvas(false);
    },
    drop,
  };
}

export { createMacroViewStage };
export type { MacroViewStage };
