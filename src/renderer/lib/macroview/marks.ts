import { SYSTEM_KEY } from '../lanternmacro';
import type { MacroViewContext } from './types';
import type { MacroViewModel } from './model';
import { pairId } from './model';

const BLOCK_PREFIX = 'block:';
const EDGE_SEPARATOR = ' -> ';

interface Tally {
  changed: number;
  total: number;
}

interface Presence {
  areas: ReadonlySet<string>;
  features: ReadonlySet<string>;
  foundation: ReadonlySet<string>;
  files: ReadonlySet<string>;
}

interface MacroViewMarks {
  pr: boolean;
  areas: ReadonlyMap<string, Tally>;
  features: ReadonlyMap<string, Tally>;
  foundation: ReadonlyMap<string, Tally>;
  files: ReadonlySet<string>;
  systems: ReadonlySet<string>;
  featureEdges: ReadonlySet<string>;
  reading: Presence & { file: string | null };
  home: Pick<Presence, 'areas' | 'features'>;
  flow: (Presence & { label: string }) | null;
  plan: (Presence & { label: string; related: ReadonlySet<string> }) | null;
}

const NOTHING: ReadonlySet<string> = new Set();
const NO_PRESENCE: Presence = { areas: NOTHING, features: NOTHING, foundation: NOTHING, files: NOTHING };

function tallies(counts: ReadonlyMap<string, number>, totals: (id: string) => number | null) {
  const out = new Map<string, Tally>();
  for (const [id, changed] of counts) {
    const total = totals(id);
    if (total !== null && changed > 0) out.set(id, { changed, total });
  }
  return out;
}

function presenceOf(model: MacroViewModel, blockByPath: Readonly<Record<string, string>>, paths: readonly string[], ids: readonly string[]): Presence {
  const areas = new Set<string>();
  const features = new Set<string>();
  const foundation = new Set<string>();
  const add = (id: string) => {
    const feature = model.features.get(id);
    if (feature) {
      features.add(id);
      areas.add(feature.areaId);
    } else if (model.areaById.has(id)) areas.add(id);
    else if (model.foundation.some((entry) => entry.id === id)) foundation.add(id);
  };
  for (const path of paths) if (Object.hasOwn(blockByPath, path)) add(blockByPath[path]);
  for (const id of ids) add(id.startsWith(BLOCK_PREFIX) ? id.slice(BLOCK_PREFIX.length) : id);
  return { areas, features, foundation, files: new Set(paths) };
}

function prPart(model: MacroViewModel, pr: MacroViewContext['prMarks']) {
  if (!pr) return { areas: new Map<string, Tally>(), features: new Map<string, Tally>(), foundation: new Map<string, Tally>(), files: NOTHING, systems: NOTHING, featureEdges: NOTHING };
  const perBlock = new Map([...pr.impact.blocks].map(([id, files]) => [id, files.length]));
  const perArea = new Map(model.areas.map((area) => [area.id, area.features.reduce((sum, feature) => sum + (perBlock.get(feature.id) ?? 0), 0)]));
  const files = new Set([...pr.impact.blocks.values()].flatMap((list) => list.map((file) => file.path)));
  const featureEdges = new Set([...pr.impact.edges].map((edge) => edge.split(EDGE_SEPARATOR)).filter((pair) => pair.length === 2).map(([a, b]) => pairId(a, b)));
  return {
    areas: tallies(perArea, (id) => model.areaById.get(id)?.files ?? null),
    features: tallies(perBlock, (id) => model.features.get(id)?.files ?? null),
    foundation: tallies(perBlock, (id) => model.foundation.find((entry) => entry.id === id)?.files ?? null),
    files,
    systems: new Set([...pr.impact.systems].map((system) => `${SYSTEM_KEY}${system}`)),
    featureEdges,
  };
}

function deriveMarks(model: MacroViewModel, ctx: Pick<MacroViewContext, 'prMarks' | 'reading' | 'flowStep' | 'payload' | 'plan'>): MacroViewMarks {
  const { blockByPath } = ctx.payload;
  const plan = ctx.plan ? { ...presenceOf(model, blockByPath, [...ctx.plan.paths], [...ctx.plan.ids]), label: ctx.plan.label, related: ctx.plan.related } : null;
  const readingPaths = ctx.reading.file ? [ctx.reading.file.path] : [];
  const reading = ctx.reading.file || ctx.reading.blocks.size ? presenceOf(model, blockByPath, readingPaths, [...ctx.reading.blocks]) : NO_PRESENCE;
  const flow = ctx.flowStep ? { ...presenceOf(model, blockByPath, [...ctx.flowStep.files], []), label: ctx.flowStep.label } : null;
  const homeKey = ctx.reading.file?.blockKey ? [ctx.reading.file.blockKey] : [];
  const home = ctx.reading.file ? presenceOf(model, blockByPath, readingPaths, homeKey) : NO_PRESENCE;
  return { pr: !!ctx.prMarks, ...prPart(model, ctx.prMarks), reading: { ...reading, file: ctx.reading.file?.path ?? null }, home, flow, plan };
}

function tallyText(tally: Tally) {
  return `${tally.changed} of ${tally.total}`;
}

export { deriveMarks, tallyText };
export type { Presence, Tally, MacroViewMarks };
