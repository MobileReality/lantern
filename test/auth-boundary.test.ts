import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceAliases } from '../scripts/aliases.cjs';

const SRC = path.resolve(__dirname, '../src');
const AUTH_DIR = path.join(SRC, 'main', 'auth');
const SECRET_STORE = path.join(AUTH_DIR, 'secret-store');
const IMPORT_SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

const ALIASES = Object.entries(sourceAliases());

function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) return path.resolve(path.dirname(file), specifier);
  const alias = ALIASES.find(([name]) => specifier.startsWith(`${name}/`));
  return alias ? path.join(alias[1], specifier.slice(alias[0].length)) : null;
}

function importsSecretStore(file: string, source: string): boolean {
  return [...source.matchAll(IMPORT_SPECIFIER)].some(([, specifier]) => resolveSpecifier(file, specifier)?.replace(/\.(ts|js|mjs)$/, '') === SECRET_STORE);
}

describe('secret store boundary', () => {
  it('is imported by nothing outside src/main/auth', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.startsWith(`${AUTH_DIR}${path.sep}`))
      .filter((file) => importsSecretStore(file, fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is created only by the auth composition; everything else gets it injected', () => {
    const importers = sourceFiles(AUTH_DIR)
      .filter((file) => importsSecretStore(file, fs.readFileSync(file, 'utf8').replace(/import type[^;]*;/g, '')))
      .map((file) => path.basename(file))
      .sort();
    expect(importers).toEqual(['index.ts']);
  });

  it('would catch an import from outside', () => {
    const outside = path.join(SRC, 'main', 'main.ts');
    expect(importsSecretStore(outside, "import { createSecretStore } from './auth/secret-store';")).toBe(true);
    expect(importsSecretStore(outside, "const store = await import('./auth/secret-store.js');")).toBe(true);
    expect(importsSecretStore(path.join(SRC, 'renderer', 'x.ts'), "import { a } from '../main/auth/secret-store';")).toBe(true);
    expect(importsSecretStore(path.join(SRC, 'renderer', 'x.ts'), "import { a } from '@main/auth/secret-store';")).toBe(true);
    expect(importsSecretStore(outside, "import { createAuth } from './auth';")).toBe(false);
    expect(importsSecretStore(outside, "import { createAuth } from '@main/auth';")).toBe(false);
  });
});

describe('what the preload and renderer can see of auth', () => {
  it('only types and channel names, never the auth modules at runtime', () => {
    const offenders = sourceFiles(path.join(SRC, 'preload'))
      .concat(sourceFiles(path.join(SRC, 'renderer')))
      .filter((file) => /^import\s+(?!type\b)[^;]*from\s+['"][^'"]*main\/auth/m.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
