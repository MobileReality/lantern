import { MAP_DIR, dirOf, keyName } from './lantern-parse';
import type { ParsedRecord } from './lantern-parse';
import { langFileFor } from './lantern-texts';
import type { Freshness, LanternNode, LanternRelation } from './lantern-types';

interface TextSource {
  text(file: string, key: string, projectKey: string, inline?: string): string;
}

function buildNodes(records: ParsedRecord[], freshness: Freshness[], store: TextSource, platformOf: (rel: string) => string | null) {
  const nodes: LanternNode[] = [];
  const relations: LanternRelation[] = [];
  records.forEach((rec, i) => {
    const file = langFileFor(rec.file, MAP_DIR);
    const name = keyName(rec.path);
    nodes.push({
      path: rec.path,
      dir: dirOf(rec.path),
      marker: rec.marker,
      owner: rec.owner,
      role: rec.role,
      hash: rec.hash,
      purpose: store.text(file, name, rec.path, rec.purpose),
      freshness: freshness[i],
      feature: rec.feature,
      seeAlso: rec.seeAlso ?? [],
      seeAlsoNote: rec.seeAlso ? store.text(file, `${name} see-also`, `${rec.path} see-also`, rec.seeAlsoNote) : '',
      gotcha: store.text(file, `${name} gotcha`, `${rec.path} gotcha`, rec.gotcha ?? '') || null,
      platform: platformOf(rec.path),
    });
    for (const r of rec.relations) {
      const suffix = ` ${r.arrow} ${r.token}`;
      relations.push({ from: rec.path, arrow: r.arrow, to: r.to, ext: r.ext, symbol: r.symbol, label: store.text(file, `${name}${suffix}`, `${rec.path}${suffix}`, r.label) });
    }
  });
  return { nodes, relations };
}

export { buildNodes };
export type { TextSource };
