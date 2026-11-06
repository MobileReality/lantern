import type { FixtureSpec } from './lantern-vocab-project';

const FEATURES = ['catalog', 'orders', 'payments', 'invoices', 'shipping', 'returns', 'accounts', 'reports'];
const PLATFORMS = ['portal web portal/**', 'kiosk web kiosk/**', 'service backend service/**'];
const SYSTEMS = ['mail-relay', 'object-store', 'payment-gateway'];

const VALID_TREE = [
  '# product areas, neutral example',
  'order-handling',
  '  catalog',
  '  orders',
  '',
  'money-matters',
  '  payments',
  '  invoices',
  '',
  'delivery-and-returns',
  '  shipping',
  '  returns',
  'people-and-insight',
  '  accounts',
  '  reports',
  '',
].join('\n');

function topLevelIds(tree: string) {
  return tree.split(/\r?\n/).filter((line) => line && !line.startsWith('#') && !line.startsWith(' ')).map((line) => line.trim());
}

function textsFor(tree: string) {
  return Object.fromEntries(topLevelIds(tree).map((id) => [id, `what ${id} groups, in one sentence`]));
}

function featureFiles(features: string[]) {
  return features.map((feature) => ({ path: `service/${feature}.ts`, feature }));
}

function areaSpec(tree: string, features: string[] = FEATURES, extra: Partial<FixtureSpec> = {}): FixtureSpec {
  return { files: featureFiles(features), features, platforms: PLATFORMS, systems: SYSTEMS, areas: tree, areaTexts: textsFor(tree), ...extra };
}

function numberedFeatures(count: number) {
  return Array.from({ length: count }, (_, i) => `topic-${String(i + 1).padStart(2, '0')}`);
}

function spreadTree(features: string[], areaNames: string[]) {
  const per = Math.ceil(features.length / areaNames.length);
  return `${areaNames.map((name, i) => [name, ...features.slice(i * per, (i + 1) * per).map((f) => `  ${f}`)].join('\n')).join('\n')}\n`;
}

export { FEATURES, VALID_TREE, areaSpec, numberedFeatures, spreadTree, textsFor };
