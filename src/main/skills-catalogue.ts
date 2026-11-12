import fs from 'node:fs';
import path from 'node:path';
import { resolveSkillLinker } from '@skills/lantern-delegate/scripts/skill-linker.mjs';

export interface CatalogueSkill {
  role: string;
  name: string;
  src: string;
}

const SKILL_FILE = 'SKILL.md';
const SKIPPED_FOLDERS = new Set(['node_modules', '.git']);

function findSkillDirs(root: string): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === SKILL_FILE)) found.push(dir);
    for (const entry of entries) if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) pending.push(path.join(dir, entry.name));
  }
  return found;
}

export function catalogueOf(repo: string): CatalogueSkill[] {
  if (!repo) return [];
  return findSkillDirs(repo)
    .map((src): CatalogueSkill | null => {
      const segments = path.relative(repo, src).split(path.sep);
      if (!segments[0] || segments[0].startsWith('.')) return null;
      if (segments.length === 1) return { role: '', name: segments[0], src };
      return { role: segments[0], name: segments.slice(1).join('-'), src };
    })
    .filter((skill): skill is CatalogueSkill => skill !== null)
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

export function catalogueSummary(repo: string): { skills: number; roles: number } {
  const all = catalogueOf(repo);
  return { skills: all.length, roles: new Set(all.map((skill) => skill.role).filter(Boolean)).size };
}

export function linkerRepo(home: string): string {
  const resolved = resolveSkillLinker({ env: { SKILL_LINKER: process.env.SKILL_LINKER }, home });
  return 'repo' in resolved && typeof resolved.repo === 'string' ? resolved.repo : '';
}
