import type { MacroLoad } from '../../main/lantern-macro-load';
import type { MacroAreas } from '../../main/lantern-macro-areas';
import { macroGraph } from './lanternmacro';
import type { MacroGraph } from './lanternmacro';
import { areaGraph, areasGraph } from './lanternmacroareas';

type MacroPayload = Pick<Extract<MacroLoad, { ok: true }>, 'view' | 'texts' | 'areas' | 'minStrongEdge'>;

function sceneGraph(payload: MacroPayload, areaId: string | null): MacroGraph {
  const { areas, view, texts, minStrongEdge } = payload;
  if (!areas) return macroGraph(view, texts);
  return (areaId ? areaGraph(areas, areaId, view, texts, minStrongEdge) : null) ?? areasGraph(areas, view, minStrongEdge);
}

function reconcileArea(areaId: string | null, areas: MacroAreas | undefined): string | null {
  return areaId !== null && areas && Object.hasOwn(areas.details, areaId) ? areaId : null;
}

export { reconcileArea, sceneGraph };
