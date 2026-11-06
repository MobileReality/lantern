import { TARGET_KIND } from '@skills/lantern-plan/scripts/plan-format.mjs';
import type { LanternRelation } from '@main/lantern';
import type { PlanImpact, PlanTouch } from '@main/lantern-plan-types';

const IMPACT_ORIGIN = { NAMED: 'named', NEW: 'new', DERIVED: 'derived' } as const;

type ImpactOrigin = (typeof IMPACT_ORIGIN)[keyof typeof IMPACT_ORIGIN];

interface ImpactFile {
  path: string;
  origin: ImpactOrigin;
  purpose: string;
}

interface ImpactMap {
  nodes: readonly { path: string }[];
  relations: readonly Pick<LanternRelation, 'from' | 'to'>[];
}

const pathsOfKind = (touches: readonly PlanTouch[], kind: PlanTouch['kind']) => [...new Set(touches.filter((touch) => touch.kind === kind).map((touch) => touch.target))];

function newPurposes(impact: readonly PlanImpact[]): ReadonlyMap<string, string> {
  return new Map(impact.filter((entry) => entry.kind === TARGET_KIND.NEW).map((entry) => [entry.target, entry.reason]));
}

function directNeighbours(named: ReadonlySet<string>, map: ImpactMap): Set<string> {
  const mapped = new Set(map.nodes.map((node) => node.path));
  const found = new Set<string>();
  for (const relation of map.relations) {
    if (!relation.to) continue;
    if (named.has(relation.from) && mapped.has(relation.to)) found.add(relation.to);
    if (named.has(relation.to) && mapped.has(relation.from)) found.add(relation.from);
  }
  return found;
}

function planImpactFiles(touches: readonly PlanTouch[], purposes: ReadonlyMap<string, string>, map: ImpactMap | null): ImpactFile[] {
  const named = pathsOfKind(touches, TARGET_KIND.FILE);
  const fresh = pathsOfKind(touches, TARGET_KIND.NEW).filter((path) => !named.includes(path));
  const taken = new Set([...named, ...fresh]);
  const derived = map ? [...directNeighbours(new Set(named), map)].filter((path) => !taken.has(path)).sort() : [];
  return [
    ...named.map((path): ImpactFile => ({ path, origin: IMPACT_ORIGIN.NAMED, purpose: '' })),
    ...fresh.map((path): ImpactFile => ({ path, origin: IMPACT_ORIGIN.NEW, purpose: purposes.get(path) ?? '' })),
    ...derived.map((path): ImpactFile => ({ path, origin: IMPACT_ORIGIN.DERIVED, purpose: '' })),
  ];
}

export { IMPACT_ORIGIN, newPurposes, planImpactFiles };
export type { ImpactFile, ImpactMap, ImpactOrigin };
