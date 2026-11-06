import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST = 'manifest.json';
export const ANSWERS_NAME = 'answers.json';

export function findFiles(dir, name) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return findFiles(file, name);
    return e.name === name ? [file] : [];
  });
}
