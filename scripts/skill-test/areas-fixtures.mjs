import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_GITIGNORE, writeFiles } from './fixtures.mjs';
import { writeFeatures, writeMapRecords } from './vocab-fixtures.mjs';

export const AREAS_PROJECT_NAME = 'areas-shop';
export const NEW_FEATURE = 'gift-wrapping';
export const NEW_FEATURE_FILE = `src/${NEW_FEATURE}/wrap.mjs`;
const FILES_PER_FEATURE = 10;

export const AREAS_FEATURES = ['catalog', 'orders', 'promotions', 'payments', 'invoices', 'shipping', 'returns', 'inventory', 'accounts', 'reports', 'reviews', 'support'];

export const PURPOSES = {
  'order-handling': 'taking orders and following them through checkout',
  'money-matters': 'what customers pay and the money that moves back',
  'delivery-and-returns': 'getting parcels to the door and taking returns back',
  'people-and-insight': 'knowing the people who buy and the insight reports give',
  'customer-voice': 'hearing what customers say and answering them',
  'stock-planning': 'planning what stock the shop keeps on its shelves',
  'sales-promotions': 'running sales and promotions that bring buyers back',
  'frontend-modules': 'the frontend modules that draw the screens',
  'backend-services': 'the backend services that do the work',
  'misc-other': 'everything else, misc and other leftovers',
};

export const TREES = {
  five: {
    'order-handling': ['catalog', 'orders', 'promotions'],
    'money-matters': ['payments', 'invoices'],
    'delivery-and-returns': ['shipping', 'returns', 'inventory'],
    'people-and-insight': ['accounts', 'reports'],
    'customer-voice': ['reviews', 'support'],
  },
  seven: {
    'order-handling': ['catalog', 'orders'],
    'money-matters': ['payments', 'invoices'],
    'delivery-and-returns': ['shipping', 'returns'],
    'people-and-insight': ['accounts', 'reports'],
    'customer-voice': ['reviews', 'support'],
    'stock-planning': ['inventory'],
    'sales-promotions': ['promotions'],
  },
  layers: {
    'frontend-modules': ['catalog', 'promotions', 'accounts', 'reports', 'reviews', 'support'],
    'backend-services': ['orders', 'payments', 'invoices', 'shipping', 'inventory'],
    'misc-other': ['returns'],
  },
};

const featureOfFile = (rel) => rel.split('/')[1];
const sourceOf = (rel) => `export function handle() {\n  return '${rel}';\n}\n`;

function sourceFiles(features) {
  return features.flatMap((feature) => Array.from({ length: FILES_PER_FEATURE }, (_, i) => `src/${feature}/part-${String(i + 1).padStart(2, '0')}.mjs`));
}

export const treeText = (tree) => `${Object.entries(tree).map(([area, leaves]) => [area, ...leaves.map((leaf) => `  ${leaf}`)].join('\n')).join('\n')}\n`;
export const areaTexts = (tree) => Object.fromEntries(Object.keys(tree).map((area) => [area, PURPOSES[area] ?? `what ${area} groups`]));

export function writeAreas(root, tree) {
  const dir = path.join(root, '.lantern');
  fs.mkdirSync(path.join(dir, 'lang', 'en'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'areas'), treeText(tree));
  fs.writeFileSync(path.join(dir, 'lang', 'en', 'areas.json'), `${JSON.stringify({ text: areaTexts(tree) }, null, 1)}\n`);
}

export function writeAreasMap(root, features) {
  const files = sourceFiles(features.filter((f) => f !== NEW_FEATURE));
  const extra = features.includes(NEW_FEATURE) ? [NEW_FEATURE_FILE] : [];
  const records = [
    { path: 'package.json', role: 'config', purpose: 'Package manifest of the shop' },
    ...[...files, ...extra].map((rel) => ({ path: rel, role: 'service', feature: featureOfFile(rel), purpose: `Handles one step of ${featureOfFile(rel)}` })),
  ];
  writeMapRecords(root, records);
  writeFeatures(root, features);
}

export function createAreasProject(root, { tree = null } = {}) {
  fs.mkdirSync(root, { recursive: true });
  const sources = Object.fromEntries(sourceFiles(AREAS_FEATURES).map((rel) => [rel, sourceOf(rel)]));
  const manifest = `{\n  "name": "${AREAS_PROJECT_NAME}",\n  "private": true,\n  "type": "module"\n}\n`;
  writeFiles(root, { ...sources, 'package.json': manifest, '.gitignore': `${FIXTURE_GITIGNORE.join('\n')}\n` });
  writeAreasMap(root, AREAS_FEATURES);
  if (tree) writeAreas(root, TREES[tree]);
}
