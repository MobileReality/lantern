import { describe, expect, it } from 'vitest';
import { macroSystemsByPath } from '../src/main/lantern-macro-systems';
import type { ParsedRecord, ParsedRelation } from '../src/main/lantern-parse';
import { macroFixtureRecords } from './helpers/lantern-macro-fixture';

function relation(overrides: Partial<ParsedRelation>): ParsedRelation {
  return { arrow: '>', token: '', to: null, ext: null, symbol: null, label: '', ...overrides };
}

function record(path: string, role: string, relations: ParsedRelation[]): ParsedRecord {
  return { path, marker: '.', owner: null, role, hash: 'a'.repeat(12), purpose: '', feature: null, seeAlso: null, seeAlsoNote: '', gotcha: null, relations, file: 'x.lantern' };
}

const ext = (system: string) => relation({ ext: system, token: `ext:${system}` });
const internal = (to: string) => relation({ to, token: to });

describe('the outside systems each file talks to', () => {
  it('counts the relations to each system, the most first and then by name', () => {
    const records = [record('api/pay.ts', 'service', [ext('card-gateway'), ext('mail-provider'), ext('card-gateway'), ext('audit-store'), internal('api/log.ts')])];

    expect(macroSystemsByPath(records)).toEqual({
      'api/pay.ts': [
        { system: 'card-gateway', count: 2 },
        { system: 'audit-store', count: 1 },
        { system: 'mail-provider', count: 1 },
      ],
    });
  });

  it('leaves out files that talk to no outside system, so the payload stays small', () => {
    const records = [record('api/log.ts', 'util', [internal('api/pay.ts')]), record('api/empty.ts', 'util', [])];

    expect(macroSystemsByPath(records)).toEqual({});
  });

  it('leaves out test files, as the block view does', () => {
    const records = [record('api/pay.test.ts', 'test', [ext('card-gateway')]), record('api/pay.ts', 'service', [ext('card-gateway')])];

    expect(Object.keys(macroSystemsByPath(records))).toEqual(['api/pay.ts']);
  });

  it('agrees with the block view on the fixture project: the relations of all files add up to the view totals', () => {
    const records = macroFixtureRecords();
    const byPath = macroSystemsByPath(records);

    const fromFiles = new Map<string, number>();
    for (const uses of Object.values(byPath)) for (const use of uses) fromFiles.set(use.system, (fromFiles.get(use.system) ?? 0) + use.count);
    const fromRecords = new Map<string, number>();
    for (const rec of records) {
      if (rec.role === 'test') continue;
      for (const rel of rec.relations) if (rel.ext !== null) fromRecords.set(rel.ext, (fromRecords.get(rel.ext) ?? 0) + 1);
    }

    expect(fromFiles.size).toBeGreaterThan(0);
    expect(fromFiles).toEqual(fromRecords);
  });
});
