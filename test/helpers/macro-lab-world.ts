import type { LanternArea } from '../../src/main/lantern-areas';
import { MIN_STRONG_EDGE, deriveMacroView } from '../../src/main/lantern-macro';
import { deriveMacroAreas } from '../../src/main/lantern-macro-areas';
import { macroBlocksByPath } from '../../src/main/lantern-macro-files';
import { macroSystemsByPath } from '../../src/main/lantern-macro-systems';
import type { ParsedRecord, ParsedRelation } from '../../src/main/lantern-parse';
import { parsePlatforms } from '../../src/main/lantern-platforms';
import type { Arrow } from '../../src/main/lantern-types';

interface FeatureSpec {
  id: string;
  text: string;
  web: string[];
  api: string[];
  tests: number;
}

const PLATFORM_RULES = 'storefront web web/**\nservice backend api/**\ninfra infra ops/**\norder-bot other bots/orders/**\nhelp-bot other bots/help/**\n';

const INFRA_FILES: [string, string[]][] = [
  ['ops/storefront.image.yml', ['web/shared/Layout.tsx']],
  ['ops/service.image.yml', ['api/shared/config.ts']],
  ['ops/pipeline.yml', ['api/shared/health.ts', 'web/shared/Router.tsx']],
];

const CHAT_FEATURE = { id: 'chat-channels', text: 'talking with shoppers and shop owners in chat' };

const BOT_FILES: [string, string, string | null, [Arrow, string][]][] = [
  ['bots/orders/boot.ts', 'util', null, [['>', 'bots/orders/gateway.ts']]],
  ['bots/orders/gateway.ts', 'controller', CHAT_FEATURE.id, [['>', 'bots/orders/people/lookup.ts'], ['>', 'bots/orders/people/profile.ts'], ['<', 'api/order-history/order-history.controller.ts']]],
  ['bots/orders/people/lookup.ts', 'util', 'sign-in', [['=', 'api/sign-in/sign-in.controller.ts'], ['=', 'api/sign-in/sign-in.service.ts']]],
  ['bots/orders/people/profile.ts', 'util', 'profiles', [['=', 'api/profiles/profiles.controller.ts']]],
  ['bots/help/boot.ts', 'util', null, [['>', 'bots/help/gateway.ts']]],
  ['bots/help/gateway.ts', 'controller', CHAT_FEATURE.id, [['>', 'bots/help/commands.ts'], ['>', 'bots/help/replies.ts'], ['=', 'api/sign-in/sign-in.controller.ts'], ['=', 'api/sign-in/sign-in.service.ts'], ['=', 'api/profiles/profiles.controller.ts'], ['<', 'api/order-history/order-history.controller.ts']]],
  ['bots/help/commands.ts', 'util', CHAT_FEATURE.id, [['=', 'api/sign-in/sign-in.service.ts'], ['=', 'api/profiles/profiles.service.ts']]],
  ['bots/help/replies.ts', 'util', CHAT_FEATURE.id, []],
  ['bots/help/gateway.test.ts', 'test', CHAT_FEATURE.id, [['>', 'bots/help/gateway.ts']]],
];

const WEB_PARTS = ['Page', 'List', 'Card', 'Form', 'Filters', 'Summary', 'Dialog', 'Banner', 'Empty', 'Skeleton', 'Row', 'Toolbar'];
const API_PARTS = ['controller', 'service', 'repository', 'schema', 'mapper', 'validator', 'events', 'queries'];

function spec(id: string, text: string, web: number, api: number, tests: number): FeatureSpec {
  return { id, text, web: WEB_PARTS.slice(0, web), api: API_PARTS.slice(0, api), tests };
}

const FEATURES: FeatureSpec[] = [
  spec('product-listing', 'showing the products of a shop with photos and prices', 12, 8, 5),
  spec('product-search', 'finding products by name, category or producer', 9, 7, 4),
  spec('price-rules', 'prices, discounts and seasonal offers', 6, 8, 6),
  spec('cart', 'collecting products before buying them', 11, 6, 5),
  spec('checkout', 'turning a cart into an order with an address and a slot', 12, 8, 7),
  spec('order-history', 'looking back at past orders and repeating them', 8, 6, 4),
  spec('card-payments', 'paying an order by card', 7, 8, 7),
  spec('refunds', 'returning money for an order or a part of it', 6, 7, 5),
  spec('invoices', 'issuing and sending invoices for paid orders', 5, 8, 4),
  spec('delivery-slots', 'choosing a day and a window for the delivery', 9, 7, 5),
  spec('courier-handoff', 'passing a packed order to a courier', 4, 8, 5),
  spec('stock-levels', 'counting what each shop still has to sell', 5, 8, 6),
  spec('sign-in', 'creating an account and signing in', 8, 7, 5),
  spec('profiles', 'names, addresses and preferences of a customer', 9, 6, 4),
  spec('sales-reports', 'sales per shop, product and week for the owners', 10, 7, 4),
  spec('shop-alerts', 'telling shop owners when stock or orders need attention', 5, 7, 4),
  spec('loyalty-points', 'points earned on orders and spent on discounts', 6, 6, 3),
];

const FOUNDATION_WEB = ['Button', 'Modal', 'Table', 'Icon', 'Layout', 'Toast', 'Theme', 'Router', 'Store', 'Format', 'Http', 'Form-fields', 'Tooltip', 'Tabs', 'Avatar', 'Spinner'];
const FOUNDATION_API = ['config', 'logger', 'database', 'http', 'auth-guard', 'errors', 'queue', 'cache', 'clock', 'ids', 'mailer', 'metrics', 'pagination', 'validation', 'migrations', 'health', 'files', 'retry', 'locks', 'flags'];

const AREAS: LanternArea[] = [
  { id: 'catalog', description: 'what the shops sell and how shoppers find it', features: ['product-listing', 'product-search', 'price-rules'] },
  { id: 'ordering', description: 'turning a shopper\'s choice into an order', features: ['cart', 'checkout', 'order-history'] },
  { id: 'payments', description: 'taking money, giving it back and proving it', features: ['card-payments', 'refunds', 'invoices'] },
  { id: 'fulfilment', description: 'getting a packed order to the door on time', features: ['delivery-slots', 'courier-handoff', 'stock-levels'] },
  { id: 'accounts', description: 'who the customers are and how they get in', features: ['sign-in', 'profiles'] },
  { id: 'insights', description: 'what the shop owners learn from their sales and are told in chat', features: ['sales-reports', 'shop-alerts', 'chat-channels'] },
];

const LINKS: [string, string, number][] = [
  ['product-listing', 'product-search', 14], ['product-listing', 'price-rules', 11], ['product-search', 'price-rules', 5],
  ['cart', 'checkout', 18], ['checkout', 'order-history', 9], ['cart', 'order-history', 4],
  ['card-payments', 'refunds', 12], ['card-payments', 'invoices', 10], ['refunds', 'invoices', 6],
  ['delivery-slots', 'courier-handoff', 13], ['courier-handoff', 'stock-levels', 7], ['delivery-slots', 'stock-levels', 5],
  ['sign-in', 'profiles', 15], ['sales-reports', 'shop-alerts', 8],
  ['cart', 'product-listing', 12], ['cart', 'price-rules', 9], ['checkout', 'card-payments', 16], ['checkout', 'delivery-slots', 13],
  ['checkout', 'profiles', 7], ['card-payments', 'order-history', 5], ['refunds', 'order-history', 8], ['invoices', 'profiles', 4],
  ['courier-handoff', 'order-history', 6], ['stock-levels', 'product-listing', 9], ['stock-levels', 'shop-alerts', 11],
  ['sales-reports', 'order-history', 10], ['sales-reports', 'card-payments', 6], ['sign-in', 'cart', 4], ['profiles', 'delivery-slots', 5],
  ['loyalty-points', 'checkout', 7], ['loyalty-points', 'price-rules', 4], ['loyalty-points', 'profiles', 3],
];

const SYSTEMS: [string, string, number?][] = [
  ['product-listing', 'Object storage', 2], ['product-search', 'Search index'], ['card-payments', 'Card gateway', 3], ['refunds', 'Card gateway'], ['checkout', 'Card gateway'],
  ['invoices', 'Email provider'], ['invoices', 'Object storage'], ['courier-handoff', 'Courier gateway', 2], ['shop-alerts', 'Email provider', 2], ['sign-in', 'Identity provider', 2], ['profiles', 'Identity provider'],
  ['stock-levels', 'PostgreSQL', 3], ['checkout', 'PostgreSQL', 2], ['cart', 'PostgreSQL'], ['sales-reports', 'PostgreSQL', 2], ['delivery-slots', 'PostgreSQL'], ['order-history', 'PostgreSQL'],
];

const FOUNDATION_SYSTEMS: [string, string][] = [['database', 'PostgreSQL'], ['mailer', 'Email provider'], ['files', 'Object storage'], ['cache', 'Search index']];

function relation(arrow: Arrow, to: string | null, ext: string | null = null): ParsedRelation {
  return { arrow, token: to ?? `ext:${ext}`, to, ext, symbol: null, label: '' };
}

function pascal(id: string) {
  return id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
}

function record(path: string, role: string, feature: string | null, relations: ParsedRelation[]): ParsedRecord {
  return { path, marker: '.', owner: null, role, hash: 'lab', purpose: `${path} purpose`, feature, seeAlso: null, seeAlsoNote: '', gotcha: null, relations, file: path.slice(0, path.lastIndexOf('/')) };
}

function pathsOf(feature: FeatureSpec) {
  const web = feature.web.map((part) => `web/${feature.id}/${pascal(feature.id)}${part}.tsx`);
  const api = feature.api.map((part) => `api/${feature.id}/${feature.id}.${part}.ts`);
  const tests = Array.from({ length: feature.tests }, (_, index) => `api/${feature.id}/${feature.id}.${API_PARTS[index % API_PARTS.length]}.test.ts`);
  return { web, api, tests };
}

function roleOfWeb(index: number) {
  return index === 0 ? 'page' : index % 3 === 0 ? 'hook' : 'component';
}

function roleOfApi(part: string) {
  return part.endsWith('controller') ? 'controller' : part.endsWith('repository') ? 'repository' : part.endsWith('schema') ? 'schema' : part.endsWith('service') ? 'service' : 'util';
}

function labRecords(): ParsedRecord[] {
  const groups = new Map(FEATURES.map((feature) => [feature.id, pathsOf(feature)]));
  const shared = { web: FOUNDATION_WEB.map((name) => `web/shared/${name}.tsx`), api: FOUNDATION_API.map((name) => `api/shared/${name}.ts`) };
  const links = new Map<string, ParsedRelation[]>();
  const add = (path: string, next: ParsedRelation) => links.set(path, [...(links.get(path) ?? []), next]);

  for (const feature of FEATURES) {
    const { web, api } = groups.get(feature.id) as ReturnType<typeof pathsOf>;
    web.slice(1).forEach((path, index) => {
      add(web[0], relation('>', path));
      add(path, relation('>', shared.web[(index + feature.id.length) % shared.web.length]));
    });
    api.slice(1).forEach((path, index) => {
      add(api[0], relation('>', path));
      add(path, relation('>', shared.api[(index * 3 + feature.id.length) % shared.api.length]));
    });
    add(web[0], relation('=', api[0]));
  }
  for (const [from, to, count] of LINKS) {
    const [source, target] = [groups.get(from) as ReturnType<typeof pathsOf>, groups.get(to) as ReturnType<typeof pathsOf>];
    const origins = [...source.web, ...source.api];
    const targets = [...target.web, ...target.api];
    for (let i = 0; i < count; i += 1) add(origins[i % origins.length], relation(i % 4 === 3 ? '<' : '>', targets[(i * 2 + 1) % targets.length]));
  }
  for (const [feature, system, files = 1] of SYSTEMS) {
    const { api } = groups.get(feature) as ReturnType<typeof pathsOf>;
    for (let i = 0; i < files; i += 1) add(api[(2 + i) % api.length], relation('@', null, system));
  }
  for (const [name, system] of FOUNDATION_SYSTEMS) add(`api/shared/${name}.ts`, relation('@', null, system));

  const records: ParsedRecord[] = [];
  for (const feature of FEATURES) {
    const { web, api, tests } = groups.get(feature.id) as ReturnType<typeof pathsOf>;
    web.forEach((path, index) => { records.push(record(path, roleOfWeb(index), feature.id, links.get(path) ?? [])); });
    api.forEach((path) => { records.push(record(path, roleOfApi(path.split('.').at(-2) as string), feature.id, links.get(path) ?? [])); });
    tests.forEach((path, index) => { records.push(record(path, 'test', feature.id, [relation('>', api[index % api.length])])); });
  }
  BOT_FILES.forEach(([path, role, feature, targets]) => { records.push(record(path, role, feature, targets.map(([arrow, target]) => relation(arrow, target)))); });
  shared.web.forEach((path) => { records.push(record(path, 'component', null, [])); });
  shared.api.forEach((path) => { records.push(record(path, 'util', null, links.get(path) ?? [])); });
  INFRA_FILES.forEach(([path, targets]) => { records.push(record(path, 'infra', null, targets.map((target) => relation('>', target)))); });
  return records;
}

const PR_REASONS: [string, string][] = [
  ['web/checkout/CheckoutPage.tsx', 'Shows the delivery step before the payment step.'],
  ['web/checkout/CheckoutForm.tsx', 'Carries the chosen slot with the address.'],
  ['api/checkout/checkout.controller.ts', 'Accepts the slot with the order.'],
  ['api/checkout/checkout.service.ts', 'Refuses an order whose slot is gone.'],
  ['web/cart/CartSummary.tsx', 'Adds the slot price to the total.'],
  ['api/cart/cart.service.ts', 'Totals the slot price with the products.'],
  ['web/card-payments/CardPaymentsForm.tsx', 'Charges the total that includes the slot.'],
  ['api/card-payments/card-payments.service.ts', 'Releases the slot only once the payment succeeds.'],
  ['api/card-payments/card-payments.controller.ts', 'Reports a lost slot back to the shopper.'],
  ['web/delivery-slots/DeliverySlotsPage.tsx', 'Lets the shopper pick a day and a window.'],
  ['web/delivery-slots/DeliverySlotsList.tsx', 'Lists the free windows of a day.'],
  ['api/delivery-slots/delivery-slots.service.ts', 'Holds a slot for ten minutes while the shopper pays.'],
  ['api/delivery-slots/delivery-slots.repository.ts', 'Stores the hold next to the slot.'],
];

const PR_FLOW = [
  {
    title: 'A shopper picks when the order arrives',
    steps: [
      { kind: 'actor', text: 'A shopper', files: ['web/checkout/CheckoutPage.tsx'] },
      { kind: 'action', text: 'chooses a delivery slot', files: ['web/delivery-slots/DeliverySlotsPage.tsx', 'web/delivery-slots/DeliverySlotsList.tsx'] },
      { kind: 'subject', text: 'before paying for the order', files: ['web/checkout/CheckoutForm.tsx'] },
    ],
    below: [
      { kind: 'interaction', text: 'sees the price of the slot in the total', files: ['web/cart/CartSummary.tsx', 'api/cart/cart.service.ts'] },
      { kind: 'consequence', old: 'the day was fixed after payment', new: 'the day is chosen before payment', files: ['api/checkout/checkout.service.ts'] },
    ],
  },
  {
    title: 'The shop keeps the slot until the payment clears',
    steps: [
      { kind: 'actor', text: 'The payment service', files: ['api/card-payments/card-payments.service.ts'] },
      { kind: 'action', text: 'confirms or drops the held slot', files: ['api/delivery-slots/delivery-slots.service.ts', 'api/delivery-slots/delivery-slots.repository.ts'] },
      { kind: 'subject', text: 'for the order in progress', files: ['api/checkout/checkout.controller.ts'] },
    ],
    below: [
      { kind: 'consequence', old: 'two shoppers could book the same window', new: 'a window is held for one shopper at a time', files: ['api/delivery-slots/delivery-slots.service.ts'] },
    ],
  },
];

function labPr() {
  return {
    id: '77',
    title: 'Let shoppers pick a delivery slot at checkout',
    files: PR_REASONS.map(([path, reason]) => ({ path, kind: 'modified' as const, reason })),
    flow: PR_FLOW,
  };
}

function labWorld() {
  const records = labRecords();
  const platforms = parsePlatforms(PLATFORM_RULES, []);
  const options = { platforms };
  const declared = new Set([...FEATURES.map((feature) => feature.id), CHAT_FEATURE.id]);
  const derived = deriveMacroAreas(records, platforms, AREAS, declared);
  if (!derived.ok) throw new Error(derived.warning);
  const texts = Object.fromEntries([...FEATURES, CHAT_FEATURE].map((feature) => [feature.id, feature.text]));
  return {
    records,
    platforms: [
      { id: 'storefront', kind: 'web' as const, label: 'Storefront', count: records.filter((r) => r.path.startsWith('web/')).length },
      { id: 'service', kind: 'backend' as const, label: 'Service', count: records.filter((r) => r.path.startsWith('api/')).length },
      { id: 'infra', kind: 'infra' as const, label: 'Infrastructure', count: records.filter((r) => r.path.startsWith('ops/')).length },
      { id: 'order-bot', kind: 'other' as const, label: 'Order bot', count: records.filter((r) => r.path.startsWith('bots/orders/')).length },
      { id: 'help-bot', kind: 'other' as const, label: 'Help bot', count: records.filter((r) => r.path.startsWith('bots/help/')).length },
    ],
    payload: { view: deriveMacroView(records, options), texts, blockByPath: macroBlocksByPath(records, options), systemsByPath: macroSystemsByPath(records), minStrongEdge: MIN_STRONG_EDGE, areas: derived.areas },
    features: [...FEATURES, CHAT_FEATURE].map((feature) => ({ id: feature.id, description: feature.text })),
  };
}

function platformOf(path: string) {
  if (path.startsWith('web/')) return 'storefront';
  if (path.startsWith('bots/orders/')) return 'order-bot';
  if (path.startsWith('bots/help/')) return 'help-bot';
  return path.startsWith('ops/') ? 'infra' : 'service';
}

function labFixtureJson() {
  const world = labWorld();
  return {
    files: world.records.map((r) => [r.path, r.role, r.feature, platformOf(r.path)]),
    relations: world.records.flatMap((r) => r.relations.map((x) => [r.path, x.arrow, x.to, x.ext])),
    features: world.features,
    platforms: world.platforms,
    payload: world.payload,
    pr: labPr(),
  };
}

export { AREAS, FEATURES, labFixtureJson, labPr, labWorld };
