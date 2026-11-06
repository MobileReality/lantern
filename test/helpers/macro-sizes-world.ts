import type { LanternArea } from '../../src/main/lantern-areas';
import { MIN_STRONG_EDGE, deriveMacroView } from '../../src/main/lantern-macro';
import { deriveMacroAreas } from '../../src/main/lantern-macro-areas';
import { macroBlocksByPath } from '../../src/main/lantern-macro-files';
import { macroSystemsByPath } from '../../src/main/lantern-macro-systems';
import type { ParsedRecord, ParsedRelation } from '../../src/main/lantern-parse';
import { parsePlatforms } from '../../src/main/lantern-platforms';
import type { Arrow } from '../../src/main/lantern-types';

interface SizeSpec {
  project: string;
  areas: { id: string; description: string; features: [string, number][] }[];
  unplaced: [string, number][];
}

const SMALL: SizeSpec = {
  project: 'Pocket Library',
  areas: [
    { id: 'catalog', description: 'what the library owns and how members find it', features: [['browse', 24], ['search', 18]] },
    { id: 'lending', description: 'taking a book home and bringing it back', features: [['borrow', 28], ['returns', 16]] },
    { id: 'members', description: 'who the members are and how they join', features: [['sign-up', 14], ['profiles', 12]] },
    { id: 'notices', description: 'telling members what is due and what is new', features: [['reminders', 10], ['digests', 8]] },
  ],
  unplaced: [],
};

const LARGE: SizeSpec = {
  project: 'Harbour Freight',
  areas: [
    { id: 'booking', description: 'asking for a place on a ship and getting a confirmation', features: [['quotes', 18], ['bookings', 22], ['amendments', 9], ['waitlists', 6]] },
    { id: 'cargo', description: 'what is in the container and what it needs on the way', features: [['manifests', 16], ['dangerous-goods', 11], ['cold-chain', 8], ['weighing', 5]] },
    { id: 'routes', description: 'which ship goes where and when', features: [['schedules', 14], ['port-calls', 12], ['delays', 7]] },
    { id: 'customs', description: 'the papers every border wants to see', features: [['declarations', 15], ['tariffs', 10], ['inspections', 6], ['holds', 4]] },
    { id: 'billing', description: 'turning a shipment into an invoice and getting paid', features: [['invoices', 13], ['payments', 9], ['credit-notes', 5]] },
    { id: 'tracking', description: 'where a container is right now', features: [['positions', 12], ['milestones', 8], ['alerts', 6]] },
    { id: 'partners', description: 'the carriers, agents and depots we work with', features: [['carriers', 10], ['agents', 7], ['depots', 5]] },
  ],
  unplaced: [],
};

const SYSTEM_NAMES = ['PostgreSQL', 'Email provider', 'Payment gateway', 'Map service'];
const SHARED = ['Button', 'Table', 'Http', 'Auth'];

function relation(arrow: Arrow, to: string | null, ext: string | null = null): ParsedRelation {
  return { arrow, token: to ?? `ext:${ext}`, to, ext, symbol: null, label: '' };
}

function record(path: string, feature: string | null, relations: ParsedRelation[]): ParsedRecord {
  return { path, marker: '.', owner: null, role: 'component', hash: 'size', purpose: `${path} purpose`, feature, seeAlso: null, seeAlsoNote: '', gotcha: null, relations, file: path.slice(0, path.lastIndexOf('/')) };
}

function pascal(id: string) {
  return id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
}

function sizeRecords(spec: SizeSpec): ParsedRecord[] {
  const features = [...spec.areas.flatMap((area) => area.features), ...spec.unplaced];
  const paths = new Map(features.map(([id, files]) => [id, Array.from({ length: files }, (_, index) => `web/${id}/${pascal(id)}${index + 1}.tsx`)]));
  const links = new Map<string, ParsedRelation[]>();
  const add = (path: string, next: ParsedRelation) => links.set(path, [...(links.get(path) ?? []), next]);
  const areaOf = new Map(spec.areas.flatMap((area) => area.features.map(([id]) => [id, area.id] as const)));
  features.forEach(([id], i) => {
    const own = paths.get(id) as string[];
    own.slice(1).forEach((path) => { add(own[0], relation('>', path)); });
    add(own[0], relation('>', `web/shared/${SHARED[i % SHARED.length]}.tsx`));
    if (i % 3 === 0) add(own[own.length - 1], relation('@', null, SYSTEM_NAMES[i % SYSTEM_NAMES.length]));
    features.slice(i + 1).forEach(([other], offset) => {
      const j = i + 1 + offset;
      const pseudo = (i * 7 + j * 13) % 11;
      const same = areaOf.get(id) === areaOf.get(other);
      const count = same ? (pseudo > 2 ? 4 + pseudo : 0) : (i + j) % 5 === 0 ? 2 + Math.floor(pseudo / 2) : 0;
      const target = paths.get(other) as string[];
      for (let n = 0; n < count; n += 1) add(own[n % own.length], relation(n % 4 === 3 ? '<' : '>', target[(n * 2 + 1) % target.length]));
    });
  });
  const records = features.flatMap(([id]) => (paths.get(id) as string[]).map((path) => record(path, id, links.get(path) ?? [])));
  return [...records, ...SHARED.map((name) => record(`web/shared/${name}.tsx`, null, []))];
}

function sizeWorld(spec: SizeSpec) {
  const records = sizeRecords(spec);
  const platforms = parsePlatforms('storefront web web/**\n', []);
  const options = { platforms };
  const areas: LanternArea[] = spec.areas.map((area) => ({ id: area.id, description: area.description, features: area.features.map(([id]) => id) }));
  const declared = new Set([...spec.areas.flatMap((area) => area.features), ...spec.unplaced].map(([id]) => id));
  const derived = deriveMacroAreas(records, platforms, areas, declared);
  if (!derived.ok) throw new Error(derived.warning);
  const texts = Object.fromEntries([...declared].map((id) => [id, `how ${id.replace(/-/g, ' ')} works for the people who use it`]));
  return {
    project: spec.project,
    files: records.map((r) => [r.path, r.role, r.feature, 'storefront']),
    relations: records.flatMap((r) => r.relations.map((x) => [r.path, x.arrow, x.to, x.ext])),
    features: [...declared].map((id) => ({ id, description: texts[id] })),
    platforms: [{ id: 'storefront', kind: 'web' as const, label: 'Storefront', count: records.length }],
    payload: { view: deriveMacroView(records, options), texts, blockByPath: macroBlocksByPath(records, options), systemsByPath: macroSystemsByPath(records), minStrongEdge: MIN_STRONG_EDGE, areas: derived.areas },
  };
}

function sizesFixtureJson() {
  return { small: sizeWorld(SMALL), large: sizeWorld(LARGE) };
}

export { LARGE, SMALL, sizeWorld, sizesFixtureJson };
export type { SizeSpec };
