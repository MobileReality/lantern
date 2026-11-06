import fs from 'node:fs';
import path from 'node:path';
import { mapInBatches } from './lantern-batch';
import { StampedCache } from './lantern-cache';
import { enumerateWithVerdicts } from './lantern-enumerate';
import type { SniffVerdict } from './lantern-enumerate';
import { MAP_DIR, parseMapFile } from './lantern-parse';
import type { ParsedRecord } from './lantern-parse';
import { SHARED, loadPlatformRules, resolvePlatform, summarizePlatforms } from './lantern-platforms';
import { deriveMacroView } from './lantern-macro';
import { readMacroAreas } from './lantern-macro-areas-read';
import { macroBlocksByPath } from './lantern-macro-files';
import { macroSystemsByPath } from './lantern-macro-systems';
import { areasHintPart } from './lantern-macro-hint';
import type { MacroData } from './lantern-macro-load';
import { loadPrs } from './lantern-prs';
import { fetchAndWarmPrs as fetchPrs } from './lantern-pr-warm';
import { loadPlans } from './lantern-plans';
import { loadSections } from './lantern-sections';
import { buildNodes } from './lantern-nodes';
import { LangStore, loadFeatures } from './lantern-texts';
import type { ParsedLangFile } from './lantern-texts';
import type { Freshness, LanternCoverage, LanternLanguage, LanternMap } from './lantern-types';

const MAX_UNMAPPED_IPC = 500;
const DEFAULT_LANGUAGE: LanternLanguage = { primary: 'en', code: 'en', available: [], fallbackCount: 0, fallbackKeys: [] };

async function listMapFiles(root: string): Promise<string[]> {
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
      else if (entry.name.endsWith('.lantern')) out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
    await Promise.all(subdirs.map(walk));
  };
  await walk(path.join(root, MAP_DIR));
  return out.sort();
}

type ParsedMapFile = ReturnType<typeof parseMapFile>;

interface ProjectCache {
  mapFiles: StampedCache<ParsedMapFile>;
  langFiles: StampedCache<ParsedLangFile>;
}

const MAX_CACHED_PROJECTS = 8;
const sniffCache = new Map<string, Map<string, SniffVerdict>>();
const projectCaches = new Map<string, ProjectCache>();
const graphFlights = new Map<string, Flight<LanternMap>>();
const coverageFlights = new Map<string, Flight<LanternCoverage>>();
const runs = { graph: 0, coverage: 0 };

function remember<V>(cache: Map<string, V>, root: string, value: V) {
  cache.delete(root);
  cache.set(root, value);
  while (cache.size > MAX_CACHED_PROJECTS) cache.delete(cache.keys().next().value as string);
}

function cacheFor(root: string): ProjectCache {
  const existing = projectCaches.get(root);
  const cache = existing ?? { mapFiles: new StampedCache<ParsedMapFile>(), langFiles: new StampedCache<ParsedLangFile>() };
  remember(projectCaches, root, cache);
  return cache;
}

function sizeOf(cache: Map<string, Map<string, unknown>>) {
  let entries = 0;
  for (const project of cache.values()) entries += project.size;
  return entries;
}

function cacheStats() {
  let mapFileReads = 0;
  let langFileReads = 0;
  for (const project of projectCaches.values()) {
    mapFileReads += project.mapFiles.reads;
    langFileReads += project.langFiles.reads;
  }
  return { sniffProjects: sniffCache.size, sniffEntries: sizeOf(sniffCache), parsedProjects: projectCaches.size, mapFileReads, langFileReads, graphRuns: runs.graph, coverageRuns: runs.coverage };
}

interface Flight<T> {
  running: Promise<T>;
  queued: Promise<T> | null;
}

function startFlight<T>(flights: Map<string, Flight<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const flight: Flight<T> = { running: Promise.resolve() as unknown as Promise<T>, queued: null };
  flight.running = run().finally(() => {
    if (!flight.queued && flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight.running;
}

function singleFlight<T>(flights: Map<string, Flight<T>>, key: string, run: () => Promise<T>, fresh: boolean): Promise<T> {
  const flight = flights.get(key);
  if (!flight) return startFlight(flights, key, run);
  if (!fresh) return flight.running;
  if (!flight.queued) {
    const settled = () => undefined;
    flight.queued = flight.running.then(settled, settled).then(() => startFlight(flights, key, run));
  }
  return flight.queued;
}

async function freshnessOf(root: string, rec: ParsedRecord): Promise<Freshness> {
  if (rec.marker !== '.') return 'fresh';
  const abs = path.resolve(root, rec.path);
  if (!abs.startsWith(root + path.sep)) return 'gone';
  try {
    await fs.promises.stat(abs);
    return 'fresh';
  } catch {
    return 'gone';
  }
}

async function readRecords(root: string, cache: StampedCache<ParsedMapFile>) {
  const files = await listMapFiles(root);
  const pass = cache.pass(path.join(root, MAP_DIR) + path.sep);
  const parsed = await mapInBatches(files, async (file) => {
    try {
      return await pass.resolve(path.join(root, file), (text) => parseMapFile(text, file));
    } catch (e) {
      return { records: [] as ParsedRecord[], errors: [`${file}: ${(e as Error).message}`] };
    }
  });
  pass.finish();
  const records: ParsedRecord[] = [];
  const errors: string[] = [];
  for (const one of parsed) {
    errors.push(...one.errors);
    records.push(...one.records);
  }
  return { mapFiles: files.length, records, errors };
}

class InvalidProjectError extends TypeError {
  constructor(received: unknown) {
    super(`lantern: project must be a non-empty string, got ${received === null ? 'null' : typeof received}`);
    this.name = 'InvalidProjectError';
  }
}

function requireProject(project: unknown): string {
  if (typeof project !== 'string' || !project.trim()) throw new InvalidProjectError(project);
  return project;
}

function emptyMap(projectPath: string): LanternMap {
  return {
    exists: false,
    project: path.basename(projectPath || ''),
    nodes: [],
    relations: [],
    errors: [],
    unmapped: [],
    unmappedCount: 0,
    total: 0,
    features: [],
    platforms: [],
    sections: [],
    warnings: [],
    language: DEFAULT_LANGUAGE,
    prs: [],
    plans: [],
    brokenPlans: [],
    coveragePending: false,
  };
}

async function loadPrsSafely(root: string, mapped: Set<string>) {
  try {
    return await loadPrs(root, mapped);
  } catch (e) {
    return { prs: [], warnings: [`pull requests: ${(e as Error).message}`] };
  }
}

async function buildGraph(projectPath: string, lang?: string): Promise<LanternMap> {
  runs.graph++;
  const empty = emptyMap(projectPath);
  const root = path.resolve(projectPath);
  const cache = cacheFor(root);
  const { mapFiles, records, errors } = await readRecords(root, cache.mapFiles);
  if (!mapFiles) {
    const pulls = await loadPrsSafely(root, new Set());
    return { ...empty, prs: pulls.prs, warnings: pulls.warnings };
  }
  const freshness = await mapInBatches(records, (rec) => freshnessOf(root, rec));
  const mapped = new Set(records.map((r) => r.path));

  const store = await LangStore.open(root, lang, cache.langFiles);
  const warnings = [...store.warnings];
  const features = await loadFeatures(root, store, warnings);
  const rules = await loadPlatformRules(root, warnings);
  const tabbed = rules.length >= 2;
  const platformOfPath = new Map<string, string>();
  const platformOf = (rel: string) => {
    if (!tabbed) return null;
    const id = platformOfPath.get(rel) ?? resolvePlatform(rules, rel);
    platformOfPath.set(rel, id);
    return id;
  };
  const { nodes, relations } = buildNodes(records, freshness, store, platformOf);
  const counts = new Map<string, number>();
  if (tabbed) {
    for (const rel of mapped) {
      const id = platformOf(rel) ?? SHARED;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const platforms = tabbed ? summarizePlatforms(rules, counts, store) : [];
  const sections = await loadSections(root, store, mapped, tabbed ? rules.map((r) => r.id) : null, warnings);
  const pulls = await loadPrsSafely(root, mapped);
  warnings.push(...pulls.warnings);
  const planned = await loadPlans(root, pulls.prs);
  warnings.push(...planned.warnings);

  return {
    ...empty,
    exists: true,
    nodes,
    relations,
    errors,
    features,
    platforms,
    sections,
    warnings,
    language: store.summary(),
    prs: pulls.prs,
    plans: planned.plans,
    brokenPlans: planned.broken,
    coveragePending: true,
  };
}

async function buildCoverage(root: string): Promise<LanternCoverage> {
  runs.coverage++;
  const { mapFiles, records } = await readRecords(root, cacheFor(root).mapFiles);
  if (!mapFiles) return { unmapped: [], unmappedCount: 0, total: 0 };
  const mapped = new Set(records.map((r) => r.path));
  const { files, verdicts } = await enumerateWithVerdicts(root, sniffCache.get(root));
  remember(sniffCache, root, verdicts);
  const allUnmapped = files.map((f) => f.path).filter((p) => !mapped.has(p));
  return { unmapped: allUnmapped.slice(0, MAX_UNMAPPED_IPC), unmappedCount: allUnmapped.length, total: files.length };
}

function flightKey(root: string, lang?: string) {
  return `${root}\0${lang ?? ''}`;
}

function loadGraph(projectPath: string, lang?: string, fresh = false): Promise<LanternMap> {
  if (!projectPath) return Promise.resolve(emptyMap(projectPath));
  const root = path.resolve(projectPath);
  return singleFlight(graphFlights, flightKey(root, lang), () => buildGraph(projectPath, lang), fresh);
}

function loadCoverage(projectPath: string, fresh = false): Promise<LanternCoverage> {
  if (!projectPath) return Promise.resolve({ unmapped: [], unmappedCount: 0, total: 0 });
  const root = path.resolve(projectPath);
  return singleFlight(coverageFlights, root, () => buildCoverage(root), fresh);
}

async function load(projectPath: string, lang?: string): Promise<LanternMap> {
  const [graph, coverage] = await Promise.all([loadGraph(projectPath, lang), loadCoverage(projectPath)]);
  return graph.exists ? { ...graph, ...coverage, coveragePending: false } : graph;
}

async function loadMacro(projectPath: string, lang?: string): Promise<MacroData | null> {
  const root = path.resolve(projectPath);
  const cache = cacheFor(root);
  const { mapFiles, records } = await readRecords(root, cache.mapFiles);
  if (!mapFiles) return null;
  const platforms = await loadPlatformRules(root, []);
  const store = await LangStore.open(root, lang, cache.langFiles);
  const features = await loadFeatures(root, store, []);
  const texts = Object.fromEntries(features.filter((feature) => feature.description).map((feature) => [feature.id, feature.description]));
  const areasPart = await readMacroAreas(root, store, records, platforms, new Set(features.map((feature) => feature.id)));
  return { view: deriveMacroView(records, { platforms }), texts, blockByPath: macroBlocksByPath(records, { platforms }), systemsByPath: macroSystemsByPath(records), ...areasPart, ...areasHintPart(records, areasPart) };
}

async function count(projectPath: string): Promise<number> {
  const root = path.resolve(projectPath);
  return (await readRecords(root, cacheFor(root).mapFiles)).records.length;
}

export { load, loadGraph, loadCoverage, loadMacro, count, fetchPrs, requireProject, parseMapFile, cacheStats, InvalidProjectError, MAX_CACHED_PROJECTS, MAX_UNMAPPED_IPC };
export type * from './lantern-types';
