import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMacro } from '../src/main/lantern';
import { MIN_STRONG_EDGE } from '../src/main/lantern-macro';
import { NO_MAP, readRegisteredMacro } from '../src/main/lantern-macro-load';
import { macroSystemsByPath } from '../src/main/lantern-macro-systems';
import { ipcHandler } from './helpers/source-blocks';
import { macroFixtureBlocks, macroFixtureRecords, macroFixtureView } from './helpers/lantern-macro-fixture';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'lantern-macro');
const registeredOnly = (...dirs: string[]) => (dir: string) => dirs.some((registered) => path.resolve(registered) === path.resolve(dir));

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('lantern:macro handler', () => {
  it('returns deriveMacroView of the registered project', async () => {
    const result = await readRegisteredMacro(registeredOnly(FIXTURE_ROOT), loadMacro, FIXTURE_ROOT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view).toEqual(macroFixtureView());
    expect(result.view.blocks.length).toBeGreaterThan(0);
    expect(result.view.edges.length).toBeGreaterThan(0);
    expect(result.minStrongEdge).toBe(MIN_STRONG_EDGE);
    expect(result.texts).toEqual({});
  });

  it('names the block of every shipped record, the same block deriveMacroView counts it in', async () => {
    const result = await readRegisteredMacro(registeredOnly(FIXTURE_ROOT), loadMacro, FIXTURE_ROOT);

    if (!result.ok) throw new Error(result.error);
    expect(result.blockByPath).toEqual(macroFixtureBlocks());
    const perBlock = new Map<string, number>();
    for (const block of Object.values(result.blockByPath)) perBlock.set(block, (perBlock.get(block) ?? 0) + 1);
    expect(result.view.blocks.map((block) => [block.id, block.files])).toEqual(result.view.blocks.map((block) => [block.id, perBlock.get(block.id)]));
    expect(Object.keys(result.blockByPath)).toHaveLength(result.view.recordCount - result.view.testCount);
  });

  it('carries the outside systems of every shipped file, which the block view cannot give', async () => {
    const result = await readRegisteredMacro(registeredOnly(FIXTURE_ROOT), loadMacro, FIXTURE_ROOT);

    if (!result.ok) throw new Error(result.error);
    expect(result.systemsByPath).toEqual(macroSystemsByPath(macroFixtureRecords()));
    expect(Object.keys(result.systemsByPath).length).toBeGreaterThan(0);
    for (const path of Object.keys(result.systemsByPath)) expect(result.blockByPath).toHaveProperty([path]);
  });

  it('refuses a project that is not registered, without reading it', async () => {
    const source = vi.fn();

    const result = await readRegisteredMacro(registeredOnly('/somewhere/else'), source, FIXTURE_ROOT);

    expect(result).toEqual({ ok: false, error: 'not a registered project' });
    expect(source).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, '', '   ', {}, ['x']])('refuses %j as a project', async (project) => {
    const source = vi.fn();

    const result = await readRegisteredMacro(() => true, source, project);

    expect(result).toEqual({ ok: false, error: 'invalid project' });
    expect(source).not.toHaveBeenCalled();
  });

  it('does not accept a path that only looks like a registered one', async () => {
    const result = await readRegisteredMacro(registeredOnly(FIXTURE_ROOT), loadMacro, path.join(FIXTURE_ROOT, '..'));

    expect(result).toEqual({ ok: false, error: 'not a registered project' });
  });

  it('reports a registered project that has no map', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-macro-empty-'));
    scratch.push(empty);

    const result = await readRegisteredMacro(registeredOnly(empty), loadMacro, empty);

    expect(result).toEqual({ ok: false, error: NO_MAP });
  });

  it('turns a failure while reading into an error result instead of a rejection', async () => {
    const result = await readRegisteredMacro(() => true, () => Promise.reject(new Error('disk gone')), '/p');

    expect(result).toEqual({ ok: false, error: 'disk gone' });
  });
});

const MAP = ['lantern 1', '# .', '', 'src/a.ts . util aaaaaaaaaaaa', '#feature session-monitoring', 'src/b.ts . util bbbbbbbbbbbb', '#feature notifications', 'src/c.ts . util cccccccccccc', '#feature lantern-map', ''].join('\n');
const FEATURES = ['session-monitoring', 'notifications', 'lantern-map', ''].join('\n');
const langFile = (text: Record<string, string>) => JSON.stringify({ text });

function projectWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-macro-texts-'));
  scratch.push(root);
  for (const [name, content] of Object.entries({ '.lantern/map/.lantern': MAP, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

async function textsOf(root: string, lang?: string) {
  const result = await readRegisteredMacro(() => true, loadMacro, root, lang);
  if (!result.ok) throw new Error(result.error);
  return result.texts;
}

describe('lantern:macro texts', () => {
  const english = { 'session-monitoring': 'watching Claude Code sessions across VS Code windows', 'lantern-map': 'reading and drawing the architecture map' };
  const polish = { 'session-monitoring': 'obserwowanie sesji Claude Code w oknach VS Code' };
  const both = { '.lantern/features': FEATURES, '.lantern/lang/en/features.json': langFile(english), '.lantern/lang/pl/features.json': langFile(polish) };

  it('returns the purpose stored for each feature in the map language', async () => {
    const texts = await textsOf(projectWith(both));

    expect(texts).toEqual(english);
  });

  it('leaves out a feature that has no text instead of inventing one', async () => {
    const texts = await textsOf(projectWith(both));

    expect(texts).not.toHaveProperty('notifications');
    expect(Object.keys(texts)).toEqual(['session-monitoring', 'lantern-map']);
  });

  it('returns no texts when the map has no feature texts at all', async () => {
    expect(await textsOf(projectWith({}))).toEqual({});
    expect(await textsOf(projectWith({ '.lantern/features': FEATURES }))).toEqual({});
  });

  it('returns the texts of another language, falling back per feature to the primary one', async () => {
    const texts = await textsOf(projectWith(both), 'pl');

    expect(texts['session-monitoring']).toBe(polish['session-monitoring']);
    expect(texts['lantern-map']).toBe(english['lantern-map']);
    expect(texts).not.toHaveProperty('notifications');
  });

  it('uses the primary language when the requested one does not exist', async () => {
    expect(await textsOf(projectWith(both), 'xx')).toEqual(english);
  });

  it('does not change the view', async () => {
    const withTexts = await readRegisteredMacro(() => true, loadMacro, projectWith(both));
    const without = await readRegisteredMacro(() => true, loadMacro, projectWith({}));

    if (!withTexts.ok || !without.ok) throw new Error('the macro view did not load');
    expect(withTexts.view).toEqual(without.view);
  });
});

describe('lantern:macro wiring', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'workspace.ts'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'features', 'lantern.ts'), 'utf8');
  const handler = () => ipcHandler(mainSource, 'lantern:macro').text;

  it('registers the channel behind the trusted-sender wrapper', () => {
    expect(handler()).toMatch(/^\(\s*'lantern:macro',\s*fromWorkspace\(/);
  });

  it('checks the project against the registered projects before reading', () => {
    expect(handler()).toMatch(/readRegisteredMacro\(\s*isRegisteredDir\b/);
  });

  it('passes the viewer language from the preload and the renderer on to the reader', () => {
    expect(preloadSource).toMatch(/lanternMacro:\s*\(project: string, lang\?: string\)\s*=>\s*ipcRenderer\.invoke\('lantern:macro', project, lang\)/);
    expect(handler()).toMatch(/readRegisteredMacro\([^]*\bproject,\s*lang\s*\)/);
    expect(rendererSource).toMatch(/lanternMacro\(project,\s*app\.lanternLang\.get\(project\)\)/);
  });
});
