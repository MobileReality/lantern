import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashContent } from '../../skills/lantern-setup/scripts/lib.mjs';

const SCRIPTS = path.join(__dirname, '..', '..', 'skills', 'lantern-setup', 'scripts');

interface FixtureFile {
  path: string;
  feature?: string;
  relations?: string[];
  role?: string;
}

interface FixtureSpec {
  files: FixtureFile[];
  features?: string[];
  platforms?: string[];
  systems?: string[];
  areas?: string;
  areaTexts?: Record<string, string>;
}

const roots: string[] = [];

function sourceOf(rel: string) {
  return `export const name = '${rel}';\n`;
}

function write(root: string, rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function recordLines(file: FixtureFile) {
  const head = `${file.path} . ${file.role ?? 'service'} ${hashContent(Buffer.from(sourceOf(file.path)))}`;
  const tag = file.feature ? [`#feature ${file.feature}`] : [];
  return [head, ...tag, ...(file.relations ?? []).map((relation) => `  ${relation}`)];
}

function writeMap(root: string, files: FixtureFile[]) {
  const dirs = [...new Set(files.map((f) => path.posix.dirname(f.path)))];
  for (const dir of dirs) {
    const inDir = files.filter((f) => path.posix.dirname(f.path) === dir).sort((a, b) => (a.path < b.path ? -1 : 1));
    const mapName = dir === '.' ? '.lantern' : `${dir}.lantern`;
    write(root, `.lantern/map/${mapName}`, `lantern 1\n# ${dir}\n\n${inDir.flatMap(recordLines).join('\n')}\n`);
    const text = Object.fromEntries(inDir.map((f) => [path.posix.basename(f.path), `purpose of ${f.path}`]));
    write(root, `.lantern/lang/en/${mapName}.json`, `${JSON.stringify({ text }, null, 1)}\n`);
  }
}

function makeVocabProject(spec: FixtureSpec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-vocab-'));
  roots.push(root);
  for (const file of spec.files) write(root, file.path, sourceOf(file.path));
  writeMap(root, spec.files);
  if (spec.features) {
    write(root, '.lantern/features', `${spec.features.join('\n')}\n`);
    write(root, '.lantern/lang/en/features.json', `${JSON.stringify({ text: Object.fromEntries(spec.features.map((f) => [f, `what ${f} covers`])) }, null, 1)}\n`);
  }
  if (spec.platforms) write(root, '.lantern/platforms', `${spec.platforms.join('\n')}\n`);
  if (spec.systems) {
    write(root, '.lantern/systems', `# outside systems\n${spec.systems.join('\n')}\n`);
    write(root, '.lantern/lang/en/systems.json', `${JSON.stringify({ text: Object.fromEntries(spec.systems.map((s) => [s, `what ${s} is`])) }, null, 1)}\n`);
  }
  if (spec.areas !== undefined) write(root, '.lantern/areas', spec.areas);
  if (spec.areaTexts) write(root, '.lantern/lang/en/areas.json', `${JSON.stringify({ text: spec.areaTexts }, null, 1)}\n`);
  return root;
}

function removeVocabProjects() {
  roots.splice(0).forEach((root) => { fs.rmSync(root, { recursive: true, force: true }); });
}

function runScript(name: string, args: string[]) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, name), ...args], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

function snapshotLantern(root: string) {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(path.join(root, '.lantern'));
  return out;
}

export { makeVocabProject, removeVocabProjects, runScript, snapshotLantern };
export type { FixtureFile, FixtureSpec };
