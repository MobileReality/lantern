import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveLanguage } from '../src/main/languages';

const PROJECT_SETTINGS = path.join('.lantern', 'settings.json');

let project: string;
const projectFile = (body: string) => {
  fs.mkdirSync(path.join(project, '.lantern'), { recursive: true });
  fs.writeFileSync(path.join(project, PROJECT_SETTINGS), body);
};

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'map-lang-'));
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

describe('the map language', () => {
  it('takes the team setting in .lantern/settings.json over the user setting and the old pick', () => {
    projectFile('{ "language.map": "polish" }');
    expect(resolveLanguage(project, 'language.map', { user: 'german', fallback: () => 'french' })).toBe('polish');
  });

  it('falls back to the user setting, then the old per-project pick, then nothing', () => {
    expect(resolveLanguage(project, 'language.map', { user: 'german', fallback: () => 'french' })).toBe('german');
    expect(resolveLanguage(project, 'language.map', { user: undefined, fallback: () => 'french' })).toBe('french');
    expect(resolveLanguage(project, 'language.map', { user: undefined, fallback: () => undefined })).toBeUndefined();
  });

  it('lets a user choice of english win over the old per-project pick', () => {
    expect(resolveLanguage(project, 'language.map', { user: 'english', fallback: () => 'polish' })).toBe('english');
  });

  it('treats automatic as no choice and reads a capitalised pick from the old selector', () => {
    projectFile('{ "language.map": "automatic" }');
    expect(resolveLanguage(project, 'language.map', { user: 'automatic', fallback: () => 'Polish' })).toBe('polish');
  });

  it('ignores an unknown language or a broken project file', () => {
    projectFile('{ "language.map": "klingon" }');
    expect(resolveLanguage(project, 'language.map', { user: 'german', fallback: () => undefined })).toBe('german');
    projectFile('{ not json');
    expect(resolveLanguage(project, 'language.map', { user: 'german', fallback: () => undefined })).toBe('german');
  });
});

describe('the explainer language', () => {
  it('takes its own project and user settings, then falls back to the map language', () => {
    projectFile('{ "language.map": "polish", "language.explainers": "german" }');
    expect(resolveLanguage(project, 'language.explainers', { user: 'french', fallback: () => 'polish' })).toBe('german');
    projectFile('{ "language.map": "polish" }');
    expect(resolveLanguage(project, 'language.explainers', { user: 'french', fallback: () => 'polish' })).toBe('french');
    expect(resolveLanguage(project, 'language.explainers', { user: undefined, fallback: () => 'polish' })).toBe('polish');
  });
});

describe('the language settings', () => {
  it('default to automatic, so picking english is a real choice', async () => {
    const { SETTING_DEFAULTS, settingSchema } = await import('../src/shared/settings-registry');
    for (const key of ['language.map', 'language.explainers'] as const) {
      expect(SETTING_DEFAULTS[key]).toBe('automatic');
      expect(settingSchema(key)).toMatchObject({ enum: expect.arrayContaining(['automatic', 'english', 'polish']) });
    }
  });
});
