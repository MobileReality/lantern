import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalisedKey, nearDuplicateGroups, namesId, looksLikePackage, vendorProductPairs } from '../skills/lantern-setup/scripts/vocabulary.mjs';
import { plainSpec, tidySpec, untidySpec } from './helpers/lantern-vocab-fixtures';
import { makeVocabProject, removeVocabProjects, runScript, snapshotLantern } from './helpers/lantern-vocab-project';

afterEach(removeVocabProjects);

const systems = (root: string, ...args: string[]) => runScript('systems.mjs', [root, ...args]);
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('vocabulary name helpers', () => {
  it('normalises api, sdk, client, service and plural away', () => {
    expect(normalisedKey('Payment-Gateway-API')).toBe('payment-gateway');
    expect(normalisedKey('object-stores')).toBe('object-store');
    expect(normalisedKey('mail-sdk')).toBe('mail');
    expect(normalisedKey('api')).toBe('api');
  });

  it('groups near-duplicates and keeps the most used, then the shortest', () => {
    const counts = new Map([['mail-relay-api', 3], ['mail-relay', 1]]);
    expect(nearDuplicateGroups(['mail-relay', 'mail-relay-api', 'object-store'], counts)).toEqual([{ key: 'mail-relay', keep: 'mail-relay-api', ids: ['mail-relay-api', 'mail-relay'] }]);
    expect(nearDuplicateGroups(['a-store', 'b-store'])).toEqual([]);
  });

  it('proposes vendor/product pairs without merging them', () => {
    expect(vendorProductPairs(['acme', 'acme-mail', 'other'])).toEqual([{ short: 'acme', long: 'acme-mail' }]);
  });

  it('matches a platform id as whole words inside a feature id', () => {
    expect(namesId('kiosk-checkout', 'kiosk')).toBe(true);
    expect(namesId('web-client-sync', 'web-client')).toBe(true);
    expect(namesId('kiosks', 'kiosk')).toBe(false);
    expect(namesId('check-out', 'web')).toBe(false);
  });

  it('recognises package-shaped ids', () => {
    for (const id of ['@acme/ui-kit', 'acme/ui', 'npm:left-pad', 'lodash.js']) expect(looksLikePackage(id)).toBe(true);
    for (const id of ['payment-gateway', 'object-store']) expect(looksLikePackage(id)).toBe(false);
  });
});

describe('systems.mjs list and check', () => {
  it('says so when there is no .lantern/systems, and checks nothing', () => {
    const root = makeVocabProject(plainSpec());
    expect(systems(root, 'list').out).toContain('no .lantern/systems');
    expect(systems(root, 'check')).toMatchObject({ status: 0 });
  });

  it('lists ids with their text', () => {
    const root = makeVocabProject(tidySpec());
    expect(systems(root, 'list').stdout.trim().split('\n')).toEqual(['mail-relay | what mail-relay is', 'object-store | what object-store is', 'payment-gateway | what payment-gateway is']);
  });

  it('passes a tidy map and fails on an ext target missing from the list', () => {
    expect(systems(makeVocabProject(tidySpec()), 'check').out).toContain('OK');
    const result = systems(makeVocabProject(untidySpec()), 'check');
    expect(result.status).toBe(1);
    expect(result.out).toContain('ext:error-tracker is not in .lantern/systems');
    expect(result.out).toContain('warning:');
  });
});

describe('systems.mjs add', () => {
  it('adds a new system in sorted position with its text, and touches nothing else', () => {
    const root = makeVocabProject(tidySpec());
    const before = snapshotLantern(root);
    const result = systems(root, 'add', 'error-tracker', '--text', 'hosted crash reports');
    expect(result.status).toBe(0);
    expect(read(root, '.lantern/systems')).toBe('# outside systems\nerror-tracker\nmail-relay\nobject-store\npayment-gateway\n');
    expect(JSON.parse(read(root, '.lantern/lang/en/systems.json')).text['error-tracker']).toBe('hosted crash reports');
    const after = snapshotLantern(root);
    const changed = Object.keys(after).filter((file) => after[file] !== before[file]).sort();
    expect(changed).toEqual(['.lantern/lang/en/systems.json', '.lantern/systems']);
  });

  it('creates the list and its text file when there are none', () => {
    const root = makeVocabProject(plainSpec());
    expect(systems(root, 'add', 'payment-gateway', '--text', 'card payments').status).toBe(0);
    expect(read(root, '.lantern/systems')).toMatch(/^# .*\npayment-gateway\n$/);
    expect(read(root, '.lantern/lang/en/systems.json')).toBe('{\n "text": {\n  "payment-gateway": "card payments"\n }\n}\n');
  });

  it('refuses a near-duplicate of a listed system unless told the owner confirmed', () => {
    const root = makeVocabProject(tidySpec());
    const refused = systems(root, 'add', 'payment-gateway-api', '--text', 'same thing');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('looks like the listed system "payment-gateway"');
    expect(read(root, '.lantern/systems')).not.toContain('payment-gateway-api');
    expect(systems(root, 'add', 'payment-gateway-api', '--text', 'confirmed distinct', '--allow-similar').status).toBe(0);
  });

  it('refuses an invalid id, a new system without text and an over-long text', () => {
    const root = makeVocabProject(tidySpec());
    expect(systems(root, 'add', 'Bad Id', '--text', 'x').status).toBe(2);
    expect(systems(root, 'add', 'error-tracker').out).toContain('needs --text');
    expect(systems(root, 'add', 'error-tracker', '--text', 'x'.repeat(81)).status).toBe(2);
    expect(read(root, '.lantern/systems')).not.toContain('error-tracker');
  });

  it('writes nothing when the systems text file is malformed', () => {
    const root = makeVocabProject(tidySpec());
    fs.writeFileSync(path.join(root, '.lantern/lang/en/systems.json'), '{ not json');
    const before = snapshotLantern(root);
    expect(systems(root, 'add', 'error-tracker', '--text', 'crash reports').status).toBe(1);
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('is idempotent and updates the text of a listed system', () => {
    const root = makeVocabProject(tidySpec());
    expect(systems(root, 'add', 'mail-relay').out).toContain('already listed');
    systems(root, 'add', 'mail-relay', '--text', 'outgoing mail');
    systems(root, 'add', 'mail-relay', '--text', 'outgoing mail');
    expect(JSON.parse(read(root, '.lantern/lang/en/systems.json')).text['mail-relay']).toBe('outgoing mail');
    expect(read(root, '.lantern/systems').match(/mail-relay/g)).toHaveLength(1);
  });

  it('never writes .lantern/features', () => {
    const root = makeVocabProject(tidySpec());
    const before = read(root, '.lantern/features');
    systems(root, 'add', 'error-tracker', '--text', 'crash reports');
    expect(read(root, '.lantern/features')).toBe(before);
  });
});

describe('systems.mjs seed and suggest', () => {
  it('seeds the list from the ext targets the map names, once', () => {
    const root = makeVocabProject(plainSpec());
    expect(systems(root, 'seed').status).toBe(0);
    expect(read(root, '.lantern/systems')).toContain('payment-gateway\n');
    expect(systems(root, 'seed').status).toBe(1);
  });

  it('proposes merges, vendor/product pairs and probable libraries, and writes nothing', () => {
    const root = makeVocabProject(untidySpec());
    const before = snapshotLantern(root);
    const out = systems(root, 'suggest').out;
    expect(out).toMatch(/merge\s+payment-gateway-api -> payment-gateway/);
    expect(out).toMatch(/library @acme\/ui-kit/);
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('has nothing to suggest on a tidy map', () => {
    expect(systems(makeVocabProject(tidySpec()), 'suggest').out.trim()).toBe('NONE');
  });
});
