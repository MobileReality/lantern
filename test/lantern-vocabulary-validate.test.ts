import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { plainSpec, tidySpec, untidySpec } from './helpers/lantern-vocab-fixtures';
import { makeVocabProject, removeVocabProjects, runScript } from './helpers/lantern-vocab-project';

afterEach(removeVocabProjects);

const validate = (root: string, ...flags: string[]) => runScript('validate.mjs', [root, ...flags]);
const vocabularyLines = (out: string) => out.split('\n').filter((line) => line.includes('[vocabulary]'));

describe('validate.mjs vocabulary checks', () => {
  it('stays silent on a tidy map, even with --strict', () => {
    const root = makeVocabProject(tidySpec());
    const plain = validate(root);
    expect(plain.status).toBe(0);
    expect(vocabularyLines(plain.out)).toEqual([]);
    expect(plain.out).toContain('vocabulary: OK');
    expect(validate(root, '--strict', '--settled').status).toBe(0);
  });

  it('flags a vendor-named feature, with file:line, the id and the way out', () => {
    const root = makeVocabProject(untidySpec());
    const result = validate(root);
    const line = vocabularyLines(result.out).find((l) => l.includes('feature "acme-mail"'));
    expect(line).toMatch(/^\s*\.lantern\/features:2: \[vocabulary\] feature "acme-mail" is also an outside system \(ext:acme-mail\)/);
    expect(line).toContain('retag.mjs retag-feature acme-mail <capability>');
  });

  it('flags features named after a platform, whole word only', () => {
    const root = makeVocabProject(untidySpec());
    const lines = vocabularyLines(validate(root).out);
    expect(lines.filter((l) => l.includes('is named after platform'))).toHaveLength(2);
    expect(lines.some((l) => l.includes('feature "kiosk-checkout" is named after platform "kiosk"'))).toBe(true);
    const lookalike = makeVocabProject({ ...tidySpec(), features: ['accounts', 'checkout', 'kiosks-and-reports'], files: tidySpec().files.map((f) => (f.feature === 'reports' ? { ...f, feature: 'kiosks-and-reports' } : f)) });
    expect(vocabularyLines(validate(lookalike).out)).toEqual([]);
  });

  it('flags unlisted, near-duplicate and package-shaped ext targets', () => {
    const root = makeVocabProject(untidySpec());
    const text = vocabularyLines(validate(root).out).join('\n');
    expect(text).toMatch(/\.lantern\/map\/service\.lantern:\d+: \[vocabulary\] ext:payment-gateway-api is not in \.lantern\/systems \(did you mean ext:payment-gateway\?\); reuse a listed id/);
    expect(text).toContain('ext:error-tracker is not in .lantern/systems');
    expect(text).toContain('ext ids payment-gateway, payment-gateway-api look like one system');
    expect(text).toContain('ext:@acme/ui-kit appears once and looks like a package name, probably a library');
  });

  it('does not check ext targets against a list when there is no .lantern/systems', () => {
    const root = makeVocabProject(untidySpec(false));
    const text = vocabularyLines(validate(root).out).join('\n');
    expect(text).not.toContain('is not in .lantern/systems');
    expect(text).toContain('look like one system');
  });

  it('is a warning by default and an error with --strict', () => {
    const root = makeVocabProject(untidySpec());
    const warned = validate(root);
    expect(warned.status).toBe(0);
    expect(warned.out).toMatch(/vocabulary: \d+ finding\(s\) \(warnings\)/);
    const strict = validate(root, '--strict');
    expect(strict.status).toBe(1);
    expect(strict.out).toMatch(/vocabulary: \d+ finding\(s\) \(errors, --strict\)/);
    expect(strict.out).toMatch(/FAIL: \d+ problem/);
    expect(strict.out.split('FAIL:')[1]).toContain('[vocabulary] feature "acme-mail"');
  });

  it('counts every finding in the summary line', () => {
    const root = makeVocabProject(untidySpec());
    const out = validate(root).out;
    const count = Number(/vocabulary: (\d+) finding/.exec(out)?.[1]);
    expect(count).toBe(vocabularyLines(out).length);
    expect(count).toBeGreaterThanOrEqual(6);
  });

  it('works on a project with no platforms file and no systems file', () => {
    const root = makeVocabProject(plainSpec());
    const result = validate(root, '--strict');
    expect(result.status).toBe(0);
    expect(result.out).toContain('vocabulary: OK');
  });

  it('rejects a malformed .lantern/systems whatever the flags', () => {
    const root = makeVocabProject({ ...tidySpec(), systems: ['mail-relay', 'Object Store', 'payment-gateway', 'mail-relay'] });
    const result = validate(root);
    expect(result.status).toBe(1);
    expect(result.out).toContain('.lantern/systems:3: system id "Object Store" must be one lowercase kebab-case id per line');
    expect(result.out).toContain('duplicate system "mail-relay"');
  });

  it('warns about a systems text with no system', () => {
    const root = makeVocabProject(tidySpec());
    fs.writeFileSync(path.join(root, '.lantern/lang/en/systems.json'), JSON.stringify({ text: { 'mail-relay': 'x', 'ghost-service': 'y' } }));
    expect(validate(root).out).toContain('orphan key: .lantern/lang/en/systems.json: "ghost-service"');
  });
});
