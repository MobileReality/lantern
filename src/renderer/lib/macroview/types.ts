import type { MacroAreas } from '../../../main/lantern-macro-areas';
import type { MacroLoad } from '../../../main/lantern-macro-load';
import type { MacroGraph } from '../lanternmacro';
import type { FoundationFocus } from '../lanternmacrofoundation';
import type { OpenFileBlock } from '../lanternmacrocurrent';
import type { MacroPrView } from '../lanternmacromarks';
import type { PlanFocus } from '../lanternplanfocus';

type MacroLoaded = Extract<MacroLoad, { ok: true }>;

type AreasPayload = Pick<MacroLoaded, 'view' | 'texts' | 'blockByPath' | 'systemsByPath' | 'minStrongEdge'> & { areas: MacroAreas };

interface FlowStepMarks {
  label: string;
  files: ReadonlySet<string>;
}

interface ReadingTarget {
  file: OpenFileBlock | null;
  blocks: ReadonlySet<string>;
}

interface MacroViewContext {
  payload: AreasPayload;
  scene: MacroGraph;
  prMarks: MacroPrView | null;
  plan?: PlanFocus | null;
  reading: ReadingTarget;
  flowStep: FlowStepMarks | null;
  selection: string | null;
  foundation: FoundationFocus | null;
  openFile(path: string): void;
  select(key: string | null): void;
  enter(key: string): boolean;
  leave(): boolean;
}

interface MountedMacroView {
  update(ctx: MacroViewContext): void;
  destroy(): void;
}

export type { AreasPayload, FlowStepMarks, MacroLoaded, MountedMacroView, ReadingTarget, MacroViewContext };
