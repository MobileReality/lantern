import fs from 'node:fs';
import path from 'node:path';
import { runScript, SETUP_SCRIPTS } from './fixtures.mjs';
import { SIBLING_PLUMBING, SIBLING_TWINS, writeFeatures, writeMapRecords } from './vocab-fixtures.mjs';

const GOOD = 'good';
const BROWSER = 'clients/browser';
const KIOSK = 'clients/kiosk';

const CLIENTS_GOOD = {
  systems: { 'mail-relay': 'hosted mail relay the clients post exports to' },
  records: (tag, relay) => [
    { path: 'package.json', role: 'config' },
    { path: 'shared/note.mjs', role: 'util', feature: tag.shared },
    { path: `${BROWSER}/local-store.mjs`, role: 'repository' },
    { path: `${BROWSER}/save-note.mjs`, role: 'service', feature: tag.browserSave, relations: ['< shared/note.mjs', `> ${BROWSER}/local-store.mjs`] },
    { path: `${BROWSER}/export-notes.mjs`, role: 'service', feature: tag.browserExport, relations: [`< ${BROWSER}/local-store.mjs`, `> ext:${relay.browser}`] },
    { path: `${KIOSK}/touch-keyboard.mjs`, role: 'util' },
    { path: `${KIOSK}/save-note.mjs`, role: 'service', feature: tag.kioskSave, relations: ['< shared/note.mjs'] },
    { path: `${KIOSK}/export-notes.mjs`, role: 'service', feature: tag.kioskExport, relations: [`< ${KIOSK}/save-note.mjs`, `> ext:${relay.kiosk}`] },
  ],
};

const PLAIN_RECORDS = (ext) => [
  { path: 'package.json', role: 'config' },
  { path: 'src/index.mjs', role: 'entry', relations: ['> src/slug.mjs', '> src/words.mjs', '> src/truncate.mjs'] },
  { path: 'src/slug.mjs', role: 'pure', feature: 'slugs', relations: ext.slug },
  { path: 'src/words.mjs', role: 'pure', feature: 'word-counts', relations: ext.words },
  { path: 'src/truncate.mjs', role: 'pure', feature: 'truncation' },
  { path: 'test/slug.test.mjs', role: 'test', relations: ['> src/slug.mjs'] },
];

const run = (cwd, script, args) => {
  const res = runScript(path.join(SETUP_SCRIPTS, script), [cwd, ...args], cwd);
  if (res.status !== 0) throw new Error(`${script} ${args.join(' ')} exited ${res.status}: ${(res.stdout || res.stderr).trim().slice(0, 200)}`);
};

const addSystem = (cwd, id, text) => run(cwd, 'systems.mjs', ['add', id, '--text', text, '--allow-similar']);

const CLIENTS_TAGS = {
  [GOOD]: { shared: 'note-saving', browserSave: 'note-saving', kioskSave: 'note-saving', browserExport: 'note-export', kioskExport: 'note-export' },
  split: { shared: 'note-saving', browserSave: 'note-saving', kioskSave: 'note-keeping', browserExport: 'note-export', kioskExport: 'note-sending' },
  broken: { shared: null, browserSave: 'browser-notes', browserExport: 'browser-notes', kioskSave: 'kiosk-notes', kioskExport: 'kiosk-notes' },
};

function mapClients(cwd, scenario) {
  const tag = CLIENTS_TAGS[scenario] ?? CLIENTS_TAGS.broken;
  const listsSystems = scenario === GOOD || scenario === 'split';
  const relay = listsSystems ? { browser: 'mail-relay', kiosk: 'mail-relay' } : { browser: 'mail-relay', kiosk: 'mail-relay-api' };
  writeMapRecords(cwd, CLIENTS_GOOD.records(tag, relay));
  writeFeatures(cwd, [...new Set(Object.values(tag).filter(Boolean))].sort());
  if (listsSystems) for (const [id, text] of Object.entries(CLIENTS_GOOD.systems)) addSystem(cwd, id, text);
}

function mapPlain(cwd, scenario) {
  const good = scenario === GOOD;
  writeMapRecords(cwd, PLAIN_RECORDS(good ? {} : { slug: ['> ext:text-tools-api'], words: ['> ext:text-tools-sdk'] }));
  writeFeatures(cwd, ['slugs', 'truncation', 'word-counts']);
  if (!good) addSystem(cwd, 'text-tools-api', 'invented hosted service');
}

const FIXTURES = { 'notes-clients': mapClients, 'text-tools': mapPlain };

export function vocabFixtureOf(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).name;
  } catch {
    return null;
  }
}

export function vocabSetup(cwd, scenario) {
  const map = FIXTURES[vocabFixtureOf(cwd)];
  if (!map) return false;
  map(cwd, scenario);
  return true;
}

function retagSiblings(cwd) {
  for (const { counter, feature } of SIBLING_TWINS) run(cwd, 'retag.mjs', ['tag-file', counter, feature]);
  for (const file of SIBLING_PLUMBING) run(cwd, 'retag.mjs', ['tag-file', file, '--none']);
}

export function vocabRetag(cwd, scenario) {
  if (scenario !== GOOD) return;
  if (vocabFixtureOf(cwd) === 'sibling-shops') return retagSiblings(cwd);
  run(cwd, 'retag.mjs', ['retag-feature', 'acmepay', 'payments']);
  run(cwd, 'retag.mjs', ['merge-system', 'mail-relay-api', 'mail-relay']);
  run(cwd, 'retag.mjs', ['drop-system', 'dayjs.js']);
  run(cwd, 'systems.mjs', ['seed']);
  addSystem(cwd, 'acmepay-api', 'hosted payment provider');
  addSystem(cwd, 'mail-relay', 'hosted mail relay for receipts and reminders');
}
