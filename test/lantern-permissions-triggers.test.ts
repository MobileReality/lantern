import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerExtensionsIpc } from '../src/main/extensions-ipc';
import { extensionsPath, importExtensionsList, saveSkillLinker } from '../src/main/extensions';
import { forgetAttempts, installLanternBundle, installOnOpen, settled, settledFor, syncPermissionsOf } from '../src/main/bundle';
import { missingPermissions, requiredAllow } from '../skills/lantern-delegate/scripts/permissions.mjs';
import { callArguments } from './helpers/source-blocks';
import { makeHome, makeLinker, makeRepo } from './support/bundle-fixtures';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REAL_ROOT = path.join(__dirname, '..', 'skills');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');

let tmp: string;
let project: string;

const settingsFile = () => path.join(project, '.claude', 'settings.local.json');
const allow = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).permissions.allow as string[];
const nodeRule = (home: string) => `Bash(node ${path.join(home, '.claude', 'skills')}/*)`;
const linkRule = (linker: string) => `Bash(${linker} --list)`;

function missingFor(home: string, linker: string | null) {
  const skillRoots = [path.join(fs.realpathSync(project), '.claude', 'skills'), path.join(home, '.claude', 'skills')];
  return missingPermissions([settingsFile()], requiredAllow(skillRoots, linker ?? undefined));
}

beforeEach(() => {
  vi.stubEnv('SKILL_LINKER', '');
  forgetAttempts();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-triggers-'));
  project = makeRepo(path.join(tmp, 'project'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('opening a project syncs the delegate rules', () => {
  it('adds the rules of the home this run was started with when the project is opened again', async () => {
    const homeA = makeHome(path.join(tmp, 'home-a'));
    const homeB = makeHome(path.join(tmp, 'home-b'));
    installOnOpen(project, { home: homeA, root: REAL_ROOT, consent: () => true });
    await settledFor(project);
    expect(missingFor(homeA, null)).toEqual([]);
    expect(missingFor(homeB, null)).not.toEqual([]);
    installOnOpen(project, { home: homeB, root: REAL_ROOT, consent: () => true });
    await settledFor(project);
    expect(missingFor(homeB, null)).toEqual([]);
    expect(allow()).toContain(nodeRule(homeA));
  });

  it('adds the rules of the linker saved since the last open, without installing the bundle twice', async () => {
    const homeDir = makeHome(path.join(tmp, 'home'));
    await installLanternBundle(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    const linker = makeLinker(path.join(tmp, 'linker-y'));
    makeHome(homeDir, linker);
    expect(await installLanternBundle(project, { home: homeDir, root: REAL_ROOT, consent: () => true })).toBeNull();
    expect(allow()).toContain(linkRule(linker));
    expect(missingFor(homeDir, linker)).toEqual([]);
  });

  it('writes nothing when a second open finds nothing to add', async () => {
    const homeDir = makeHome(path.join(tmp, 'home'));
    await installLanternBundle(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    const bytes = fs.readFileSync(settingsFile(), 'utf8');
    const mtime = fs.statSync(settingsFile()).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await installLanternBundle(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(bytes);
    expect(fs.statSync(settingsFile()).mtimeMs).toBe(mtime);
  });

  it('leaves the rules of a Codex project alone', async () => {
    await syncPermissionsOf(project, { home: makeHome(path.join(tmp, 'home')), root: REAL_ROOT, consent: () => true, provider: 'codex' });
    expect(fs.existsSync(settingsFile())).toBe(false);
  });
});

describe('changing the skill linker syncs the delegate rules', () => {
  it('adds the rules of the new linker to the open project, keeping the old ones', async () => {
    const homeDir = makeHome(path.join(tmp, 'home'));
    const linkerX = makeLinker(path.join(tmp, 'linker-x'));
    const linkerY = makeLinker(path.join(tmp, 'linker-y'));
    saveSkillLinker(linkerX, [], homeDir);
    await syncPermissionsOf(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    expect(allow()).toContain(linkRule(linkerX));
    saveSkillLinker(linkerY, [], homeDir);
    await syncPermissionsOf(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    expect(allow()).toContain(linkRule(linkerY));
    expect(allow()).toContain(linkRule(linkerX));
    expect(missingFor(homeDir, linkerY)).toEqual([]);
  });

  it('adds the rules of a linker that arrives with an imported list', async () => {
    const homeDir = makeHome(path.join(tmp, 'home'));
    const linker = makeLinker(path.join(tmp, 'linker-z'));
    const list = path.join(tmp, 'list.json');
    fs.writeFileSync(list, JSON.stringify({ skillLinker: linker }));
    importExtensionsList(list, [], homeDir);
    expect(fs.existsSync(extensionsPath(homeDir))).toBe(true);
    await syncPermissionsOf(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    expect(allow()).toContain(linkRule(linker));
  });

  describe('through the Skills window handlers', () => {
    const SENDER = { id: 'workspace' };
    const trustedOnly = new WeakSet<object>();

    function ipcHandlers(homeDir: string, pickList: () => Promise<string | null>, onSync: (project: unknown) => void) {
      const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
      registerExtensionsIpc({
        handle: (channel, handler) => handlers.set(channel, handler as never),
        fromWorkspace: (fn) => {
          const wrapped = (...args: Parameters<typeof fn>) => fn(...args);
          trustedOnly.add(wrapped);
          return wrapped;
        },
        installedFor: () => [],
        reinstallFor: () => null,
        syncPermissionsFor: async (target) => onSync(target),
        pickList,
        home: homeDir,
      });
      return Object.assign((channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: SENDER }, ...args), {
        isTrustedOnly: (channel: string) => trustedOnly.has(handlers.get(channel) as never),
      });
    }

    it('registers the linker and import handlers behind the trusted-sender wrapper', () => {
      const invoke = ipcHandlers(makeHome(path.join(tmp, 'home')), async () => null, () => {});
      expect(invoke.isTrustedOnly('extensions:skillLinker')).toBe(true);
      expect(invoke.isTrustedOnly('extensions:import')).toBe(true);
    });

    it('syncs the rules of the open project after the linker is saved', async () => {
      const homeDir = makeHome(path.join(tmp, 'home'));
      const linker = makeLinker(path.join(tmp, 'linker-w'));
      const savedWhenSynced: boolean[] = [];
      const synced: unknown[] = [];
      const invoke = ipcHandlers(homeDir, async () => null, (target) => {
        synced.push(target);
        savedWhenSynced.push(fs.existsSync(extensionsPath(homeDir)));
      });
      const panel = await invoke('extensions:skillLinker', { project, value: linker });
      expect(panel).toBeTruthy();
      expect(synced).toEqual([project]);
      expect(savedWhenSynced).toEqual([true]);
    });

    it('syncs the rules of the open project after a list is imported, and not when the picker is cancelled', async () => {
      const homeDir = makeHome(path.join(tmp, 'home'));
      const list = path.join(tmp, 'list.json');
      fs.writeFileSync(list, JSON.stringify({ skillLinker: makeLinker(path.join(tmp, 'linker-v')) }));
      const synced: unknown[] = [];
      const importedWhenSynced: boolean[] = [];
      let picked: string | null = null;
      const invoke = ipcHandlers(homeDir, async () => picked, (target) => {
        synced.push(target);
        importedWhenSynced.push(fs.existsSync(extensionsPath(homeDir)));
      });
      await invoke('extensions:import', { project });
      expect(synced).toEqual([]);
      picked = list;
      const panel = await invoke('extensions:import', { project });
      expect(panel).toBeTruthy();
      expect(synced).toEqual([project]);
      expect(importedWhenSynced).toEqual([true]);
    });

    it('is the sync main.ts hands to those handlers, bound to the provider of the project', () => {
      expect(callArguments(MAIN, 'registerExtensionsIpc').text).toMatch(/[{,]\s*syncPermissionsFor\s*[,}]/);
      expect(MAIN).toMatch(/const syncPermissionsFor\s*=[^;]*syncPermissionsOf\(\s*project,[^;]*settings\.provider\(project\)/);
    });
  });
});

describe('a dev run', () => {
  it('syncs the delegate rules but installs no skill and no agent', async () => {
    vi.stubEnv('LANTERN_PROFILE', 'dev');
    vi.resetModules();
    const dev = await import('../src/main/bundle');
    const homeDir = makeHome(path.join(tmp, 'home'));
    dev.installOnOpen(project, { home: homeDir, root: REAL_ROOT, consent: () => true });
    await dev.settled();
    expect(missingFor(homeDir, null)).toEqual([]);
    expect(fs.readdirSync(path.join(project, '.claude')).sort()).toEqual(['settings.local.json']);
  });

  it('installs the bundle on a plain open in the installed app', async () => {
    installOnOpen(project, { home: makeHome(path.join(tmp, 'home')), root: REAL_ROOT, consent: () => true });
    await settled();
    expect(fs.existsSync(path.join(project, '.claude', 'skills'))).toBe(true);
  });
});
