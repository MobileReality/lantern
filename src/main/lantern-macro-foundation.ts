import { isFoundationId } from '../shared/lantern-names';
import type { MacroEdge } from './lantern-macro';
import type { ParsedRecord } from './lantern-parse';
import { resolvePlatform } from './lantern-platforms';
import type { PlatformRule } from './lantern-platforms';
import type { Arrow } from './lantern-types';

const TEST_ROLE = 'test';

interface FoundationLink {
  from: string;
  to: string;
  count: number;
  arrows: Record<Arrow, number>;
}

interface PlatformFiles {
  platform: string;
  files: number;
}

interface PlatformUses {
  platform: string;
  count: number;
  arrows: Record<Arrow, number>;
}

const REACHING_ARROWS: ReadonlySet<Arrow> = new Set<Arrow>(['>', '<', '=']);

function foundationLinksOf(edges: readonly MacroEdge[], nodes: ReadonlySet<string>): FoundationLink[] {
  const reachable = (id: string) => isFoundationId(id) || nodes.has(id);
  return edges
    .filter((edge) => (isFoundationId(edge.from) || isFoundationId(edge.to)) && reachable(edge.from) && reachable(edge.to))
    .map(({ from, to, count, arrows }) => ({ from, to, count, arrows }));
}

function byFilesThenPlatform(a: PlatformFiles, b: PlatformFiles) {
  return b.files - a.files || a.platform.localeCompare(b.platform);
}

function platformFilesOf(
  records: readonly ParsedRecord[],
  platforms: PlatformRule[],
  nodeOf: (record: ParsedRecord) => string | null,
): Map<string, PlatformFiles[]> {
  const tally = new Map<string, Map<string, number>>();
  if (platforms.length) {
    for (const record of records) {
      const node = record.role === TEST_ROLE ? null : nodeOf(record);
      if (node === null) continue;
      const platform = resolvePlatform(platforms, record.path);
      const perPlatform = tally.get(node) ?? new Map<string, number>();
      perPlatform.set(platform, (perPlatform.get(platform) ?? 0) + 1);
      tally.set(node, perPlatform);
    }
  }
  return new Map(
    [...tally]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([node, perPlatform]) => [node, [...perPlatform].map(([platform, files]) => ({ platform, files })).sort(byFilesThenPlatform)]),
  );
}

function byCountThenPlatform(a: PlatformUses, b: PlatformUses) {
  return b.count - a.count || a.platform.localeCompare(b.platform);
}

function platformUsesOf(
  records: readonly ParsedRecord[],
  platforms: PlatformRule[],
  nodeOf: (record: ParsedRecord) => string | null,
  held: ReadonlyMap<string, PlatformFiles[]>,
): Map<string, PlatformUses[]> {
  const tally = new Map<string, Map<string, PlatformUses>>();
  if (!platforms.length) return new Map();
  const shipped = records.filter((record) => record.role !== TEST_ROLE);
  const nodeByPath = new Map(shipped.map((record) => [record.path, nodeOf(record)]));
  for (const record of shipped) {
    const platform = resolvePlatform(platforms, record.path);
    for (const relation of record.relations) {
      const target = relation.ext === null && relation.to !== null && REACHING_ARROWS.has(relation.arrow) ? nodeByPath.get(relation.to) : null;
      if (!target || held.get(target)?.some((entry) => entry.platform === platform)) continue;
      const perPlatform = tally.get(target) ?? new Map<string, PlatformUses>();
      const uses = perPlatform.get(platform) ?? { platform, count: 0, arrows: { '>': 0, '<': 0, '=': 0, '@': 0 } };
      uses.count += 1;
      uses.arrows[relation.arrow] += 1;
      perPlatform.set(platform, uses);
      tally.set(target, perPlatform);
    }
  }
  return new Map([...tally].sort(([a], [b]) => a.localeCompare(b)).map(([node, perPlatform]) => [node, [...perPlatform.values()].sort(byCountThenPlatform)]));
}

export { foundationLinksOf, platformFilesOf, platformUsesOf };
export type { FoundationLink, PlatformFiles, PlatformUses };
