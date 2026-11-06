import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitFile, git, makeTmp } from './helpers/git-repo';

let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const ROOT = path.resolve(__dirname, '..');
const COMPANY = /mobile\s*-?reality/i;

async function loadSkills(repo: string) {
  fs.writeFileSync(path.join(userData, 'ccm-skills.json'), JSON.stringify({ repo }));
  const skills = await import('../src/main/skills');
  skills.loadConfig();
  return skills;
}

function checkout(dir: string, remote?: string) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  commitFile(dir, 'core/alpha/SKILL.md', '# alpha\n', 'init');
  if (remote) git(dir, ['remote', 'add', 'origin', remote]);
  return dir;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|css|html|json)$/.test(entry.name) ? [full] : [];
  });
}

describe('the skills repo remote', () => {
  let base = '';

  beforeEach(() => {
    base = makeTmp('ccm-skills-remote-');
    userData = path.join(base, 'user-data');
    fs.mkdirSync(userData);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('is empty when the folder is not a checkout, and names no built-in URL', async () => {
    const folder = path.join(base, 'plain');
    fs.mkdirSync(folder);
    const skills = await loadSkills(folder);
    const listing = skills.listFor(null);
    expect(listing.remote).toBe('');
    expect(listing.installed).toBe(false);
    expect(JSON.stringify(listing)).not.toMatch(COMPANY);
  });

  it('is empty for a checkout with no remote configured', async () => {
    const skills = await loadSkills(checkout(path.join(base, 'local')));
    expect(skills.listFor(null).remote).toBe('');
  });

  it('is read from the git config of the configured checkout', async () => {
    const skills = await loadSkills(checkout(path.join(base, 'mine'), 'https://git.example.test/me/skills.git'));
    const listing = skills.listFor(null);
    expect(listing.installed).toBe(true);
    expect(listing.remote).toBe('https://git.example.test/me/skills.git');
  });

  it('follows the checkout when another one is adopted', async () => {
    const first = checkout(path.join(base, 'first'), 'https://git.example.test/first/skills.git');
    const second = checkout(path.join(base, 'second'), 'ssh://git@git.example.test/second/skills.git');
    const skills = await loadSkills(first);
    expect(skills.listFor(null).remote).toBe('https://git.example.test/first/skills.git');
    const res = (await skills.clone(second)) as { ok: boolean; adopted?: boolean };
    expect(res).toMatchObject({ ok: true, adopted: true });
    expect(skills.listFor(null).remote).toBe('ssh://git@git.example.test/second/skills.git');
  });

  it('clone without a remote and without a checkout asks for the remote instead of guessing one', async () => {
    const skills = await loadSkills(path.join(base, 'nothing'));
    const parent = path.join(base, 'parent');
    fs.mkdirSync(parent);
    const res = (await skills.clone(parent)) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('enter the remote URL of your skills repo');
    expect(res.error).not.toMatch(COMPANY);
    expect(fs.existsSync(path.join(parent, 'skills'))).toBe(false);
  });

  it('clone into a new folder with no typed remote reuses the configured checkout remote', async () => {
    const origin = checkout(path.join(base, 'origin'));
    const mine = checkout(path.join(base, 'my skills'), origin);
    const skills = await loadSkills(mine);
    expect(skills.listFor(null).remote).toBe(origin);
    const parent = path.join(base, 'parent');
    fs.mkdirSync(parent);
    const res = (await skills.clone(parent)) as { ok: boolean; repo?: string };
    expect(res).toMatchObject({ ok: true, repo: path.join(parent, 'skills') });
    expect(skills.listFor(null).remote).toBe(origin);
  });

  it('clone refuses a remote that git would read as an option', async () => {
    const skills = await loadSkills(path.join(base, 'nothing'));
    const parent = path.join(base, 'parent');
    fs.mkdirSync(parent);
    const res = (await skills.clone(parent, '--upload-pack=touch /tmp/x')) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it('clone with the typed remote clones it, and the listing then reports that remote', async () => {
    const origin = checkout(path.join(base, 'origin'));
    const skills = await loadSkills(path.join(base, 'nothing'));
    const parent = path.join(base, 'parent');
    fs.mkdirSync(parent);
    const res = (await skills.clone(parent, origin)) as { ok: boolean; repo?: string };
    expect(res).toMatchObject({ ok: true, repo: path.join(parent, 'skills') });
    expect(skills.listFor(null).remote).toBe(origin);
  });
});

describe('no company name in what ships as default text', () => {
  it('src/shared, src/renderer, the message catalogue and the skills repo module name none', () => {
    const files = [...sourceFiles(path.join(ROOT, 'src', 'shared')), ...sourceFiles(path.join(ROOT, 'src', 'renderer')), path.join(ROOT, 'src', 'main', 'skills.ts')];
    expect(files.some((file) => file.endsWith(path.join('lang', 'en', 'messages.json')))).toBe(true);
    const hits = files.filter((file) => COMPANY.test(fs.readFileSync(file, 'utf8')));
    expect(hits.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});
