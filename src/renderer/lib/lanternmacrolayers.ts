import type { Layer } from './lanternprofile';
import { FOUNDATION_HEADING } from './lanternmacro';
import type { MacroGraph } from './lanternmacro';

const BAND_LAYER: Layer = { id: 'support', name: FOUNDATION_HEADING, cap: 'plumbing the features sit on', roles: [] };
const STUBS_LAYER: Layer = { id: 'edge', name: 'Other areas', cap: 'press Enter to go there', roles: [] };

function blocksLayer(graph: Pick<MacroGraph, 'level' | 'area'>): Layer {
  if (graph.level === 'areas') return { id: 'domain', name: 'Areas', cap: 'what the product does, one card each', roles: [] };
  if (graph.level === 'area') return { id: 'domain', name: graph.area?.name ?? 'Features', cap: 'the features of this area', roles: [] };
  return { id: 'domain', name: 'Features', cap: 'what the app does, one block each', roles: [] };
}

export { BAND_LAYER, STUBS_LAYER, blocksLayer };
