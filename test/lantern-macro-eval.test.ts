import { afterEach, describe, expect, it } from 'vitest';
import { plainSpec, tidySpec, untidySpec } from './helpers/lantern-vocab-fixtures';
import { makeVocabProject, removeVocabProjects, runScript } from './helpers/lantern-vocab-project';

afterEach(removeVocabProjects);

const evaluate = (root: string, ...flags: string[]) => runScript('macro-eval.mjs', [root, ...flags]);
const statusOf = (out: string, name: string) => new RegExp(`^(PASS|WARN) ${name.replace(/[[\]]/g, '\\$&')}(?=\\s)`, 'm').exec(out)?.[1];

describe('macro-eval.mjs', () => {
  it('passes every check on a tidy map', () => {
    const { out, status } = evaluate(makeVocabProject(tidySpec()));
    expect(status).toBe(0);
    expect(out).toContain('PASS: 0 of');
    expect(out).not.toMatch(/^WARN /m);
    expect(out).toContain('features    3 used, 3 declared');
    expect(out).toContain('systems     3 distinct ext target(s), 3 listed');
    expect(statusOf(out, 'feature-divergence[web]')).toBe('PASS');
  });

  it('warns on collisions, near-duplicates, library-like ids and unlisted systems', () => {
    const { out } = evaluate(makeVocabProject(untidySpec()));
    expect(statusOf(out, 'feature-collisions')).toBe('WARN');
    expect(statusOf(out, 'system-near-duplicates')).toBe('WARN');
    expect(statusOf(out, 'system-library-like')).toBe('WARN');
    expect(statusOf(out, 'system-listed')).toBe('WARN');
    expect(out).toContain('near-duplicate systems: payment-gateway, payment-gateway-api');
  });

  it('measures how far the tags of platforms of one kind diverge and names the offenders', () => {
    const { out } = evaluate(makeVocabProject(untidySpec()));
    expect(statusOf(out, 'feature-divergence[web]')).toBe('WARN');
    expect(out).toContain('feature divergence, web platforms (portal, kiosk): 100% of 4 feature(s) used by one platform only');
    expect(out).toMatch(/kiosk-checkout\s+kiosk \(2 record\(s\)\)/);
  });

  it('reports the untagged share per platform and judges it only on enough records', () => {
    const untagged = Array.from({ length: 12 }, (_, i) => ({ path: `kiosk/part${i}.ts`, role: 'service' }));
    const spec = tidySpec();
    const out = evaluate(makeVocabProject({ ...spec, files: [...spec.files, ...untagged] })).out;
    expect(out).toMatch(/kiosk\s+web\s+12\/14\s+86%/);
    expect(statusOf(out, 'untagged-share')).toBe('WARN');
    expect(statusOf(evaluate(makeVocabProject(tidySpec())).out, 'untagged-share')).toBe('PASS');
  });

  it('exits 0 whatever it finds, and 1 only with --fail', () => {
    const root = makeVocabProject(untidySpec());
    expect(evaluate(root).status).toBe(0);
    expect(evaluate(root, '--fail').status).toBe(1);
    expect(evaluate(makeVocabProject(tidySpec()), '--fail').status).toBe(0);
  });

  it('works with no platforms file and no systems file', () => {
    const { out, status } = evaluate(makeVocabProject(plainSpec()), '--fail');
    expect(status).toBe(0);
    expect(out).toContain('(no .lantern/platforms)');
    expect(out).toContain('(no .lantern/systems)');
    expect(statusOf(out, 'feature-divergence')).toBe('PASS');
    expect(statusOf(out, 'system-listed')).toBe('PASS');
  });

  it('prints the same checks as JSON', () => {
    const parsed = JSON.parse(evaluate(makeVocabProject(untidySpec()), '--json').stdout);
    expect(parsed.checks.find((c: { name: string }) => c.name === 'feature-collisions').status).toBe('WARN');
    expect(parsed.divergence[0].only.length).toBe(4);
  });
});
