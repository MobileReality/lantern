import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Rel = [target: string, times?: number, arrow?: string];

interface FixtureFile {
  path: string;
  feature?: string;
  role?: string;
  rel?: Rel[];
}

const FEATURES = ['catalog', 'orders', 'search', 'payments', 'invoices', 'shipping', 'returns', 'accounts', 'reports', 'loyalty'];
const PLATFORMS = ['portal web portal/**', 'service backend service/**'].join('\n');

const FILES: FixtureFile[] = [
  { path: 'service/catalog/a.ts', feature: 'catalog', rel: [['service/orders/a.ts', 3], ['ext:search-engine'], ['service/base/util.ts', 2]] },
  { path: 'service/catalog/b.ts', feature: 'catalog', rel: [['service/search/a.ts', 2]] },
  { path: 'service/orders/a.ts', feature: 'orders', rel: [['service/payments/a.ts', 4], ['service/catalog/a.ts'], ['service/base/util.ts', 3]] },
  { path: 'service/orders/b.ts', feature: 'orders', rel: [['ext:mail-relay']] },
  { path: 'service/search/a.ts', feature: 'search', rel: [['service/catalog/a.ts']] },
  { path: 'service/payments/a.ts', feature: 'payments', rel: [['service/invoices/a.ts', 5], ['ext:payment-gateway', 2], ['service/base/util.ts']] },
  { path: 'service/payments/b.ts', feature: 'payments' },
  { path: 'service/invoices/a.ts', feature: 'invoices', rel: [['ext:mail-relay'], ['service/orders/a.ts']] },
  { path: 'service/shipping/a.ts', feature: 'shipping', rel: [['service/orders/a.ts', 2], ['service/returns/a.ts'], ['ext:carrier-api']] },
  { path: 'service/returns/a.ts', feature: 'returns', rel: [['service/payments/a.ts', 2], ['ext:mail-relay']] },
  { path: 'portal/accounts/a.ts', feature: 'accounts', rel: [['service/orders/a.ts'], ['service/shipping/a.ts'], ['portal/shell/app.ts', 2]] },
  { path: 'portal/accounts/b.ts', feature: 'accounts' },
  { path: 'portal/reports/a.ts', feature: 'reports', rel: [['service/orders/a.ts'], ['service/payments/a.ts'], ['ext:object-store']] },
  { path: 'service/loyalty/a.ts', feature: 'loyalty', rel: [['service/orders/a.ts', 2], ['portal/accounts/a.ts']] },
  { path: 'service/base/util.ts', rel: [['ext:object-store']] },
  { path: 'portal/shell/app.ts' },
  { path: 'service/orders/a.test.ts', role: 'test', feature: 'orders', rel: [['service/payments/a.ts', 9]] },
];

const AREAS = [
  'order-handling',
  '  catalog',
  '  orders',
  '  search',
  'money-matters',
  '  payments',
  '  invoices',
  'delivery-and-returns',
  '  shipping',
  '  returns',
  'people-and-insight',
  '  accounts',
  '  reports',
  '',
].join('\n');

const AREA_TEXTS = {
  'order-handling': 'finding products and taking customer orders',
  'money-matters': 'charging customers and sending invoices',
  'delivery-and-returns': 'getting parcels to people and taking them back',
  'people-and-insight': 'customer accounts and the reports about them',
};

function recordOf(file: FixtureFile) {
  const lines = [`${file.path} . ${file.role ?? 'util'} aaaaaaaaaaaa`];
  if (file.feature) lines.push(`#feature ${file.feature}`);
  for (const [target, times = 1, arrow = '>'] of file.rel ?? []) for (let i = 0; i < times; i += 1) lines.push(`  ${arrow} ${target}`);
  return lines.join('\n');
}

function mapText(files: FixtureFile[] = FILES) {
  return ['lantern 1', '# .', '', ...files.map(recordOf), ''].join('\n');
}

function langFile(text: Record<string, string>) {
  return JSON.stringify({ text });
}

function areasProject(extra: Record<string, string | null> = {}, files: FixtureFile[] = FILES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-macro-areas-'));
  const base: Record<string, string | null> = {
    '.lantern/map/.lantern': mapText(files),
    '.lantern/platforms': `${PLATFORMS}\n`,
    '.lantern/features': `${FEATURES.join('\n')}\n`,
    '.lantern/areas': AREAS,
    '.lantern/lang/en/areas.json': langFile(AREA_TEXTS),
    ...extra,
  };
  for (const [name, content] of Object.entries(base)) {
    if (content === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

export { AREAS, AREA_TEXTS, FEATURES, FILES, PLATFORMS, areasProject, mapText };
export type { FixtureFile };
