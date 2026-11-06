import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts');
const PROTECTED_FOLDER = '.claude';

let project: string;

function put(rel: string, text: string) {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function script(name: string, ...args: string[]) {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, name), project, ...args], { encoding: 'utf8', env: { ...process.env, LANTERN_LANG: 'en' } });
  return { status: res.status, out: res.stdout, err: res.stderr };
}

// What Claude Code does to an agent's Write or Edit: a path with a .claude folder, wherever it sits, is a sensitive file and is refused in a headless run.
function writeAsClaudeCode(rel: string, text: string) {
  if (rel.split('/').includes(PROTECTED_FOLDER)) throw new Error(`Claude requested permissions to edit ${rel} which is a sensitive file.`);
  put(rel, text);
}

const dirOfMapFile = (mapFile: string) => (mapFile === '.lantern/map/.lantern' ? '.' : mapFile.slice('.lantern/map/'.length, -'.lantern'.length));

// A mapper that follows only what `plan.mjs chunk` prints: the paths it is told to write, then fold.mjs.
function mapChunk() {
  const lines = script('plan.mjs', 'chunk', '1').out.split('\n');
  const alias = new Map(lines.flatMap((line) => (line.startsWith('#   ') ? [line.slice(4).split(' -> ') as [string, string]] : [])));
  const todo = lines.filter((line) => !line.startsWith('#') && line.includes(' todo ')).map((line) => line.split(' '));
  const byMapFile = new Map<string, string[][]>();
  for (const row of todo) byMapFile.set(row[4], [...(byMapFile.get(row[4]) ?? []), row]);
  for (const [mapFile, rows] of byMapFile) {
    const records = rows.map(([file, hash]) => `${file} . ${path.basename(file) === 'SKILL.md' ? 'skill' : 'util'} ${hash}`);
    const text = Object.fromEntries(rows.map(([file]) => [path.basename(file), `purpose of ${file}`]));
    const langFile = mapFile.replace('.lantern/map/', '.lantern/lang/en/') + '.json';
    writeAsClaudeCode(alias.get(mapFile) ?? mapFile, `lantern 1\n# ${dirOfMapFile(mapFile)}\n\n${records.join('\n')}\n`);
    writeAsClaudeCode(alias.get(langFile) ?? langFile, `${JSON.stringify({ text })}\n`);
  }
  if (alias.size) script('fold.mjs');
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-claude-folder-'));
  put('package.json', '{"name":"demo"}\n');
  put('src/index.js', 'export const hi = () => "hi";\n');
  put('.claude/skills/release-notes/SKILL.md', '---\nname: release-notes\ndescription: Write release notes.\n---\n\n# Release notes\n');
  put('.claude/skills/team-checks/SKILL.md', '---\nname: team-checks\ndescription: Checks before a pull request.\n---\n\n# Team checks\n');
  put('.lantern/features', '# no features\n');
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe('mapping the SKILL.md files under .claude/skills', () => {
  it('reaches a settled map when the agent can only write outside a .claude folder', () => {
    mapChunk();

    const validated = script('validate.mjs', '--settled');
    expect(validated.err + validated.out).not.toContain('unmapped');
    expect({ status: validated.status, out: validated.err + validated.out }).toMatchObject({ status: 0 });
    for (const name of ['release-notes', 'team-checks']) {
      expect(fs.existsSync(path.join(project, '.lantern', 'map', '.claude', 'skills', `${name}.lantern`))).toBe(true);
      expect(fs.existsSync(path.join(project, '.lantern', 'lang', 'en', '.claude', 'skills', `${name}.lantern.json`))).toBe(true);
    }
  });

  it('leaves no alias folder behind and lets a second pass see nothing pending', () => {
    mapChunk();

    expect(fs.existsSync(path.join(project, '.lantern', 'map', '%2Eclaude'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.lantern', 'lang', 'en', '%2Eclaude'))).toBe(false);
    expect(script('plan.mjs', 'pending').out).toContain('ALL DONE');
  });

  it('prints no alias note for a project without a .claude folder in its map', () => {
    fs.rmSync(path.join(project, '.claude'), { recursive: true });

    expect(script('plan.mjs', 'chunk', '1').out).not.toContain('%2Eclaude');
  });

  it('replaces a record that already sits under .claude when it is written whole at the alias', () => {
    mapChunk();
    put('.claude/skills/team-checks/SKILL.md', '---\nname: team-checks\ndescription: Changed.\n---\n');

    expect(script('plan.mjs', 'pending').out).toContain('1 pending');
    mapChunk();

    expect(script('validate.mjs', '--settled').status).toBe(0);
  });
});
