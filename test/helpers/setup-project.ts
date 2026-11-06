import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashContent } from '../../skills/lantern-setup/scripts/lib.mjs';

const BIG_FILES = 60;
const SMALL_FILES = 3;

interface SetupProject {
  root: string;
  bigFiles: string[];
  smallFiles: string[];
}

function sourceOf(rel: string) {
  return `export const name = '${rel}';\n`;
}

// 63 tiny source files that plan.mjs packs into three chunks: big/ files 0-24, big/ files 25-49,
// and the last 10 big/ files together with small/.
function makeSetupProject(): SetupProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-setup-'));
  const bigFiles = Array.from({ length: BIG_FILES }, (_, i) => `big/f${String(i).padStart(2, '0')}.ts`);
  const smallFiles = Array.from({ length: SMALL_FILES }, (_, i) => `small/s${i}.ts`);
  for (const rel of [...bigFiles, ...smallFiles]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), sourceOf(rel));
  }
  return { root, bigFiles, smallFiles };
}

function mapFiles(root: string, files: string[]) {
  for (const dir of new Set(files.map((f) => path.dirname(f)))) {
    const inDir = files.filter((f) => path.dirname(f) === dir);
    const records = inDir.map((rel) => `${rel} . service ${hashContent(Buffer.from(sourceOf(rel)))}`);
    const mapFile = path.join(root, '.lantern', 'map', `${dir}.lantern`);
    fs.mkdirSync(path.dirname(mapFile), { recursive: true });
    fs.writeFileSync(mapFile, `lantern 1\n# ${dir}\n\n${records.join('\n')}\n`);
    const text = Object.fromEntries(inDir.map((rel) => [path.basename(rel), `purpose of ${rel}`]));
    const langFile = path.join(root, '.lantern', 'lang', 'en', `${dir}.lantern.json`);
    fs.mkdirSync(path.dirname(langFile), { recursive: true });
    fs.writeFileSync(langFile, `${JSON.stringify({ text }, null, 1)}\n`);
  }
}

function writeLantern(root: string, rel: string, text = '') {
  const file = path.join(root, '.lantern', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export { makeSetupProject, mapFiles, writeLantern };
export type { SetupProject };
