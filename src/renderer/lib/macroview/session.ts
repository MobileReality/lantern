import type { MacroViewContext } from './types';
import type { Scene } from './build';
import type { Point } from './camera';
import type { CameraDriver } from './driver';
import type { MacroViewLayout } from './layout';
import type { MacroViewMarks } from './marks';
import type { MacroViewModel } from './model';

interface Session {
  ctx: MacroViewContext;
  model: MacroViewModel;
  layout: MacroViewLayout;
  scene: Scene;
  marks: MacroViewMarks;
  driver: CameraDriver;
  entered: string | null;
  lastFocus: string | null;
  anchor: Point | null;
  framing: 'all' | 'free';
  focusKey: string | null;
  pickedFile: string | null;
  showAll: boolean;
  repaint(): void;
}

export type { Session };
