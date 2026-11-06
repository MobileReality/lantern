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
      if (mounted) mounted.update(ctx);
      else mounted = mountMacroView(ownHost, ctx);
      showCanvas(false);
    },
    drop,
  };
}

export { createMacroViewStage };
export type { MacroViewStage };
