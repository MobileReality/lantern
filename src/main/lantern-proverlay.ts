import path from 'node:path';
import { mapInBatches } from './lantern-batch';
import { git } from './lantern-git';
import { buildNodes } from './lantern-nodes';
import type { TextSource } from './lantern-nodes';
import { MAP_DIR, ROOT_MAP_NAME, dirOf, parseMapFile } from './lantern-parse';
import type { ParsedRecord } from './lantern-parse';
import { isLocalId, localPrs } from './lantern-local';
import { REMOTE_PREFIX } from './lantern-pr-remote';
import { loadPlatformRules, resolvePlatform } from './lantern-platforms';
import { loadPrsDetailed } from './lantern-prs';
import { isLangCode, langFileFor, parseLangFile, readPrimaryLang } from './lantern-texts';
import type { LanternPr, LanternPrOverlay } from './lantern-types';

const PR_ID = /^\d{1,12}$/;
const LANG_DIR = '.lantern/lang';
const MAX_CACHED_OVERLAYS = 16;
const GIT_PARALLEL = 6;

const overlayCache = new Map<string, LanternPrOverlay>();

function remember(key: string, value: LanternPrOverlay) {
  overlayCache.delete(key);
  overlayCache.set(key, value);
  while (overlayCache.size > MAX_CACHED_OVERLAYS) overlayCache.delete(overlayCache.keys().next().value as string);
}

function emptyOverlay(prId: string, tip = ''): LanternPrOverlay {
  return { prId, tip, nodes: [], relations: [], missing: [], warnings: [] };
}

function mapFileOf(rel: string) {
  const dir = dirOf(rel);
  return dir === '.' ? `${MAP_DIR}/${ROOT_MAP_NAME}` : `${MAP_DIR}/${dir}.lantern`;
}

async function showAt(root: string, tip: string, rel: string): Promise<string | null> {
  const res = await git(root, ['show', `${tip}:${rel}`]);
  return res.ok ? res.stdout : null;
}

async function branchTip(root: string, pr: LanternPr) {
  const res = await git(root, ['rev-parse', '--verify', '--quiet', `${REMOTE_PREFIX}${pr.branch}^{commit}`]);
  return res.ok ? res.stdout.trim() : '';
}

type Tables = Map<string, Record<string, string>>;

async function branchTables(root: string, tip: string, code: string, files: string[], warnings: string[]): Promise<Tables> {
  const tables: Tables = new Map();
  const loaded = await mapInBatches(
    files,
    async (file) => {
      const rel = `${LANG_DIR}/${code}/${file}`;
      const text = await showAt(root, tip, rel);
      return { file, parsed: text === null ? null : parseLangFile(text, `origin/${rel}`) };
    },
    GIT_PARALLEL,
  );
  for (const { file, parsed } of loaded) {
    if (!parsed) continue;
    tables.set(file, parsed.table);
    warnings.push(...parsed.warnings);
  }
  return tables;
}

function textSource(primary: string, code: string, primaryTables: Tables, codeTables: Tables): TextSource {
  const own = (tables: Tables, file: string, key: string) => {
    const table = tables.get(file);
    return table && Object.hasOwn(table, key) && table[key] !== '' ? table[key] : null;
  };
  return {
    text(file, key, _projectKey, inline = '') {
      const primaryText = own(primaryTables, file, key) ?? (inline || null);
      if (!primaryText) return '';
      return code === primary ? primaryText : (own(codeTables, file, key) ?? primaryText);
    },
  };
}

async function readRecords(root: string, tip: string, wanted: Set<string>, warnings: string[]) {
  const mapFiles = [...new Set([...wanted].map(mapFileOf))].sort();
  const shown = await mapInBatches(mapFiles, async (file) => ({ file, text: await showAt(root, tip, file) }), GIT_PARALLEL);
  const records: ParsedRecord[] = [];
  for (const { file, text } of shown) {
    if (text === null) continue;
    const parsed = parseMapFile(text, file);
    warnings.push(...parsed.errors.map((e) => `origin/${e}`));
    records.push(...parsed.records.filter((r) => wanted.has(r.path)));
  }
  return { mapFiles, records };
}

async function buildOverlay(root: string, pr: LanternPr, tip: string, lang: string | undefined): Promise<LanternPrOverlay> {
  const overlay = emptyOverlay(pr.id, tip);
  const kinds = new Map(pr.files.filter((f) => f.kind !== 'removed').map((f) => [f.path, f.kind]));
  if (!kinds.size) return overlay;
  const { mapFiles, records } = await readRecords(root, tip, new Set(kinds.keys()), overlay.warnings);

  const primary = await readPrimaryLang(root);
  const code = isLangCode(lang) ? lang : primary;
  const langFiles = mapFiles.map((f) => langFileFor(f, MAP_DIR));
  const primaryTables = await branchTables(root, tip, primary, langFiles, overlay.warnings);
  const codeTables = code === primary ? primaryTables : await branchTables(root, tip, code, langFiles, overlay.warnings);

  const rules = await loadPlatformRules(root, overlay.warnings);
  const platformOf = (rel: string) => (rules.length >= 2 ? resolvePlatform(rules, rel) : null);
  const built = buildNodes(records, records.map(() => 'fresh' as const), textSource(primary, code, primaryTables, codeTables), platformOf);
  overlay.nodes = built.nodes.map((n) => (kinds.get(n.path) === 'added' ? { ...n, prNew: true as const } : n));
  overlay.relations = built.relations;
  const found = new Set(records.map((r) => r.path));
  overlay.missing = [...kinds.keys()].filter((p) => !found.has(p));
  return overlay;
}

async function loadPrOverlay(project: unknown, prId: unknown, lang?: string): Promise<LanternPrOverlay> {
  if (typeof project !== 'string' || !project.trim() || typeof prId !== 'string' || !(PR_ID.test(prId) || isLocalId(prId))) return emptyOverlay(typeof prId === 'string' ? prId : '');
  try {
    const root = path.resolve(project);
    const prs = isLocalId(prId) ? await localPrs(root, [prId], new Set()) : (await loadPrsDetailed(root, new Set())).prs;
    const pr = prs.find((p) => p.id === prId);
    if (!pr || pr.state !== 'open') return emptyOverlay(prId);
    const tip = pr.tip ?? (await branchTip(root, pr));
    if (!tip) return emptyOverlay(prId);
    const key = `${root}\0${prId}\0${tip}\0${lang ?? ''}`;
    const cached = overlayCache.get(key);
    if (cached) return cached;
    const overlay = await buildOverlay(root, pr, tip, lang);
    remember(key, overlay);
    return overlay;
  } catch (e) {
    return { ...emptyOverlay(prId), warnings: [`pull request overlay: ${(e as Error).message}`] };
  }
}

async function loadRegisteredPrOverlay(isRegistered: (dir: string) => boolean, project: unknown, prId: unknown, lang?: string): Promise<LanternPrOverlay> {
  if (typeof project !== 'string' || !project.trim() || !isRegistered(project)) return emptyOverlay(typeof prId === 'string' ? prId : '');
  return loadPrOverlay(project, prId, lang);
}

function overlayCacheSize() {
  return overlayCache.size;
}

export { loadPrOverlay, loadRegisteredPrOverlay, overlayCacheSize, MAX_CACHED_OVERLAYS };
