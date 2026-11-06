import type { MountedMacroView, MacroViewContext } from './types';
import { createMacroView } from './view';

function mountMacroView(host: HTMLElement, ctx: MacroViewContext): MountedMacroView {
  return createMacroView(host, ctx);
}

export { mountMacroView };
