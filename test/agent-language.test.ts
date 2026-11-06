import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as agent from '../src/main/agent';
import { readExistingMapLang } from '../src/main/lantern-texts';

const spawned = vi.hoisted(() => ({ calls: [] as Array<{ env: NodeJS.ProcessEnv }> }));

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, _args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    spawned.calls.push({ env: opts.env });
    const p = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => true;
    return p;
  },
}));

const dirs: string[] = [];

function project(lang?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-run-lang-'));
  dirs.push(dir);
  if (lang) {
    fs.mkdirSync(path.join(dir, '.lantern', 'map'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.lantern', 'lang', lang), { recursive: true });
  }
  return dir;
}

function runLang(dir: string, language?: string, kind: 'lantern' | 'lantern-refresh' = 'lantern-refresh') {
  const res = agent.start({ project: dir, kind, language, onEvent: () => {} });
  expect(res.ok).toBe(true);
  const env = spawned.calls.at(-1)?.env.LANTERN_LANG;
  agent.cancel();
  return env;
}

beforeEach(() => {
  vi.stubEnv('LANTERN_LANG', '');
  agent.setConfiguredBin(() => process.execPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  agent.setConfiguredBin(() => '');
  agent.cancel();
  spawned.calls.length = 0;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('runLanguageCode', () => {
  it('prefers an explicit request, then the map, then English', () => {
    expect(agent.runLanguageCode('Polish', 'en')).toBe('pl');
    expect(agent.runLanguageCode('English', 'pl')).toBe('en');
    expect(agent.runLanguageCode(undefined, 'pl')).toBe('pl');
    expect(agent.runLanguageCode(undefined, null)).toBe('en');
    expect(agent.runLanguageCode('', null)).toBe('en');
  });
});

describe('readExistingMapLang', () => {
  it('reads the map language and is null without a map', () => {
    expect(readExistingMapLang(project('pl'))).toBe('pl');
    expect(readExistingMapLang(project())).toBeNull();
    expect(readExistingMapLang(path.join(os.tmpdir(), 'ccm-run-lang-missing'))).toBeNull();
  });

  it('honours the project .ai/.env setting like the UI does', () => {
    const dir = project('pl');
    fs.mkdirSync(path.join(dir, '.ai'));
    fs.writeFileSync(path.join(dir, '.ai', '.env'), 'LANTERN_LANG=de\n');
    expect(readExistingMapLang(dir)).toBe('de');
  });
});

describe('agent.start picks LANTERN_LANG for a Lantern run', () => {
  it('uses the map language when no language was requested', () => {
    expect(runLang(project('pl'))).toBe('pl');
    expect(runLang(project('pl'), undefined, 'lantern')).toBe('pl');
  });

  it('lets an explicit language win', () => {
    expect(runLang(project('pl'), 'English')).toBe('en');
    expect(runLang(project('en'), 'German')).toBe('de');
  });

  it('keeps English for a project without a map', () => {
    expect(runLang(project())).toBe('en');
  });

  it('falls back to English when the map has no readable language', () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, '.lantern'));
    fs.writeFileSync(path.join(dir, '.lantern', 'map'), 'not a folder');
    expect(runLang(dir)).toBe('en');
  });
});

describe('Lantern prompts', () => {
  it.each(['lantern', 'lantern-refresh'] as const)('%s tells the agent nobody can answer and to keep the map language', (kind) => {
    const prompt = agent.buildPrompt(kind);
    expect(prompt).toContain('Nobody can answer you');
    expect(prompt).toContain('never end it by asking the user a question');
    expect(prompt).toContain("keep the map's existing primary language and continue");
  });
});
