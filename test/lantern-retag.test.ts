import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { plainSpec, tidySpec, untidySpec } from './helpers/lantern-vocab-fixtures';
import { makeVocabProject, removeVocabProjects, runScript, snapshotLantern } from './helpers/lantern-vocab-project';

afterEach(removeVocabProjects);

const retag = (root: string, ...args: string[]) => runScript('retag.mjs', [root, ...args]);
const plan = (root: string, ...args: string[]) => runScript('plan.mjs', [root, ...args]);
const validate = (root: string, ...flags: string[]) => runScript('validate.mjs', [root, ...flags]);
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const lang = (root: string, rel: string) => JSON.parse(read(root, rel)).text as Record<string, string>;
const recordHeads = (root: string) => Object.entries(snapshotLantern(root)).filter(([file]) => file.startsWith('.lantern/map/')).flatMap(([, text]) => text.split('\n').filter((l) => /^\S+ [.~+-] /.test(l)));
const changedFiles = (before: Record<string, string>, after: Record<string, string>) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => before[f] !== after[f]).sort();

describe('retag.mjs systems', () => {
  it('merges a near-duplicate into the kept id, collapses the doubled relation and moves its label', () => {
    const root = makeVocabProject(untidySpec());
    const langFile = path.join(root, '.lantern/lang/en/service.lantern.json');
    const table = lang(root, '.lantern/lang/en/service.lantern.json');
    fs.writeFileSync(langFile, JSON.stringify({ text: { ...table, 'checkout.ts > ext:payment-gateway-api': 'charge request' } }, null, 1));
    const result = retag(root, 'merge-system', 'payment-gateway-api', 'payment-gateway');
    expect(result.status).toBe(0);
    const map = read(root, '.lantern/map/service.lantern');
    expect(map).not.toContain('payment-gateway-api');
    expect(map.match(/> ext:payment-gateway$/gm)).toHaveLength(1);
    const text = lang(root, '.lantern/lang/en/service.lantern.json');
    expect(text['checkout.ts > ext:payment-gateway']).toBe('charge request');
    expect(Object.keys(text).some((key) => key.includes('payment-gateway-api'))).toBe(false);
    expect(validate(root).out).not.toContain('payment-gateway-api');
  });

  it('renames a system everywhere, in the list, its text and the relation labels', () => {
    const root = makeVocabProject(tidySpec());
    const labelled = lang(root, '.lantern/lang/en/service.lantern.json');
    fs.writeFileSync(path.join(root, '.lantern/lang/en/service.lantern.json'), JSON.stringify({ text: { ...labelled, 'reports.ts > ext:object-store': 'report files' } }, null, 1));
    expect(retag(root, 'rename-system', 'object-store', 'blob-store').status).toBe(0);
    expect(read(root, '.lantern/map/service.lantern')).toContain('> ext:blob-store');
    expect(read(root, '.lantern/map/service.lantern')).not.toContain('object-store');
    expect(read(root, '.lantern/systems')).toBe('# outside systems\nblob-store\nmail-relay\npayment-gateway\n');
    expect(lang(root, '.lantern/lang/en/systems.json')['blob-store']).toBe('what object-store is');
    expect(lang(root, '.lantern/lang/en/service.lantern.json')['reports.ts > ext:blob-store']).toBe('report files');
    const out = validate(root, '--strict', '--settled');
    expect(out.status).toBe(0);
  });

  it('keeps the kept id text and drops the merged one from the list when merging listed systems', () => {
    const root = makeVocabProject(untidySpec());
    expect(retag(root, 'merge-system', 'acme-mail', 'mail-relay').status).toBe(0);
    expect(read(root, '.lantern/systems')).not.toContain('acme-mail');
    expect(lang(root, '.lantern/lang/en/systems.json')).toEqual({ 'mail-relay': 'what mail-relay is', 'object-store': 'what object-store is', 'payment-gateway': 'what payment-gateway is' });
    expect(read(root, '.lantern/map/service.lantern').match(/> ext:mail-relay/g)).toHaveLength(2);
  });

  it('drops a library listed as a system, with its relation lines and labels', () => {
    const root = makeVocabProject(untidySpec());
    expect(retag(root, 'drop-system', '@acme/ui-kit').status).toBe(0);
    expect(read(root, '.lantern/map/service.lantern')).not.toContain('ui-kit');
    expect(read(root, '.lantern/map/service.lantern')).toContain('service/ui-theme.ts . service');
  });

  it('refuses a rename onto an existing system and a merge into an unknown one', () => {
    const root = makeVocabProject(tidySpec());
    const before = snapshotLantern(root);
    expect(retag(root, 'rename-system', 'mail-relay', 'object-store').out).toContain('use merge-system');
    expect(retag(root, 'merge-system', 'mail-relay', 'no-such-system').out).toContain('use rename-system');
    expect(snapshotLantern(root)).toEqual(before);
  });
});

describe('retag.mjs features', () => {
  it('re-tags a platform-named feature into an existing capability and removes the declaration and its text', () => {
    const root = makeVocabProject(untidySpec());
    expect(retag(root, 'retag-feature', 'kiosk-checkout', 'checkout').status).toBe(0);
    const map = read(root, '.lantern/map/kiosk.lantern');
    expect(map).not.toContain('kiosk-checkout');
    expect(map.match(/#feature checkout/g)).toHaveLength(2);
    expect(read(root, '.lantern/features')).toBe('accounts\nacme-mail\ncheckout\nkiosk-reports\nreports\n');
    expect(Object.keys(lang(root, '.lantern/lang/en/features.json'))).not.toContain('kiosk-checkout');
  });

  it('renames a feature to a new capability id, keeping its place and its text', () => {
    const root = makeVocabProject(untidySpec());
    expect(retag(root, 'retag-feature', 'acme-mail', 'email-delivery').status).toBe(0);
    expect(read(root, '.lantern/features')).toBe('accounts\nemail-delivery\ncheckout\nkiosk-checkout\nkiosk-reports\nreports\n');
    expect(lang(root, '.lantern/lang/en/features.json')['email-delivery']).toBe('what acme-mail covers');
    expect(read(root, '.lantern/map/service.lantern')).toContain('#feature email-delivery');
    expect(validate(root).out).not.toContain('feature "acme-mail"');
  });

  it('untags a feature everywhere with --untag', () => {
    const root = makeVocabProject(untidySpec());
    expect(retag(root, 'retag-feature', 'kiosk-reports', '--untag').status).toBe(0);
    expect(read(root, '.lantern/map/kiosk.lantern')).not.toContain('kiosk-reports');
    expect(read(root, '.lantern/features')).not.toContain('kiosk-reports');
    expect(validate(root).status).toBe(0);
  });

  it('tags a single file under its record, or untags it, and never invents a feature', () => {
    const root = makeVocabProject(untidySpec());
    expect(retag(root, 'tag-file', 'service/tracking.ts', 'accounts').status).toBe(0);
    expect(read(root, '.lantern/map/service.lantern')).toMatch(/service\/tracking\.ts \. service [0-9a-f]{12}\n#feature accounts\n  > ext:error-tracker/);
    expect(retag(root, 'tag-file', 'service/tracking.ts', '--none').status).toBe(0);
    expect(read(root, '.lantern/map/service.lantern')).not.toMatch(/tracking\.ts[^\n]*\n#feature/);
    const refused = retag(root, 'tag-file', 'service/tracking.ts', 'brand-new');
    expect(refused.status).toBe(2);
    expect(refused.out).toContain('never invents one');
  });
});

describe('retag.mjs guarantees', () => {
  const COMMANDS = [
    ['merge-system', 'payment-gateway-api', 'payment-gateway'],
    ['rename-system', 'error-tracker', 'crash-reports'],
    ['drop-system', '@acme/ui-kit'],
    ['retag-feature', 'kiosk-checkout', 'checkout'],
    ['retag-feature', 'acme-mail', 'email-delivery'],
    ['tag-file', 'service/tracking.ts', 'accounts'],
  ];

  it('never touches a record line, so every hash stays', () => {
    const root = makeVocabProject(untidySpec());
    const heads = recordHeads(root);
    for (const command of COMMANDS) expect(retag(root, ...command).status).toBe(0);
    expect(recordHeads(root)).toEqual(heads);
  });

  it('writes only map files, lang files, the features file and the systems list', () => {
    const root = makeVocabProject(untidySpec());
    const before = snapshotLantern(root);
    for (const command of COMMANDS) retag(root, ...command);
    for (const file of changedFiles(before, snapshotLantern(root))) expect(file).toMatch(/^\.lantern\/(map\/|lang\/en\/|features$|systems$)/);
  });

  it('is idempotent: a second run changes nothing and still exits 0', () => {
    const root = makeVocabProject(untidySpec());
    for (const command of COMMANDS) retag(root, ...command);
    const settled = snapshotLantern(root);
    for (const command of COMMANDS.filter((c) => c[0] !== 'drop-system')) {
      const again = retag(root, ...command);
      expect(again.status).toBe(0);
      expect(snapshotLantern(root)).toEqual(settled);
    }
  });

  it('refuses unknown ids and changes nothing', () => {
    const root = makeVocabProject(untidySpec());
    const before = snapshotLantern(root);
    for (const command of [
      ['rename-system', 'no-such', 'other-name'],
      ['merge-system', 'no-such', 'also-unknown'],
      ['drop-system', 'no-such'],
      ['retag-feature', 'no-such', 'also-unknown'],
      ['retag-feature', 'no-such', '--untag'],
      ['tag-file', 'src/missing.ts', 'checkout'],
      ['tag-file', 'service/tracking.ts', 'no-such'],
    ]) {
      const result = retag(root, ...command);
      expect(result.status, command.join(' ')).toBe(2);
    }
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('treats an old id that is gone while the new one exists as a finished rerun, and says so', () => {
    const root = makeVocabProject(untidySpec());
    const before = snapshotLantern(root);
    for (const command of [['merge-system', 'no-such', 'mail-relay'], ['retag-feature', 'no-such', 'checkout']]) {
      const result = retag(root, ...command);
      expect(result.status).toBe(0);
      expect(result.out).toContain('already done, nothing changed');
    }
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('refuses to retag a feature that records use but .lantern/features does not declare', () => {
    const root = makeVocabProject({ ...tidySpec(), features: ['accounts', 'checkout'] });
    const before = snapshotLantern(root);
    const result = retag(root, 'retag-feature', 'reports', 'summaries');
    expect(result.status).toBe(2);
    expect(result.out).toContain('not declared');
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('refuses feature commands in a project with no .lantern/features', () => {
    const spec = plainSpec();
    const root = makeVocabProject({ ...spec, features: undefined, files: spec.files.map((f) => ({ ...f, feature: undefined })) });
    expect(retag(root, 'retag-feature', 'orders', 'sales').out).toContain('no .lantern/features');
  });

  it('writes nothing on --dry-run and says what it would write', () => {
    const root = makeVocabProject(untidySpec());
    const before = snapshotLantern(root);
    const result = retag(root, 'merge-system', 'payment-gateway-api', 'payment-gateway', '--dry-run');
    expect(result.out).toContain('would write .lantern/map/service.lantern');
    expect(snapshotLantern(root)).toEqual(before);
  });

  it('keeps CRLF line endings of a map file', () => {
    const root = makeVocabProject(untidySpec());
    const file = path.join(root, '.lantern/map/kiosk.lantern');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    retag(root, 'retag-feature', 'kiosk-checkout', 'checkout');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('#feature checkout\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('takes an untidy map to green on validate --strict --settled', () => {
    const root = makeVocabProject(untidySpec());
    expect(validate(root, '--strict').status).toBe(1);
    for (const command of [
      ['merge-system', 'payment-gateway-api', 'payment-gateway'],
      ['drop-system', '@acme/ui-kit'],
      ['retag-feature', 'kiosk-checkout', 'checkout'],
      ['retag-feature', 'kiosk-reports', 'reports'],
      ['retag-feature', 'acme-mail', 'email-delivery'],
      ['merge-system', 'acme-mail', 'mail-relay'],
    ]) expect(retag(root, ...command).status, command.join(' ')).toBe(0);
    expect(runScript('systems.mjs', [root, 'add', 'error-tracker', '--text', 'hosted crash reports']).status).toBe(0);
    const result = validate(root, '--strict', '--settled');
    expect(result.out).toContain('vocabulary: OK');
    expect(result.status).toBe(0);
    expect(plan(root, 'retag').out).toContain('RETAG DONE');
  });
});

describe('plan.mjs retag', () => {
  it('lists features with their flags, the system merge proposals and the open steps', () => {
    const root = makeVocabProject(untidySpec());
    const { out, status } = plan(root, 'retag');
    expect(status).toBe(0);
    expect(out).toMatch(/kiosk-checkout\s+2 record\(s\) on kiosk\s+<- FLAG names a platform\n/);
    expect(out).toMatch(/\breports\s+2 record\(s\) on portal, service\s+<- REVIEW only on portal \(web\)/);
    expect(out).toMatch(/acme-mail\s+1 record\(s\) on service\s+<- FLAG names an outside system/);
    expect(out).toContain('merge   payment-gateway-api -> payment-gateway');
    expect(out).toContain('library @acme/ui-kit');
    expect(out).toMatch(/RETAG TODO: \d+ step\(s\)/);
  });

  it('is resumable: pending shrinks as records are re-tagged and ends at RETAG DONE', () => {
    const root = makeVocabProject(untidySpec());
    expect(plan(root, 'retag', 'pending').out).toMatch(/retag chunk 1: 4 record\(s\)/);
    retag(root, 'tag-file', 'kiosk/receipt.ts', 'checkout');
    retag(root, 'tag-file', 'kiosk/checkout.ts', 'checkout');
    expect(plan(root, 'retag', 'pending').out).toMatch(/retag chunk 1: 2 record\(s\)/);
    retag(root, 'retag-feature', 'acme-mail', 'email-delivery');
    retag(root, 'retag-feature', 'kiosk-reports', 'reports');
    expect(plan(root, 'retag', 'pending').out.trim()).toBe('ALL DONE');
    expect(plan(root, 'retag').out).toMatch(/RETAG TODO/);
  });

  it('shows a chunk from the map alone: platform, feature, purpose, ext targets and the features it may use', () => {
    const root = makeVocabProject(untidySpec());
    const lines = plan(root, 'retag', 'chunk', '1').stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^# retag chunk 1 of 1:/);
    expect(lines).toContain('kiosk/receipt.ts | kiosk | kiosk-checkout | purpose of kiosk/receipt.ts | ');
    expect(lines).toContain('service/mailer.ts | service | acme-mail | purpose of service/mailer.ts | ext:acme-mail ext:mail-relay');
    expect(lines.at(-1)).toBe('# features you may use: accounts, checkout, reports');
    expect(plan(root, 'retag', 'chunk', '9').status).toBe(2);
  });

  it('asks for the systems list in a project that has none, and works without platforms', () => {
    const root = makeVocabProject(plainSpec());
    const { out, status } = plan(root, 'retag');
    expect(status).toBe(0);
    expect(out).toContain('is missing: systems.mjs seed');
    runScript('systems.mjs', [root, 'seed']);
    expect(plan(root, 'retag').out).toContain('RETAG DONE');
  });

  it('reports a tidy map as done', () => {
    expect(plan(makeVocabProject(tidySpec()), 'retag').out).toContain('RETAG DONE');
  });

  it('surfaces the feature and system lists in a chunk brief and a systems flag in status', () => {
    const root = makeVocabProject(tidySpec());
    const chunk = plan(root, 'chunk', '1').stdout;
    expect(chunk).toContain('# features (read-only, tag only with these): accounts checkout reports');
    expect(chunk).toContain('mail-relay object-store payment-gateway');
    expect(JSON.parse(plan(root, 'status', '--json').stdout).systems).toBe(true);
    expect(JSON.parse(plan(makeVocabProject(plainSpec()), 'status', '--json').stdout).systems).toBe(false);
  });
});
