import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTmp } from './helpers/git-repo';
import { LINKER_REPO_ROLES, LINKER_REPO_SKILLS, makeLinkerRepo, writeLinkerConfig } from './helpers/skill-linker-repo';

let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const CATALOGUE = LINKER_REPO_SKILLS.map(([role, name]) => ({ role, name })).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

describe('the skills catalogue follows the skill linker', () => {
  let base = '';
  let home = '';
  let project = '';
  let fixture: ReturnType<typeof makeLinkerRepo>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SKILL_LINKER', '');
    delete process.env.SKILLS_REPO;
    base = makeTmp('ccm-skills-linker-repo-');
    home = path.join(base, 'home');
    userData = path.join(base, 'user-data');
    project = path.join(base, 'northwind');
    for (const dir of [home, userData, project]) fs.mkdirSync(dir);
    fixture = makeLinkerRepo(path.join(base, 'skills'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.SKILLS_REPO;
    fs.rmSync(base, { recursive: true, force: true });
  });

  async function load() {
    const skills = await import('../src/main/skills');
    skills.loadConfig();
    return skills;
  }

  it('lists every skill of the linker repo with no repo saved in ccm-skills.json', async () => {
    writeLinkerConfig(home, fixture.linker);
    const skills = await load();
    expect(fs.existsSync(path.join(userData, 'ccm-skills.json'))).toBe(false);
    const listing = skills.listFor(project);
    expect(listing.installed).toBe(true);
    expect(listing.repo).toBe(fixture.repo);
    expect(listing.available).toEqual(CATALOGUE);
    expect(listing.available).toContainEqual({ role: 'research', name: 'web-research' });
    expect(fs.existsSync(path.join(userData, 'ccm-skills.json'))).toBe(false);
  });

  it('takes the repo from a linker given as the repo folder too', async () => {
    writeLinkerConfig(home, fixture.repo);
    const skills = await load();
    expect(skills.listFor(project)).toMatchObject({ installed: true, repo: fixture.repo });
  });

  it('links a skill of the catalogue into the project and reports it as linked', async () => {
    writeLinkerConfig(home, fixture.linker);
    const skills = await load();
    expect(skills.link(project, ['web-research'])).toEqual({ 'web-research': 'linked' });
    expect(fs.readlinkSync(path.join(project, '.claude', 'skills', 'web-research'))).toBe(path.join(fixture.repo, 'research', 'web-research'));
    expect(skills.listFor(project).linked).toEqual(['web-research']);
    skills.unlink(project, ['web-research']);
    expect(skills.listFor(project).linked).toEqual([]);
  });

  it('follows a linker that is saved, changed or cleared while the app runs', async () => {
    const skills = await load();
    expect(skills.listFor(project)).toMatchObject({ installed: false, repo: '', available: [] });
    writeLinkerConfig(home, fixture.linker);
    expect(skills.listFor(project)).toMatchObject({ installed: true, repo: fixture.repo });
    const other = makeLinkerRepo(path.join(base, 'other-skills'), [['research', 'web-search']]);
    writeLinkerConfig(home, other.linker);
    expect(skills.listFor(project).available).toEqual([{ role: 'research', name: 'web-search' }]);
    fs.rmSync(path.join(home, '.claude', 'lantern-extensions.json'));
    expect(skills.listFor(project)).toMatchObject({ installed: false, repo: '', available: [] });
  });

  it('has no catalogue while the linker path does not resolve', async () => {
    writeLinkerConfig(home, path.join(base, 'no-such-linker'));
    const skills = await load();
    expect(skills.listFor(project)).toMatchObject({ installed: false, repo: '', available: [] });
  });

  it('keeps an explicitly saved repo ahead of the linker', async () => {
    const mine = makeLinkerRepo(path.join(base, 'mine'), [['tools', 'only-mine']]);
    fs.writeFileSync(path.join(userData, 'ccm-skills.json'), JSON.stringify({ repo: mine.repo }));
    writeLinkerConfig(home, fixture.linker);
    const skills = await load();
    const listing = skills.listFor(project);
    expect(listing.repo).toBe(mine.repo);
    expect(listing.available).toEqual([{ role: 'tools', name: 'only-mine' }]);
  });

  it('adopting a repo by hand still saves it and wins over the linker', async () => {
    writeLinkerConfig(home, fixture.linker);
    const skills = await load();
    const mine = makeLinkerRepo(path.join(base, 'mine'), [['tools', 'only-mine']]);
    fs.mkdirSync(path.join(mine.repo, '.git'));
    await skills.clone(mine.repo);
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'ccm-skills.json'), 'utf8'))).toEqual({ repo: mine.repo });
    expect(skills.listFor(project).available).toEqual([{ role: 'tools', name: 'only-mine' }]);
  });

  it('publishes only a saved repo as SKILLS_REPO, never the one found through the linker', async () => {
    writeLinkerConfig(home, fixture.linker);
    const skills = await load();
    expect(skills.listFor(project).installed).toBe(true);
    expect(process.env.SKILLS_REPO).toBeUndefined();
    fs.writeFileSync(path.join(userData, 'ccm-skills.json'), JSON.stringify({ repo: fixture.repo }));
    skills.loadConfig();
    expect(process.env.SKILLS_REPO).toBe(fixture.repo);
  });

  it('counts the skills and roles of the linker repo in the panel the Skill linker tab shows', async () => {
    writeLinkerConfig(home, fixture.linker);
    const { loadExtensionsPanel } = await import('../src/main/extensions');
    const panel = loadExtensionsPanel([], home);
    expect(panel).toMatchObject({ skillLinkerState: 'initialized', skillLinkerPath: fixture.linker, skillLinkerSkills: LINKER_REPO_SKILLS.length, skillLinkerRoles: LINKER_REPO_ROLES });
  });
});
