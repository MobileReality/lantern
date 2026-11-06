import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { areaSpec } from './lantern-areas-fixtures';
import type { FixtureFile, FixtureSpec } from './lantern-vocab-project';

const SCRIPTS = path.join(__dirname, '..', '..', 'skills', 'lantern-setup', 'scripts');
const CLUSTERS = [
  ['catalog', 'orders', 'gift-cards', 'search'],
  ['payments', 'invoices', 'loyalty', 'refunds'],
  ['shipping', 'returns', 'stock', 'tracking'],
  ['accounts', 'reports', 'reviews', 'notifications'],
];
const FEATURES16 = CLUSTERS.flat();
const EDGES: [string, string, number][] = [
  ['catalog', 'orders', 10], ['orders', 'gift-cards', 6], ['catalog', 'search', 5], ['orders', 'payments', 4],
  ['payments', 'invoices', 9], ['invoices', 'refunds', 5], ['payments', 'loyalty', 3], ['shipping', 'returns', 8],
  ['shipping', 'tracking', 6], ['stock', 'shipping', 5], ['returns', 'refunds', 2], ['accounts', 'reports', 7],
  ['reviews', 'notifications', 6], ['accounts', 'reviews', 2], ['reports', 'invoices', 3], ['notifications', 'orders', 2],
  ['accounts', 'orders', 2], ['loyalty', 'accounts', 1],
];
const TEXTS: Record<string, string> = {
  catalog: 'the products on offer', orders: 'orders placed at checkout', 'gift-cards': 'gift cards bought and spent', search: 'finding products',
  payments: 'taking payment from customers', invoices: 'bills sent to customers', loyalty: 'points earned on purchases', refunds: 'money sent back',
  shipping: 'sending parcels', returns: 'taking parcels back', stock: 'what is on the shelf', tracking: 'where a parcel is',
  accounts: 'who the customers are', reports: 'numbers about sales', reviews: 'what customers wrote', notifications: 'messages sent to customers',
};

const GOOD_AREAS: Record<string, string[]> = {
  'order-handling': ['catalog', 'orders', 'gift-cards', 'search'],
  'money-matters': ['payments', 'invoices', 'refunds', 'loyalty'],
  'delivery-and-returns': ['shipping', 'returns', 'stock', 'tracking'],
  'people-and-insight': ['accounts', 'reports'],
  'customer-voice': ['reviews', 'notifications'],
};
const PURPOSES: Record<string, string> = {
  'order-handling': 'taking orders and following them through checkout',
  'money-matters': 'what customers pay and the money that moves back',
  'delivery-and-returns': 'getting parcels to the door and taking returns back',
  'people-and-insight': 'knowing the people who buy and the insight reports give',
  'customer-voice': 'hearing what customers say and answering them',
  'stock-planning': 'planning what stock the shop keeps on its shelves',
  'store-presence': 'how the store presents itself to visitors',
  'loyalty-programs': 'rewarding loyal customers with points and gifts',
};
const BAD_AREAS: Record<string, string[]> = {
  'frontend-modules': ['catalog', 'search', 'gift-cards', 'accounts', 'reports', 'reviews'],
  'backend-services': ['orders', 'payments', 'invoices', 'refunds', 'shipping', 'stock', 'tracking'],
  'slack-and-teams': ['notifications', 'loyalty'],
  'misc-other': ['returns'],
};
const BAD_PURPOSES: Record<string, string> = {
  'frontend-modules': 'the frontend modules that draw the screens',
  'backend-services': 'the backend services that do the work',
  'slack-and-teams': 'the Slack and Teams bot channels',
  'misc-other': 'everything else, misc and other leftovers',
};

interface Snapshot {
  blocks: { id: string; files: number }[];
  edges: { from: string; to: string; relation_lines: number }[];
  external_systems: { system: string; used_by: Record<string, number> }[];
  platforms: { id: string }[];
  feature_texts: Record<string, string>;
  areas: Record<string, string[]>;
  purposes: Record<string, string>;
}

function snapshot(areas: Record<string, string[]> = GOOD_AREAS, purposes: Record<string, string> = PURPOSES): Snapshot {
  return {
    blocks: [...FEATURES16.map((id) => ({ id, files: 10 })), { id: 'core:service', files: 40 }],
    edges: [...EDGES.map(([from, to, n]) => ({ from, to, relation_lines: n })), { from: 'core:service', to: 'orders', relation_lines: 90 }, { from: 'accounts', to: 'core:service', relation_lines: 70 }],
    external_systems: ['mail-relay', 'object-store', 'payment-gateway', 'slack', 'teams'].map((system) => ({ system, used_by: { 'core:service': 1 } })),
    platforms: ['portal', 'kiosk', 'service'].map((id) => ({ id })),
    feature_texts: TEXTS,
    areas,
    purposes,
  };
}

function withAreas(areas: Record<string, string[]>, purposes: Record<string, string> = PURPOSES, over: Partial<Snapshot> = {}): Snapshot {
  return { ...snapshot(areas, purposes), ...over };
}

const tmpDirs: string[] = [];

function writeInput(input: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-areas-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(input));
  return file;
}

function removeInputs() {
  tmpDirs.splice(0).forEach((dir) => { fs.rmSync(dir, { recursive: true, force: true }); });
}

function runAreas(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, 'areas.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: `${result.stdout}${result.stderr}` };
}

function checkInput(input: unknown, ...flags: string[]) {
  const result = runAreas(['check', '--input', writeInput(input), ...flags]);
  return { ...result, json: result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null };
}

function failedRules(input: unknown) {
  const result = checkInput(input, '--json');
  return { ...result, failed: result.json.failed as string[], reasons: (name: string) => (result.json.rules.find((r: { name: string }) => r.name === name).reasons as string[]) };
}

const COUPLED: [string, string, number, boolean][] = [
  ['catalog', 'orders', 7, true], ['orders', 'payments', 4, false], ['payments', 'invoices', 5, true], ['shipping', 'returns', 3, false],
  ['orders', 'shipping', 2, false], ['accounts', 'reports', 3, true], ['returns', 'payments', 1, false],
];
const COUPLED_FEATURES = ['catalog', 'orders', 'payments', 'invoices', 'shipping', 'returns', 'accounts', 'reports'];
const EXTERNALS: Record<string, string[]> = { orders: ['payment-gateway'], payments: ['payment-gateway'], invoices: ['payment-gateway', 'mail-relay'], shipping: ['mail-relay'], returns: ['mail-relay'], accounts: ['object-store'], reports: ['object-store'] };

function coupledFiles(): FixtureFile[] {
  return COUPLED_FEATURES.flatMap((feature) => {
    const out = COUPLED.filter(([from]) => from === feature);
    const service = out.flatMap(([, to, n]) => Array.from({ length: n }, () => `> service/${to}.ts`));
    const portal = out.filter(([, , , both]) => both).map(([, to]) => `= portal/${to}.ts`);
    return [
      { path: `service/${feature}.ts`, feature, relations: [...service, ...(EXTERNALS[feature] ?? []).map((s) => `> ext:${s}`)] },
      { path: `portal/${feature}.ts`, feature, role: 'page', relations: [...portal, `= service/${feature}.ts`] },
    ];
  });
}

function coupledSpec(tree?: string): FixtureSpec {
  const base = areaSpec(tree ?? '', COUPLED_FEATURES, { files: [...coupledFiles(), { path: 'service/gateway-client.ts', relations: ['> ext:payment-gateway', '> service/orders.ts'] }] });
  return tree === undefined ? { ...base, areas: undefined, areaTexts: undefined } : base;
}

export { BAD_AREAS, BAD_PURPOSES, FEATURES16, GOOD_AREAS, PURPOSES, checkInput, coupledSpec, failedRules, removeInputs, runAreas, snapshot, withAreas, writeInput };
export type { Snapshot };
