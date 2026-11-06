import fs from 'node:fs';
import path from 'node:path';
import { parseIgnore } from './lantern-ignore';
import type { LangStore } from './lantern-texts';
import type { LanternPlatform, PlatformKind } from './lantern-types';

const PLATFORMS_FILE = '.lantern/platforms';
const KINDS: readonly PlatformKind[] = ['web', 'backend', 'mobile', 'desktop', 'infra', 'other'];
const SHARED = 'shared';
const RESERVED = new Set([SHARED, 'all']);
const ID = /^[a-z][a-z0-9-]*$/;

const KIND_LABELS: Record<PlatformKind | typeof SHARED, string> = {
  web: 'Web',
  backend: 'Backend',
  mobile: 'Mobile',
  desktop: 'Desktop',
  infra: 'Infrastructure',
  other: 'Other',
  shared: 'Shared',
};

interface PlatformRule {
  id: string;
  kind: PlatformKind;
  globs: { glob: string; regex: RegExp }[];
}

function parsePlatforms(text: string, warnings: string[]): PlatformRule[] {
  const platforms: PlatformRule[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, index) => {
    const where = `${PLATFORMS_FILE}:${index + 1}`;
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const [id, kind, ...rawGlobs] = line.trim().split(/\s+/);
    if (!ID.test(id)) {
      warnings.push(`${where}: platform id "${id}" must be lowercase kebab-case`);
      return;
    }
    if (RESERVED.has(id)) {
      warnings.push(`${where}: "${id}" is reserved`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`${where}: duplicate platform id "${id}"`);
      return;
    }
    if (!KINDS.includes(kind as PlatformKind)) {
      warnings.push(`${where}: unknown kind "${kind ?? ''}" for "${id}"`);
      return;
    }
    const globs: PlatformRule['globs'] = [];
    for (const raw of rawGlobs) {
      if (raw.startsWith('!')) {
        warnings.push(`${where}: "${raw}": negated rules are not supported`);
        continue;
      }
      const [rule] = parseIgnore(raw.endsWith('/') ? `${raw}**` : raw, '');
      if (rule) globs.push({ glob: raw, regex: rule.regex });
    }
    if (!globs.length) {
      warnings.push(`${where}: "${id}" has no usable path rule`);
      return;
    }
    seen.add(id);
    platforms.push({ id, kind: kind as PlatformKind, globs });
  });
  return platforms;
}

async function loadPlatformRules(root: string, warnings: string[]): Promise<PlatformRule[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(path.join(root, PLATFORMS_FILE), 'utf8');
  } catch {
    return [];
  }
  return parsePlatforms(text, warnings);
}

function resolvePlatform(platforms: PlatformRule[], rel: string): string {
  for (const platform of platforms) {
    if (platform.globs.some((g) => g.regex.test(rel))) return platform.id;
  }
  return SHARED;
}

function summarizePlatforms(rules: PlatformRule[], counts: Map<string, number>, store: LangStore): LanternPlatform[] {
  const label = (id: string, kind: PlatformKind | typeof SHARED) => store.text('platforms.json', id, `platform ${id}`) || KIND_LABELS[kind];
  const out: LanternPlatform[] = rules.map((p) => ({ id: p.id, kind: p.kind, label: label(p.id, p.kind), count: counts.get(p.id) ?? 0 }));
  const shared = counts.get(SHARED) ?? 0;
  if (shared > 0) out.push({ id: SHARED, kind: SHARED, label: label(SHARED, SHARED), count: shared });
  return out;
}

export { KIND_LABELS, PLATFORMS_FILE, SHARED, loadPlatformRules, parsePlatforms, resolvePlatform, summarizePlatforms };
export type { PlatformRule };
