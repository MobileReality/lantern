import fs from 'node:fs';
import { resolveRoot } from '@main/projectroot';

const real = (dir: string): string | null => {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return null;
  }
};

function knownProject(dir: string, opened: string[]): string | null {
  const resolved = real(dir);
  if (resolved === null) return null;
  const byReal = new Map(opened.flatMap((project) => {
    const key = real(project);
    return key === null ? [] : [[key, project] as const];
  }));
  const root = resolveRoot(resolved, [...byReal.keys()]);
  return byReal.get(root) ?? null;
}

export { knownProject };
