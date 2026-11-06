import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userData = vi.hoisted(() => {
  const o = require('node:os');
  const p = require('node:path');
  const f = require('node:fs');
  return f.mkdtempSync(p.join(o.tmpdir(), 'ccm-set-'));
});
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

let settings: typeof import('../src/main/settings');

beforeEach(async () => {
  fs.rmSync(path.join(userData, 'ccm-settings.json'), { force: true });
  vi.resetModules();
  settings = await import('../src/main/settings');
});

describe('settings', () => {
  it('defaults to no per-project languages', () => {
    expect(settings.load()).toEqual({ languages: {}, dismissedPrs: {}, localReviews: {}, setupUnfinished: {}, permissionConsent: {}, serverLicenseAccepted: false, claudeBin: '' });
    expect(settings.requestedLanguage('/some/project')).toBeUndefined();
  });

  it('loads a legacy file that still has the retired dataFlow and headless keys, ignores them and drops them on the next save', () => {
    const storeFile = path.join(userData, 'ccm-settings.json');
    fs.writeFileSync(storeFile, JSON.stringify({ headless: true, dataFlow: true, languages: { '/proj/a': 'Polish' } }));

    const loaded = settings.load();
    expect(loaded).toEqual({ languages: { '/proj/a': 'Polish' }, dismissedPrs: {}, localReviews: {}, setupUnfinished: {}, permissionConsent: {}, serverLicenseAccepted: false, claudeBin: '' });
    expect(loaded).not.toHaveProperty('dataFlow');
    expect(loaded).not.toHaveProperty('headless');
    expect(settings.requestedLanguage('/proj/a')).toBe('Polish');

    settings.setProvider('/proj/a', 'codex');
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    expect(saved).not.toHaveProperty('dataFlow');
    expect(saved).not.toHaveProperty('headless');
  });

  it('still reads the per-project language picked with the old selector', () => {
    fs.writeFileSync(path.join(userData, 'ccm-settings.json'), JSON.stringify({ languages: { '/proj/a': 'Polish', '/proj/b': 'German' } }));
    settings.load();
    expect(settings.requestedLanguage('/proj/a')).toBe('Polish');
    expect(settings.requestedLanguage('/proj/b')).toBe('German');
    expect(settings.requestedLanguage('/proj/other')).toBeUndefined();
  });

  it('defaults tools to Claude and persists providers independently per project', async () => {
    settings.load();
    expect(settings.provider('/proj/a')).toBe('claude');
    settings.setProvider('/proj/a', 'codex');
    settings.setProvider('/proj/b', 'claude');

    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    reloaded.load();
    expect(reloaded.provider('/proj/a')).toBe('codex');
    expect(reloaded.provider('/proj/b')).toBe('claude');
  });

  it('ignores unsupported persisted and requested providers', () => {
    fs.writeFileSync(path.join(userData, 'ccm-settings.json'), JSON.stringify({ providers: { '/ok': 'codex', '/bad': 'future' } }));
    settings.load();
    expect(settings.provider('/ok')).toBe('codex');
    expect(settings.provider('/bad')).toBe('claude');
    settings.setProvider('/ok', 'future');
    expect(settings.provider('/ok')).toBe('codex');
  });

  it('remembers dismissed pull requests per project across a restart', async () => {
    settings.load();
    settings.dismissPr('/proj/a', '12');
    settings.dismissPr('/proj/a', '13');
    settings.dismissPr('/proj/a', '12');
    settings.dismissPr('/proj/b', '7');
    expect(settings.all().dismissedPrs).toEqual({ '/proj/a': ['13', '12'], '/proj/b': ['7'] });

    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    expect(reloaded.load().dismissedPrs['/proj/a']).toEqual(['13', '12']);
  });

  it('remembers local reviews per project, rejecting ids that are not local', async () => {
    settings.load();
    settings.addLocalReview('/proj/a', 'local:cmp:main|@');
    settings.addLocalReview('/proj/a', 'local:cmp:main|feat/x');
    settings.addLocalReview('/proj/a', 'local:cmp:main|@');
    settings.addLocalReview('/proj/a', '12');
    settings.addLocalReview('/proj/a', 'local:cmp:main|-x');
    expect(settings.localReviews('/proj/a')).toEqual(['local:cmp:main|feat/x', 'local:cmp:main|@']);
    settings.removeLocalReview('/proj/a', 'local:cmp:main|feat/x');

    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    reloaded.load();
    expect(reloaded.localReviews('/proj/a')).toEqual(['local:cmp:main|@']);
    reloaded.removeLocalReview('/proj/a', 'local:cmp:main|@');
    expect(reloaded.all().localReviews).toEqual({});
  });

  it('keeps the newest twenty local reviews', () => {
    settings.load();
    for (let i = 0; i <= 20; i++) settings.addLocalReview('/proj/a', `local:cmp:main|feat/${i}`);
    const kept = settings.localReviews('/proj/a');
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe('local:cmp:main|feat/1');
    expect(kept[19]).toBe('local:cmp:main|feat/20');
  });

  it('ignores non-numeric ids and an empty project', () => {
    settings.load();
    settings.dismissPr('/proj/a', '../x');
    settings.dismissPr('', '5');
    expect(settings.all().dismissedPrs).toEqual({});
  });

  it('keeps only the newest 200 dismissed ids per project', () => {
    settings.load();
    for (let i = 1; i <= 205; i++) settings.dismissPr('/p', String(i));
    const list = settings.all().dismissedPrs['/p'];
    expect(list).toHaveLength(200);
    expect(list[0]).toBe('6');
    expect(list[199]).toBe('205');
  });

  it('restores one project without touching others', async () => {
    settings.load();
    settings.dismissPr('/proj/a', '1');
    settings.dismissPr('/proj/b', '2');
    settings.restorePrs('/proj/a');

    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    expect(reloaded.load().dismissedPrs).toEqual({ '/proj/b': ['2'] });
  });

  it('falls back to defaults when the store is unreadable', () => {
    fs.writeFileSync(path.join(userData, 'ccm-settings.json'), '{ not json');
    expect(settings.load()).toEqual({ languages: {}, dismissedPrs: {}, localReviews: {}, setupUnfinished: {}, permissionConsent: {}, serverLicenseAccepted: false, claudeBin: '' });
  });

  it('hands a claudeBin from the store to the agent as the configured override', async () => {
    const real = path.join(userData, 'claude-here');
    fs.writeFileSync(real, '');
    fs.writeFileSync(path.join(userData, 'ccm-settings.json'), JSON.stringify({ claudeBin: real }));
    settings.load();
    const agent = await import('../src/main/agent');
    expect(agent.binCandidates()[0]).toBe(real);
  });

  it('keeps unknown keys from breaking the shape', async () => {
    fs.writeFileSync(path.join(userData, 'ccm-settings.json'), JSON.stringify({ languages: { '/proj/a': 'Polish' }, future: 'x' }));
    expect(settings.load().languages).toEqual({ '/proj/a': 'Polish' });
  });

  it('returns a copy so callers cannot mutate the store', () => {
    settings.load();
    const snapshot = settings.all();
    snapshot.dismissedPrs['/proj/a'] = ['1'];
    expect(settings.all().dismissedPrs).toEqual({});
  });
});

describe('settings: unfinished Lantern runs', () => {
  it('remembers a run that has not finished across a restart, per project', async () => {
    settings.load();
    expect(settings.setupUnfinished('/proj/a')).toBeNull();
    settings.markSetup('/proj/a', 'lantern');
    settings.markSetup('/proj/b', 'lantern-refresh');

    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    reloaded.load();
    expect(reloaded.setupUnfinished('/proj/a')).toBe('lantern');
    expect(reloaded.setupUnfinished('/proj/b')).toBe('lantern-refresh');
  });

  it('clears it when the run finishes, leaving other projects alone', () => {
    settings.load();
    settings.markSetup('/proj/a', 'lantern');
    settings.markSetup('/proj/b', 'lantern');
    settings.markSetup('/proj/a', null);
    expect(settings.setupUnfinished('/proj/a')).toBeNull();
    expect(settings.setupUnfinished('/proj/b')).toBe('lantern');
  });

  it('ignores a stored value that is not a Lantern run kind', () => {
    fs.writeFileSync(path.join(userData, 'ccm-settings.json'), JSON.stringify({ setupUnfinished: { '/p': 'explain' } }));
    settings.load();
    expect(settings.setupUnfinished('/p')).toBeNull();
  });
});
