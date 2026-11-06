import type { MacroAreas } from '../../src/main/lantern-macro-areas';
import type { MacroEdge, MacroView } from '../../src/main/lantern-macro';
import type { MacroLoad } from '../../src/main/lantern-macro-load';

type Payload = Omit<Extract<MacroLoad, { ok: true }>, 'ok'>;

const AREA_NAMES = ['catalog', 'ordering', 'payments', 'fulfilment', 'accounts', 'insights', 'support'];
const AREA_PURPOSE: Record<string, string> = {
  catalog: 'what the shops sell and how shoppers find it',
  ordering: "turning a shopper's choice into an order",
  payments: 'taking money, giving it back and proving it',
  fulfilment: 'getting a packed order to the door on time',
  accounts: 'who the customers are and how they get in',
  insights: 'what the shop owners learn from their sales',
  support: 'helping shoppers when something goes wrong',
};
const FEATURE_NAMES = [
  'product-listing', 'product-search', 'price-rules', 'reviews', 'cart', 'checkout', 'order-history', 'wishlist',
  'card-payments', 'refunds', 'invoices', 'wallets', 'delivery-slots', 'courier-handoff', 'stock-levels', 'returns',
  'sign-in', 'profiles', 'permissions', 'notifications', 'sales-reports', 'shop-alerts', 'exports', 'audit-log',
];
const PARTS = ['Page', 'List', 'Card', 'Form', 'Filters', 'Summary', 'Dialog', 'Banner', 'Row', 'Toolbar', 'Empty'];
const SYSTEMS = ['PostgreSQL', 'Card gateway', 'Email provider'];

interface MacroViewWorldOptions {
  areas: number;
  features: number;
}

const pascal = (id: string) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
const sum = (numbers: readonly number[]) => numbers.reduce((a, b) => a + b, 0);

function filesOf(feature: string, index: number) {
  const count = 5 + ((index * 3) % 7);
  return Array.from({ length: count }, (_, part) => `${part % 3 === 2 ? 'api' : 'web'}/${feature}/${pascal(feature)}${PARTS[part % PARTS.length]}.tsx`);
}

function edge(from: string, to: string, count: number): MacroEdge {
  return { from, to, count, arrows: { '>': count, '<': 0, '=': 0, '@': 0 }, strong: count >= 8 };
}

function macroViewWorld({ areas, features }: MacroViewWorldOptions): Payload & { paths: string[] } {
  const ids = FEATURE_NAMES.slice(0, features);
  const areaIds = AREA_NAMES.slice(0, areas);
  const groups = areaIds.map((_, at) => ids.filter((_, index) => index % areas === at));
  const files = new Map(ids.map((id, index) => [id, filesOf(id, index)]));
  const blockByPath: Record<string, string> = {};
  for (const [id, list] of files) for (const path of list) blockByPath[path] = id;
  const featureEdges = groups.flatMap((group, at) => [
    ...group.slice(1).map((id, index) => edge(group[index], id, 12 - index)),
    ...(groups[at + 1] ? [edge(group[0], groups[at + 1][0], 6)] : []),
  ]);
  const coreEdges = ids.map((id) => edge(id, 'core:service', 3));
  const sizeOf = (list: readonly string[]) => sum(list.map((id) => (files.get(id) as string[]).length));
  const areaOf = (id: string) => areaIds[ids.indexOf(id) % areas];
  const view: MacroView = {
    recordCount: Object.keys(blockByPath).length + 26,
    testCount: 0,
    blocks: [...ids.map((id) => ({ id, files: (files.get(id) as string[]).length })), { id: 'core:service', files: 14 }, { id: 'core:storefront', files: 12 }],
    edges: [...featureEdges, ...coreEdges],
    crossBlockRelations: featureEdges.length * 7,
    external: SYSTEMS.map((system, at) => ({ system, blocks: ids.filter((_, index) => index % SYSTEMS.length === at).map((block) => ({ block, count: 1 })) })),
  };
  const links = areaIds.slice(1).map((id, at) => ({ from: areaIds[at], to: id, count: 8 + at }));
  const mainLinks = links.map((link) => ({ a: link.from, b: link.to, count: link.count }));
  const details: MacroAreas['details'] = Object.fromEntries(
    areaIds.map((id, at) => [
      id,
      {
        blocks: groups[at].map((feature) => ({ id: feature, files: (files.get(feature) as string[]).length })),
        edges: featureEdges.filter((e) => areaOf(e.from) === id && areaOf(e.to) === id),
        mainLinks: featureEdges.filter((e) => areaOf(e.from) === id && areaOf(e.to) === id).map((e) => ({ a: e.from, b: e.to, count: e.count })),
        stubs: links.filter((link) => link.from === id || link.to === id).map((link) => {
          const other = link.from === id ? link.to : link.from;
          return { id: other, name: other[0].toUpperCase() + other.slice(1), out: link.count, in: 0, count: link.count };
        }),
        foundationLinks: [],
        featurePlatforms: {},
        featureUses: {},
        systems: [],
      },
    ]),
  );
  const level0: MacroAreas['level0'] = {
    areas: areaIds.map((id, at) => ({ id, name: id[0].toUpperCase() + id.slice(1), purpose: AREA_PURPOSE[id], features: groups[at], files: sizeOf(groups[at]), platforms: [], uses: [] })),
    toAssign: null,
    foundation: [{ id: 'core:service', files: 14 }, { id: 'core:storefront', files: 12 }],
    links,
    foundationLinks: [],
    mainLinks,
    systems: {},
  };
  const texts = Object.fromEntries(ids.map((id) => [id, `${id.replaceAll('-', ' ')} for the shops of the market`]));
  return { view, texts, blockByPath, systemsByPath: {}, minStrongEdge: 8, areas: { level0, details }, paths: Object.keys(blockByPath) };
}

export { macroViewWorld };
export type { MacroViewWorldOptions };
