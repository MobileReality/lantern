import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureEditorSettingsFile, mergeEditorSettings } from '../src/main/serveweb-settings';

const WORKTREES = '**/.claude/worktrees';
const WORKTREES_CONTENTS = '**/.claude/worktrees/**';

describe('mergeEditorSettings', () => {
  it('fills an empty settings object', () => {
    const { settings, changed } = mergeEditorSettings({});
    expect(changed).toBe(true);
    expect(settings).toEqual({
      'security.workspace.trust.enabled': false,
      'js/ts.tsserver.maxMemory': 2048,
      'typescript.tsserver.maxTsServerMemory': 2048,
      'files.exclude': { [WORKTREES]: true },
      'search.exclude': { [WORKTREES]: true },
      'files.watcherExclude': { [WORKTREES]: true, [WORKTREES_CONTENTS]: true },
    });
  });

  it('does not create watchOptions, which would replace the default "vscode" watcher', () => {
    const empty = mergeEditorSettings({}).settings;
    expect(empty).not.toHaveProperty('typescript.tsserver.watchOptions');
    expect(empty).not.toHaveProperty('js/ts.tsserver.watchOptions');
    const { settings, changed } = mergeEditorSettings({
      'typescript.tsserver.watchOptions': 'vscode',
      'js/ts.tsserver.watchOptions': 'vscode',
    });
    expect(settings['typescript.tsserver.watchOptions']).toBe('vscode');
    expect(settings['js/ts.tsserver.watchOptions']).toBe('vscode');
    expect(changed).toBe(true);
    expect(mergeEditorSettings(settings).changed).toBe(false);
  });

  it('adds excludeDirectories to the unified watchOptions object', () => {
    const { settings } = mergeEditorSettings({ 'js/ts.tsserver.watchOptions': { watchFile: 'useFsEvents' } });
    expect(settings['js/ts.tsserver.watchOptions']).toEqual({
      watchFile: 'useFsEvents',
      excludeDirectories: [WORKTREES],
    });
    expect(settings).not.toHaveProperty('typescript.tsserver.watchOptions');
  });

  it('copies the old memory cap the user set to the unified key', () => {
    const { settings } = mergeEditorSettings({ 'typescript.tsserver.maxTsServerMemory': 4096 });
    expect(settings['js/ts.tsserver.maxMemory']).toBe(4096);
    expect(settings['typescript.tsserver.maxTsServerMemory']).toBe(4096);
  });

  it('copies the unified memory cap the user set to the old key', () => {
    const { settings } = mergeEditorSettings({ 'js/ts.tsserver.maxMemory': 8192 });
    expect(settings['js/ts.tsserver.maxMemory']).toBe(8192);
    expect(settings['typescript.tsserver.maxTsServerMemory']).toBe(8192);
  });

  it('is idempotent for the memory keys', () => {
    const first = mergeEditorSettings({});
    const second = mergeEditorSettings(first.settings);
    expect(second.changed).toBe(false);
    expect(second.settings['js/ts.tsserver.maxMemory']).toBe(2048);
  });

  it('adds excludeDirectories to a watchOptions object that lacks it', () => {
    const { settings } = mergeEditorSettings({ 'typescript.tsserver.watchOptions': { watchFile: 'useFsEvents' } });
    expect(settings['typescript.tsserver.watchOptions']).toEqual({
      watchFile: 'useFsEvents',
      excludeDirectories: [WORKTREES],
    });
  });

  it('keeps a memory cap the user set', () => {
    const { settings } = mergeEditorSettings({ 'typescript.tsserver.maxTsServerMemory': 8192 });
    expect(settings['typescript.tsserver.maxTsServerMemory']).toBe(8192);
  });

  it('keeps entries the user set to false', () => {
    const { settings } = mergeEditorSettings({
      'files.exclude': { [WORKTREES]: false },
      'search.exclude': { [WORKTREES]: false },
      'files.watcherExclude': { [WORKTREES]: false },
    });
    expect(settings['files.exclude']).toEqual({ [WORKTREES]: false });
    expect(settings['search.exclude']).toEqual({ [WORKTREES]: false });
    expect(settings['files.watcherExclude']).toEqual({
      [WORKTREES]: false,
      [WORKTREES_CONTENTS]: true,
    });
  });

  it('merges into existing objects and lists without dropping entries', () => {
    const { settings } = mergeEditorSettings({
      'files.exclude': { '**/dist': true },
      'typescript.tsserver.watchOptions': { watchFile: 'useFsEvents', excludeDirectories: ['**/out'] },
    });
    expect(settings['files.exclude']).toEqual({ '**/dist': true, [WORKTREES]: true });
    expect(settings['typescript.tsserver.watchOptions']).toEqual({
      watchFile: 'useFsEvents',
      excludeDirectories: ['**/out', WORKTREES],
    });
  });

  it('keeps both memory caps when the user set both', () => {
    const { settings } = mergeEditorSettings({
      'js/ts.tsserver.maxMemory': 8192,
      'typescript.tsserver.maxTsServerMemory': 4096,
    });
    expect(settings['js/ts.tsserver.maxMemory']).toBe(8192);
    expect(settings['typescript.tsserver.maxTsServerMemory']).toBe(4096);
  });

  it('merges both watchOptions objects per key and keeps user entries', () => {
    const { settings } = mergeEditorSettings({
      'js/ts.tsserver.watchOptions': { watchFile: 'useFsEvents', excludeDirectories: ['**/out'] },
      'typescript.tsserver.watchOptions': { watchDirectory: 'fixedPollingInterval' },
    });
    expect(settings['js/ts.tsserver.watchOptions']).toEqual({
      watchFile: 'useFsEvents',
      excludeDirectories: ['**/out', WORKTREES],
    });
    expect(settings['typescript.tsserver.watchOptions']).toEqual({
      watchDirectory: 'fixedPollingInterval',
      excludeDirectories: [WORKTREES],
    });
  });

  it('leaves a unified watchOptions of an unexpected shape alone', () => {
    const { settings } = mergeEditorSettings({
      'js/ts.tsserver.watchOptions': { excludeDirectories: 'nope' },
    });
    expect(settings['js/ts.tsserver.watchOptions']).toEqual({ excludeDirectories: 'nope' });
  });

  it('leaves values of an unexpected shape alone', () => {
    const input = {
      'files.exclude': 'nope',
      'typescript.tsserver.watchOptions': { excludeDirectories: 'nope' },
    };
    const { settings } = mergeEditorSettings(input);
    expect(settings['files.exclude']).toBe('nope');
    expect(settings['typescript.tsserver.watchOptions']).toEqual({ excludeDirectories: 'nope' });
  });

  it('leaves unrelated keys untouched', () => {
    const { settings } = mergeEditorSettings({ 'editor.fontSize': 14, 'workbench.colorTheme': 'x' });
    expect(settings['editor.fontSize']).toBe(14);
    expect(settings['workbench.colorTheme']).toBe('x');
  });

  it('reports no change on a second merge', () => {
    const first = mergeEditorSettings({ 'editor.fontSize': 14 });
    const second = mergeEditorSettings(first.settings);
    expect(second.changed).toBe(false);
    expect(second.settings).toEqual(first.settings);
  });

  it('does not mutate its input', () => {
    const input = { 'files.exclude': { '**/dist': true } };
    mergeEditorSettings(input);
    expect(input).toEqual({ 'files.exclude': { '**/dist': true } });
  });
});

describe('ensureEditorSettingsFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-settings-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

  it('creates a missing directory and file', () => {
    const file = path.join(dir, 'a', 'b', 'settings.json');
    ensureEditorSettingsFile(file);
    expect(read(file)['typescript.tsserver.maxTsServerMemory']).toBe(2048);
  });

  it('treats a zero-byte file as empty settings', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '');
    ensureEditorSettingsFile(file);
    expect(read(file)['files.exclude']).toEqual({ [WORKTREES]: true });
  });

  it('keeps a user value and other keys in an existing file', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ 'typescript.tsserver.maxTsServerMemory': 4096, 'editor.tabSize': 2 }));
    ensureEditorSettingsFile(file);
    const result = read(file);
    expect(result['typescript.tsserver.maxTsServerMemory']).toBe(4096);
    expect(result['editor.tabSize']).toBe(2);
    expect(result['search.exclude']).toEqual({ [WORKTREES]: true });
  });

  it('does not rewrite the file the second time', () => {
    const file = path.join(dir, 'settings.json');
    ensureEditorSettingsFile(file);
    const past = new Date(2020, 0, 1);
    fs.utimesSync(file, past, past);
    const before = fs.readFileSync(file, 'utf8');
    ensureEditorSettingsFile(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.statSync(file).mtimeMs).toBe(past.getTime());
  });

  it('leaves a JSONC file alone', () => {
    const file = path.join(dir, 'settings.json');
    const jsonc = '{\n  // my comment\n  "editor.tabSize": 2\n}\n';
    fs.writeFileSync(file, jsonc);
    ensureEditorSettingsFile(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(jsonc);
  });

  it('leaves a file whose top level is not an object alone', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '[1]');
    ensureEditorSettingsFile(file);
    expect(fs.readFileSync(file, 'utf8')).toBe('[1]');
  });
});
