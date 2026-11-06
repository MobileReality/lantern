// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitFile, git, makeTmp } from './helpers/git-repo';

let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function checkout(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  commitFile(dir, 'core/alpha/SKILL.md', '# alpha\n', 'init');
  return dir;
}

describe('skills repo settings with nothing configured', () => {
  let base = '';

  beforeEach(() => {
    vi.resetModules();
    base = makeTmp('ccm-skills-unset-');
    userData = path.join(base, 'user-data');
    fs.mkdirSync(userData);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  async function load() {
    const skills = await import('../src/main/skills');
    skills.loadConfig();
    return skills;
  }

  it('has no repo path, no remote and no skills until one is configured', async () => {
    const skills = await load();
    const listing = skills.listFor(null);
    expect(skills.repoPath()).toBe('');
    expect(listing).toMatchObject({ installed: false, repo: '', remote: '', version: null, available: [] });
  });

  it('does not default to a folder under the home directory', async () => {
    const skills = await load();
    expect(skills.repoPath()).not.toContain(path.join(os.homedir(), 'GIT'));
    expect(skills.defaultCloneParent()).toBe(os.homedir());
  });

  it('clone with no folder and no remote does nothing and says what is missing', async () => {
    const skills = await load();
    const res = (await skills.clone('')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(skills.repoPath()).toBe('');
  });

  it('once a path is configured it behaves as before', async () => {
    const repo = checkout(path.join(base, 'mine'));
    fs.writeFileSync(path.join(userData, 'ccm-skills.json'), JSON.stringify({ repo }));
    const skills = await load();
    const listing = skills.listFor(null);
    expect(listing).toMatchObject({ installed: true, repo, available: [{ role: 'core', name: 'alpha' }] });
  });
});

describe('Skills modal clone action', () => {
  const LISTING = (remote: string) => ({
    installed: false,
    version: null,
    project: null,
    available: [],
    linked: [],
    bundled: [],
    local: [],
    broken: [],
    recommended: [],
    remote,
    repo: '',
  });

  const SLOTS = { delegate: [], orchestrator: [], reviewer: [] };
  const PANEL = { slots: SLOTS, alwaysOn: SLOTS, switchable: SLOTS, off: SLOTS, locked: [], installed: [], skillLinker: null, skillLinkerState: 'unset', error: null };

  async function openLinker(remote: string) {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="skills-modal" class="hidden"><span id="sk-proj"></span><button id="sk-close"></button>
      <div id="sk-body"></div><div id="sk-foot"></div></div>
      <button id="mic-btn"><span class="mic-fix-label">Mic</span></button>`;
    window.ccmws = {
      skillsList: vi.fn(async () => LISTING(remote)),
      skillsClone: vi.fn(async () => ({ ok: true })),
      skillsChooseDir: vi.fn(async () => '/picked'),
      extensionsLoad: vi.fn(async () => PANEL),
    } as unknown as typeof window.ccmws;
    const { openSkills } = await import('../src/renderer/features/skills');
    void openSkills();
    await settled();
    await settled();
    document.querySelector<HTMLButtonElement>('[data-sk-tab="linker"]')!.click();
    await settled();
    await settled();
  }

  const cloneButton = () => document.querySelector<HTMLButtonElement>('[data-sk-clone]')!;
  const hint = () => document.querySelector<HTMLElement>('[data-sk-clone-hint]')!;

  it('is disabled with a hint while no remote URL is configured, and enabled once one is typed', async () => {
    await openLinker('');
    expect(cloneButton().disabled).toBe(true);
    expect(hint().hidden).toBe(false);
    const input = document.querySelector<HTMLInputElement>('[data-sk-remote]')!;
    input.value = 'https://git.example.test/me/skills.git';
    input.dispatchEvent(new Event('input'));
    expect(cloneButton().disabled).toBe(false);
    expect(hint().hidden).toBe(true);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(cloneButton().disabled).toBe(true);
  });

  it('is enabled when a remote URL is already known', async () => {
    await openLinker('https://git.example.test/me/skills.git');
    expect(cloneButton().disabled).toBe(false);
    expect(hint().hidden).toBe(true);
  });
});
