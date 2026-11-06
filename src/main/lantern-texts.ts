import fs from 'node:fs';
import path from 'node:path';
import { mapInBatches } from './lantern-batch';
import type { StampedCache } from './lantern-cache';
import type { LanternFeature, LanternLanguage } from './lantern-types';
import { splitLabel } from './lantern-parse';

const LANG_DIR = '.lantern/lang';
const MAP_DIR = '.lantern/map';
const LANG_CODE = /^[A-Za-z][\w-]*$/;
const DEFAULT_LANG = 'en';
const FEATURES_FILE = '.lantern/features';
const FEATURE_ID = /^[a-z][a-z0-9-]*$/;
const MAX_FALLBACK_KEYS = 500;

type LangTables = Map<string, Record<string, string>>;

interface ParsedLangFile {
  table: Record<string, string>;
  warnings: string[];
}

type LangFileCache = StampedCache<ParsedLangFile>;

function isLangCode(value: string | undefined | null): value is string {
  return typeof value === 'string' && LANG_CODE.test(value);
}

function langFromEnvText(text: string): string | null {
  const match = text.match(/^[ \t]*(?:export[ \t]+)?LANTERN_LANG[ \t]*=[ \t]*(.*)$/m);
  const value = match?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  return isLangCode(value) ? value : null;
}

function projectEnvFile(root: string) {
  return path.join(root, '.ai', '.env');
}

async function configuredLang(root: string): Promise<string | null> {
  const fromEnv = process.env.LANTERN_LANG?.trim();
  if (isLangCode(fromEnv)) return fromEnv;
  try {
    return langFromEnvText(await fs.promises.readFile(projectEnvFile(root), 'utf8'));
  } catch {
    return null;
  }
}

function configuredLangSync(root: string): string | null {
  const fromEnv = process.env.LANTERN_LANG?.trim();
  if (isLangCode(fromEnv)) return fromEnv;
  try {
    return langFromEnvText(fs.readFileSync(projectEnvFile(root), 'utf8'));
  } catch {
    return null;
  }
}

function pickPrimary(configured: string | null, langs: string[]): string {
  if (configured) return configured;
  return langs.includes(DEFAULT_LANG) || langs.length === 0 ? DEFAULT_LANG : langs[0];
}

async function readPrimaryLang(root: string): Promise<string> {
  return pickPrimary(await configuredLang(root), await listLangs(root));
}

function readExistingMapLang(root: string): string | null {
  try {
    if (!fs.statSync(path.join(root, MAP_DIR)).isDirectory()) return null;
    let langs: string[] = [];
    try {
      langs = langDirs(fs.readdirSync(path.join(root, LANG_DIR), { withFileTypes: true }));
    } catch {}
    return pickPrimary(configuredLangSync(root), langs);
  } catch {
    return null;
  }
}

function langDirs(entries: fs.Dirent[]): string[] {
  return entries.filter((e) => e.isDirectory() && LANG_CODE.test(e.name)).map((e) => e.name).sort();
}

async function listLangs(root: string): Promise<string[]> {
  try {
    return langDirs(await fs.promises.readdir(path.join(root, LANG_DIR), { withFileTypes: true }));
  } catch {
    return [];
  }
}

function parseLangFile(text: string, file: string): ParsedLangFile {
  const warnings: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    warnings.push(`${file}: not valid JSON (${(e as Error).message})`);
    return { table: {}, warnings };
  }
  const table = json && typeof json === 'object' ? (json as { text?: unknown }).text : undefined;
  if (table === undefined) return { table: {}, warnings };
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    warnings.push(`${file}: "text" is not an object`);
    return { table: {}, warnings };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') out[key] = value;
    else warnings.push(`${file}: value of "${key}" is not a string`);
  }
  return { table: out, warnings };
}

async function listLangFiles(base: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) subdirs.push(abs);
      else if (entry.name.endsWith('.json')) out.push(abs);
    }
    await Promise.all(subdirs.map(walk));
  };
  await walk(base);
  return out.sort();
}

async function loadLangTables(root: string, code: string, warnings: string[], cache: LangFileCache): Promise<LangTables> {
  const base = path.join(root, LANG_DIR, code);
  const pass = cache.pass(`${base}${path.sep}`);
  const files = await listLangFiles(base);
  const loaded = await mapInBatches(files, async (abs) => {
    const rel = path.relative(base, abs).split(path.sep).join('/');
    const label = `${LANG_DIR}/${code}/${rel}`;
    try {
      return { rel, parsed: await pass.resolve(abs, (text) => parseLangFile(text, label)) };
    } catch (e) {
      return { rel, parsed: { table: {}, warnings: [`${label}: ${(e as Error).message}`] } };
    }
  });
  pass.finish();
  const tables: LangTables = new Map();
  for (const { rel, parsed } of loaded) {
    tables.set(rel, parsed.table);
    warnings.push(...parsed.warnings);
  }
  return tables;
}

function nonEmpty(tables: LangTables, file: string, key: string): string | null {
  const table = tables.get(file);
  return table && Object.hasOwn(table, key) && table[key] !== '' ? table[key] : null;
}

class LangStore {
  readonly warnings: string[] = [];
  private readonly fallback = new Set<string>();

  private constructor(
    readonly primary: string,
    readonly code: string,
    readonly available: string[],
    private readonly primaryTables: LangTables,
    private readonly codeTables: LangTables,
  ) {}

  static async open(root: string, requested: string | undefined, cache: LangFileCache): Promise<LangStore> {
    const warnings: string[] = [];
    const primary = await readPrimaryLang(root);
    const available = [...new Set([primary, ...(await listLangs(root))])].sort();
    const code = isLangCode(requested) && available.includes(requested) ? requested : primary;
    const primaryTables = await loadLangTables(root, primary, warnings, cache);
    const codeTables = code === primary ? primaryTables : await loadLangTables(root, code, warnings, cache);
    const store = new LangStore(primary, code, available, primaryTables, codeTables);
    store.warnings.push(...warnings);
    return store;
  }

  text(file: string, key: string, projectKey: string, inline = ''): string {
    const primaryText = nonEmpty(this.primaryTables, file, key) ?? (inline || null);
    if (!primaryText) return '';
    if (this.code === this.primary) return primaryText;
    const own = nonEmpty(this.codeTables, file, key);
    if (own) return own;
    this.fallback.add(projectKey);
    return primaryText;
  }

  summary(): LanternLanguage {
    const keys = [...this.fallback];
    return { primary: this.primary, code: this.code, available: this.available, fallbackCount: keys.length, fallbackKeys: keys.slice(0, MAX_FALLBACK_KEYS) };
  }
}

function langFileFor(mapFile: string, mapDir: string) {
  return `${mapFile.slice(mapDir.length + 1)}.json`;
}

function parseFeatures(text: string, warnings: string[]): Map<string, string> {
  const features = new Map<string, string>();
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim() || line.startsWith('#')) return;
    const { head, label } = splitLabel(line);
    if (!FEATURE_ID.test(head)) warnings.push(`${FEATURES_FILE}:${index + 1}: feature id "${head}" must be lowercase kebab-case`);
    else if (features.has(head)) warnings.push(`${FEATURES_FILE}:${index + 1}: duplicate feature "${head}"`);
    else features.set(head, label);
  });
  return features;
}

async function loadFeatures(root: string, store: LangStore, warnings: string[]): Promise<LanternFeature[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(path.join(root, FEATURES_FILE), 'utf8');
  } catch {
    return [];
  }
  return [...parseFeatures(text, warnings)].map(([id, inline]) => ({ id, description: store.text('features.json', id, `feature ${id}`, inline) }));
}

export { LangStore, isLangCode, langFileFor, loadFeatures, parseFeatures, parseLangFile, readExistingMapLang, readPrimaryLang };
export type { LangFileCache, ParsedLangFile };
