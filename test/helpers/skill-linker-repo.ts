import fs from 'node:fs';
import path from 'node:path';

export const LINKER_REPO_SKILLS: ReadonlyArray<readonly [role: string, name: string]> = [
  ['core', 'code-principles'],
  ['desktop', 'electron-ipc'],
  ['desktop', 'electron-security'],
  ['research', 'web-research'],
  ['research', 'ai-ml-autoresearch'],
];

export const LINKER_REPO_ROLES = 3;
export const LINKER_NAME = 'umrskill';

export function makeLinkerRepo(dir: string, skills: ReadonlyArray<readonly [string, string]> = LINKER_REPO_SKILLS) {
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  for (const [role, name] of skills) {
    const skill = path.join(dir, role, name);
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
  }
  const linker = path.join(dir, LINKER_NAME);
  fs.writeFileSync(linker, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(linker, 0o755);
  return { repo: dir, linker };
}

export function writeLinkerConfig(home: string, linker: string, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify({ ...extra, skillLinker: linker }));
}
