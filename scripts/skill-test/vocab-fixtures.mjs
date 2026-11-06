import fs from 'node:fs';
import path from 'node:path';
import { FORMAT_HEADER, hashFile } from '../../skills/lantern-setup/scripts/lib.mjs';
import { FIXTURE_GITIGNORE, writeFiles } from './fixtures.mjs';

const BROWSER = 'clients/browser';
const KIOSK = 'clients/kiosk';
const RELAY_URL = 'https://mail-relay.example.test/v1/send';

export const CLIENTS_PLATFORMS = `# <id> <kind> <glob>...\nbrowser web ${BROWSER}/**\nkiosk web ${KIOSK}/**\n`;

export const CLIENTS_PROJECT = {
  'package.json': '{\n  "name": "notes-clients",\n  "private": true,\n  "type": "module"\n}\n',
  'shared/note.mjs': "export function makeNote(text) {\n  const body = text.trim();\n  if (!body) throw new Error('a note needs text');\n  return { id: Date.now().toString(36), body };\n}\n",
  [`${BROWSER}/local-store.mjs`]: "const KEY = 'notes';\n\nexport function readAll() {\n  return JSON.parse(localStorage.getItem(KEY) ?? '[]');\n}\n\nexport function writeAll(notes) {\n  localStorage.setItem(KEY, JSON.stringify(notes));\n}\n",
  [`${BROWSER}/save-note.mjs`]: "import { makeNote } from '../../shared/note.mjs';\nimport { readAll, writeAll } from './local-store.mjs';\n\nexport function saveNote(text) {\n  const note = makeNote(text);\n  writeAll([...readAll(), note]);\n  return note;\n}\n",
  [`${BROWSER}/export-notes.mjs`]: `import { readAll } from './local-store.mjs';\n\nexport async function exportNotes(address) {\n  const body = readAll().map((note) => note.body).join('\\n');\n  await fetch('${RELAY_URL}', { method: 'POST', body: JSON.stringify({ to: address, body }) });\n}\n`,
  [`${KIOSK}/touch-keyboard.mjs`]: "export function onKeyTap(buffer, key) {\n  return key === 'backspace' ? buffer.slice(0, -1) : buffer + key;\n}\n",
  [`${KIOSK}/save-note.mjs`]: "import { makeNote } from '../../shared/note.mjs';\n\nexport const queue = [];\n\nexport function saveNote(text) {\n  const note = makeNote(text);\n  queue.push(note);\n  return note;\n}\n",
  [`${KIOSK}/export-notes.mjs`]: `import { queue } from './save-note.mjs';\n\nexport async function exportNotes(address) {\n  const body = queue.map((note) => note.body).join('\\n');\n  await fetch('${RELAY_URL}', { method: 'POST', body: JSON.stringify({ to: address, body }) });\n}\n`,
};

export const CLIENTS_CAPABILITIES = [
  { name: 'saving notes', files: [`${BROWSER}/save-note.mjs`, `${KIOSK}/save-note.mjs`] },
  { name: 'exporting notes', files: [`${BROWSER}/export-notes.mjs`, `${KIOSK}/export-notes.mjs`] },
];
export const CLIENTS_PLUMBING = [`${BROWSER}/local-store.mjs`, `${KIOSK}/touch-keyboard.mjs`];
export const CLIENTS_PLATFORM_IDS = ['browser', 'kiosk'];

export const PLAIN_PROJECT = {
  'package.json': '{\n  "name": "text-tools",\n  "private": true,\n  "type": "module"\n}\n',
  'src/index.mjs': "export { slugify } from './slug.mjs';\nexport { countWords } from './words.mjs';\nexport { truncate } from './truncate.mjs';\n",
  'src/slug.mjs': "export function slugify(text) {\n  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n}\n",
  'src/words.mjs': "export function countWords(text) {\n  return text.split(/\\s+/).filter(Boolean).length;\n}\n",
  'src/truncate.mjs': "export function truncate(text, max) {\n  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;\n}\n",
  'test/slug.test.mjs': "import assert from 'node:assert/strict';\nimport { slugify } from '../src/slug.mjs';\n\nassert.equal(slugify('Hello, World'), 'hello-world');\n",
};

export const UNTIDY_PROJECT = {
  'package.json': '{\n  "name": "small-shop",\n  "private": true,\n  "type": "module"\n}\n',
  'src/index.mjs': "import { charge } from './checkout.mjs';\nimport { sendReceipt } from './receipts.mjs';\n\nexport async function placeOrder(order) {\n  await charge(order);\n  await sendReceipt(order);\n}\n",
  'src/checkout.mjs': "export async function charge(order) {\n  await fetch('https://pay.acmepay.example.test/v2/charges', { method: 'POST', body: JSON.stringify(order) });\n}\n",
  'src/refunds.mjs': "export async function refund(chargeId) {\n  await fetch(`https://pay.acmepay.example.test/v2/charges/${chargeId}/refund`, { method: 'POST' });\n}\n",
  'src/receipts.mjs': "import { formatDate } from './format-date.mjs';\n\nexport async function sendReceipt(order) {\n  const text = `Receipt for ${order.id}, ${formatDate(order.at)}`;\n  await fetch('https://mail-relay.example.test/v1/send', { method: 'POST', body: JSON.stringify({ to: order.email, text }) });\n}\n",
  'src/reminders.mjs': "export async function remind(email, text) {\n  await fetch('https://api.mail-relay.example.test/send', { method: 'POST', body: JSON.stringify({ to: email, text }) });\n}\n",
  'src/format-date.mjs': "import dayjs from 'dayjs';\n\nexport function formatDate(at) {\n  return dayjs(at).format('YYYY-MM-DD');\n}\n",
  'src/catalog.mjs': "const ITEMS = [{ sku: 'a-1', name: 'Mug' }];\n\nexport function findItem(sku) {\n  return ITEMS.find((item) => item.sku === sku);\n}\n",
};

export const UNTIDY_FEATURES = ['acmepay', 'catalog', 'receipts'];
export const UNTIDY_RECORDS = [
  { path: 'package.json', role: 'config', purpose: 'Package manifest of the shop' },
  { path: 'src/index.mjs', role: 'entry', purpose: 'Places an order: charges it, then sends the receipt', relations: ['> src/checkout.mjs', '> src/receipts.mjs'] },
  { path: 'src/checkout.mjs', role: 'service', purpose: 'Charges a customer for an order through the payment provider', feature: 'acmepay', relations: ['> ext:acmepay-api'] },
  { path: 'src/refunds.mjs', role: 'service', purpose: 'Refunds a charge through the payment provider', feature: 'acmepay', relations: ['> ext:acmepay-api'] },
  { path: 'src/receipts.mjs', role: 'service', purpose: 'Emails the customer a receipt for an order', feature: 'receipts', relations: ['< src/format-date.mjs', '> ext:mail-relay'] },
  { path: 'src/reminders.mjs', role: 'service', purpose: 'Emails a customer a reminder text', feature: 'receipts', relations: ['> ext:mail-relay-api'] },
  { path: 'src/format-date.mjs', role: 'util', purpose: 'Formats an order date as YYYY-MM-DD', relations: ['< ext:dayjs.js'] },
  { path: 'src/catalog.mjs', role: 'service', purpose: 'Looks up a catalog item by sku', feature: 'catalog' },
];

function writeLantern(root, rel, text) {
  const file = path.join(root, '.lantern', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const json = (text) => `${JSON.stringify({ text }, null, 1)}\n`;

function recordLines(root, record) {
  const note = record.feature ? [`#feature ${record.feature}`] : [];
  return [`${record.path} . ${record.role} ${hashFile(root, record.path)}`, ...note, ...(record.relations ?? []).map((relation) => `  ${relation}`)];
}

export function writeMapRecords(root, records, purposeOf = (record) => record.purpose ?? `Fixture file ${path.posix.basename(record.path)}`) {
  const byMapFile = new Map();
  for (const record of records) {
    const dir = path.posix.dirname(record.path);
    byMapFile.set(dir, [...(byMapFile.get(dir) ?? []), record]);
  }
  for (const [dir, list] of byMapFile) {
    const sorted = [...list].sort((a, b) => (a.path < b.path ? -1 : 1));
    const mapName = dir === '.' ? '.lantern' : `${dir}.lantern`;
    writeLantern(root, `map/${mapName}`, `${[FORMAT_HEADER, `# ${dir}`, '', ...sorted.flatMap((r) => recordLines(root, r))].join('\n')}\n`);
    writeLantern(root, `lang/en/${mapName}.json`, json(Object.fromEntries(sorted.map((r) => [path.posix.basename(r.path), purposeOf(r)]))));
  }
}

export function writeFeatures(root, ids) {
  writeLantern(root, 'features', `${ids.join('\n')}\n`);
  writeLantern(root, 'lang/en/features.json', json(Object.fromEntries(ids.map((id) => [id, `what ${id} covers`]))));
}

function createProject(root, files) {
  fs.mkdirSync(root, { recursive: true });
  writeFiles(root, { ...files, '.gitignore': `${FIXTURE_GITIGNORE.join('\n')}\n` });
}

export function createClientsProject(root) {
  createProject(root, CLIENTS_PROJECT);
  writeLantern(root, 'platforms', CLIENTS_PLATFORMS);
}

export const createPlainProject = (root) => createProject(root, PLAIN_PROJECT);

export function createUntidyProject(root) {
  createProject(root, UNTIDY_PROJECT);
  writeMapRecords(root, UNTIDY_RECORDS);
  writeFeatures(root, UNTIDY_FEATURES);
}

const SHELF = 'shelf';
const COUNTER = 'counter';
export const SIBLING_PLATFORMS = `# <id> <kind> <glob>...\n${SHELF} web ${SHELF}/**\n${COUNTER} web ${COUNTER}/**\n`;
export const SIBLING_FEATURES = ['browsing', 'cart', 'checkout', 'search', 'wishlist'];

const CAPABILITIES = [
  { name: 'browse-list', feature: 'browsing', purpose: 'Lists the products of a category for the shopper' },
  { name: 'browse-detail', feature: 'browsing', purpose: 'Shows one product with its photos and price' },
  { name: 'cart-add', feature: 'cart', purpose: 'Adds a product to the shopping cart' },
  { name: 'cart-remove', feature: 'cart', purpose: 'Removes a product from the shopping cart' },
  { name: 'checkout-pay', feature: 'checkout', purpose: 'Takes the payment for the cart contents' },
  { name: 'checkout-receipt', feature: 'checkout', purpose: 'Shows the shopper a receipt after paying' },
  { name: 'search-query', feature: 'search', purpose: 'Finds products matching words the shopper types' },
  { name: 'search-filter', feature: 'search', purpose: 'Narrows search results by price or brand' },
  { name: 'wishlist-add', feature: 'wishlist', purpose: 'Saves a product to the shopper wishlist' },
  { name: 'wishlist-share', feature: 'wishlist', purpose: 'Sends the wishlist to a friend as a link' },
];
const COUNTER_TAGGED = CAPABILITIES.slice(0, 6).map((c) => c.name);
const COUNTER_PLUMBING = [
  { name: 'touch-keyboard', role: 'util', purpose: 'Turns key taps on the counter screen into text' },
  { name: 'idle-timer', role: 'util', purpose: 'Resets the counter screen after a minute without taps' },
  { name: 'screen-layout', role: 'component', purpose: 'Lays out the counter screen frame shared by every view' },
  { name: 'session-store', role: 'repository', purpose: 'Keeps the current counter session in memory' },
  { name: 'device-lock', role: 'service', purpose: 'Locks the counter device after hours' },
  { name: 'tap-log', role: 'util', purpose: 'Writes screen taps to the local debug log' },
];

export const SIBLING_TWINS = CAPABILITIES.slice(6).map((c) => ({ counter: `${COUNTER}/${c.name}.mjs`, shelf: `${SHELF}/${c.name}.mjs`, feature: c.feature }));
export const SIBLING_PLUMBING = COUNTER_PLUMBING.map((p) => `${COUNTER}/${p.name}.mjs`);

const moduleSource = (name) => `export function ${name.replace(/-(\w)/g, (_, c) => c.toUpperCase())}(input) {\n  return { handled: '${name}', input };\n}\n`;

export const SIBLING_PROJECT = {
  'package.json': '{\n  "name": "sibling-shops",\n  "private": true,\n  "type": "module"\n}\n',
  ...Object.fromEntries(CAPABILITIES.flatMap((c) => [[`${SHELF}/${c.name}.mjs`, moduleSource(c.name)], [`${COUNTER}/${c.name}.mjs`, moduleSource(c.name)]])),
  [`${SHELF}/format-price.mjs`]: moduleSource('format-price'),
  ...Object.fromEntries(COUNTER_PLUMBING.map((p) => [`${COUNTER}/${p.name}.mjs`, moduleSource(p.name)])),
};

const siblingRecords = () => [
  { path: 'package.json', role: 'config', purpose: 'Package manifest of the shops' },
  ...CAPABILITIES.map((c) => ({ path: `${SHELF}/${c.name}.mjs`, role: 'service', purpose: c.purpose, feature: c.feature })),
  { path: `${SHELF}/format-price.mjs`, role: 'util', purpose: 'Formats a price with its currency' },
  ...CAPABILITIES.map((c) => ({ path: `${COUNTER}/${c.name}.mjs`, role: 'service', purpose: `${c.purpose} on the counter screen`, feature: COUNTER_TAGGED.includes(c.name) ? c.feature : undefined })),
  ...COUNTER_PLUMBING.map((p) => ({ path: `${COUNTER}/${p.name}.mjs`, role: p.role, purpose: p.purpose })),
];

export function createSiblingProject(root) {
  createProject(root, SIBLING_PROJECT);
  writeLantern(root, 'platforms', SIBLING_PLATFORMS);
  writeMapRecords(root, siblingRecords());
  writeFeatures(root, SIBLING_FEATURES);
  writeLantern(root, 'systems', '# outside systems\n');
  writeLantern(root, 'lang/en/systems.json', json({}));
}
