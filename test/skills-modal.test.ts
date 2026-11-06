// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionsPanel } from '../src/main/extensions';
import { msg } from '../src/shared/lang/messages';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const LISTING = {
  installed: true,
  version: '1.0.0',
  project: { name: 'demo', path: '/demo' },
  available: [
    { name: 'alpha', role: 'core' },
    { name: 'beta', role: 'tech' },
  ],
  linked: [],
  bundled: [],
  local: [],
  broken: [],
  recommended: [],
  remote: 'git@example.com:skills.git',
  repo: '/skills',
};

const PANEL: ExtensionsPanel = { slots: { delegate: [], orchestrator: [], reviewer: [] }, projectSlots: { delegate: [], orchestrator: [], reviewer: [] }, projectRoot: '/demo', projectError: null, alwaysOn: { delegate: ['lantern-commit'], orchestrator: ['lantern-sync'], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] }, switchable: { delegate: ['lantern-commit'], orchestrator: [], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] }, off: { delegate: [], orchestrator: [], reviewer: [] }, locked: ['lantern-commit', 'lantern-sync'], installed: ['alpha'], skillLinker: null, skillLinkerState: 'unset', error: null };

let openSkills: () => Promise<void>;

const body = () => document.getElementById('sk-body')!;
const foot = () => document.getElementById('sk-foot')!;
const slotButton = (slot: string) => {
  body().querySelector<HTMLButtonElement>(`[data-segment="${slot}"]`)!.click();
  return body().querySelector<HTMLButtonElement>(`[data-add-skill="${slot}"]`)!;
};

beforeAll(async () => {
  document.body.innerHTML = `
    <div id="skills-modal" class="hidden">
      <div class="modal-head"><span id="sk-proj"></span><button id="sk-close"></button></div>
      <div id="sk-body"></div><div id="sk-foot"></div>
    </div>
    <button id="mic-btn"><span class="mic-fix-label">Mic</span></button>`;
  window.ccmws = {
    skillsList: vi.fn(async () => LISTING),
    skillsSync: vi.fn(async () => ({ ok: true })),
    skillsClone: vi.fn(async () => ({ ok: true })),
    skillsChooseDir: vi.fn(async () => '/picked'),
    skillsReveal: vi.fn(async () => undefined),
    extensionsLoad: vi.fn(async () => PANEL),
    extensionsCreate: vi.fn(async () => ({ ...PANEL, slots: { delegate: ['fresh'], orchestrator: [], reviewer: [] } })),
  } as unknown as typeof window.ccmws;
  ({ openSkills } = await import('../src/renderer/features/skills'));
});

async function openModal() {
  void openSkills();
  await settled();
  await settled();
}

const tab = (name: string) => body().querySelector<HTMLButtonElement>(`[data-sk-tab="${name}"]`)!;
const activeTab = () => body().querySelector('.sk-tab.active')!.getAttribute('data-sk-tab');

const syncButton = () => body().querySelector<HTMLButtonElement>('.sk-settings .sk-sync')!;

async function openTab(name: string) {
  tab(name).click();
  await settled();
  await settled();
}

describe('Skills modal without a skills repo', () => {
  const withoutRepo = (project: typeof LISTING.project | null) => {
    window.ccmws.skillsList = vi.fn(async () => ({ ...LISTING, installed: false, version: null, available: [], project, remote: '' })) as unknown as typeof window.ccmws.skillsList;
  };
  const cloneCommand = () => body().querySelector('.sk-cmd');
  let saved: typeof window.ccmws;

  beforeEach(() => {
    saved = { ...window.ccmws };
  });

  afterEach(() => {
    window.ccmws = saved;
    document.getElementById('sk-close')!.click();
  });

  it('still opens with the three tabs and no clone prompt on Project skills', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('project');
    expect([...body().querySelectorAll('.sk-tab')].map((t) => t.getAttribute('data-sk-tab'))).toEqual(['project', 'lantern', 'linker']);
    expect(cloneCommand()).toBeNull();
    expect(body().textContent).toContain(msg('skillsExtras.projectNeedsRepo'));
    expect(foot().textContent).toContain(msg('skillsExtras.openLinker'));
    expect(foot().textContent).not.toContain('Choose location & clone');
  });

  it('Project skills sends the person to the Skill linker tab, which carries the clone prompt', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('project');
    [...foot().querySelectorAll('button')].find((button) => button.textContent === msg('skillsExtras.openLinker'))!.click();
    await settled();
    expect(activeTab()).toBe('linker');
    expect(cloneCommand()!.textContent).toBe('git clone <remote url> <your folder>');
  });

  it('the clone prompt asks for the person\'s own remote, empty and without any company name', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('linker');
    const remote = body().querySelector<HTMLInputElement>('[data-sk-remote]')!;
    expect(remote.value).toBe('');
    expect(remote.placeholder).toBe('https://host/owner/skills.git');
    expect(`${body().textContent}${foot().textContent}${remote.placeholder}`).not.toMatch(/mobile\s*-?reality/i);
    const remoteRow = [...body().querySelectorAll('.sk-settings .sk-set-row')].find((row) => row.querySelector('.sk-set-label')!.textContent === 'Remote')!;
    expect(remoteRow.querySelector('.sk-set-val')!.textContent).toBe('—');
  });

  it('Choose location & clone and Apply send the typed remote with the folder', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('linker');
    const remote = body().querySelector<HTMLInputElement>('[data-sk-remote]')!;
    remote.value = ' https://git.example.test/me/skills.git ';
    remote.dispatchEvent(new Event('input'));
    [...foot().querySelectorAll('button')].find((button) => button.textContent === 'Choose location & clone…')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsClone).toHaveBeenLastCalledWith('/picked', 'https://git.example.test/me/skills.git');
  });

  it('Lantern skills shows the three slots and the installed skills to pick from', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('lantern');
    expect(body().querySelectorAll('.sk-roles [data-segment]')).toHaveLength(3);
    expect(body().querySelector('[data-slot="delegate"] [data-pick="alpha"]')).not.toBeNull();
    expect(cloneCommand()).toBeNull();
    expect(body().textContent).not.toContain('Skills repo not found');
  });

  it('Skill linker holds the clone prompt together with the editable repo path', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('linker');
    expect(cloneCommand()).not.toBeNull();
    expect(body().querySelector('[data-skill-linker="path"]')).not.toBeNull();
    const input = body().querySelector<HTMLInputElement>('.sk-settings .sk-set-field')!;
    expect(input.value).toBe('/skills');
    expect(body().querySelector('.sk-settings .sk-sync')).toBeNull();
    expect(foot().textContent).toContain('Choose location & clone');
    input.value = ' /typed ';
    body().querySelector<HTMLButtonElement>('.sk-settings .sk-role-act')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsClone).toHaveBeenLastCalledWith('/typed', '');
  });

  it('Choose location & clone adopts the picked folder and a failure stays on the Skill linker tab', async () => {
    withoutRepo(LISTING.project);
    window.ccmws.skillsClone = vi.fn(async () => ({ ok: false, error: 'no access' })) as unknown as typeof window.ccmws.skillsClone;
    await openModal();
    await openTab('linker');
    const remote = body().querySelector<HTMLInputElement>('[data-sk-remote]')!;
    remote.value = 'https://git.example.test/me/skills.git';
    remote.dispatchEvent(new Event('input'));
    [...foot().querySelectorAll('button')].find((button) => button.textContent === 'Choose location & clone…')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsClone).toHaveBeenLastCalledWith('/picked', 'https://git.example.test/me/skills.git');
    expect(activeTab()).toBe('linker');
    expect(cloneCommand()!.parentElement!.textContent).toContain('Clone failed: no access');
    expect(body().querySelector('.sk-settings .sk-set-field')).not.toBeNull();
  });

  it('with no project open the tabs stay: Project skills says so, Lantern skills and the Skill linker work', async () => {
    withoutRepo(null);
    await openModal();
    await openTab('project');
    expect(body().querySelectorAll('.sk-tab')).toHaveLength(3);
    expect(body().textContent).toContain('No project open');
    await openTab('lantern');
    expect(window.ccmws.extensionsLoad).toHaveBeenLastCalledWith(null);
    expect(body().querySelectorAll('.sk-roles [data-segment]')).toHaveLength(3);
    expect(body().querySelector('.sk-scope-pick')).not.toBeNull();
    await openTab('linker');
    expect(cloneCommand()).not.toBeNull();
    expect(body().querySelector<HTMLInputElement>('.sk-settings .sk-set-field')).not.toBeNull();
  });

  it('Refresh on Lantern skills reads the installed skills again', async () => {
    withoutRepo(LISTING.project);
    await openModal();
    await openTab('lantern');
    const list = window.ccmws.skillsList as ReturnType<typeof vi.fn>;
    const reads = list.mock.calls.length;
    window.ccmws.extensionsLoad = vi.fn(async () => ({ ...PANEL, installed: ['alpha', 'added-later'] })) as unknown as typeof window.ccmws.extensionsLoad;
    [...foot().querySelectorAll('button')].find((button) => button.textContent === msg('skillsExtras.refresh'))!.click();
    await settled();
    await settled();
    expect(list.mock.calls.length).toBe(reads + 1);
    expect(body().querySelector('[data-slot="delegate"] [data-pick="added-later"]')).not.toBeNull();
  });
});

describe('Skills modal with a skills repo that has no groups', () => {
  it('lists the skills with no group header', async () => {
    const saved = window.ccmws.skillsList;
    window.ccmws.skillsList = vi.fn(async () => ({ ...LISTING, available: [{ name: 'alpha', role: '' }, { name: 'beta', role: '' }] })) as unknown as typeof window.ccmws.skillsList;
    try {
      await openModal();
      expect(body().querySelectorAll(':scope > .sk-role')).toHaveLength(0);
      expect([...body().querySelectorAll('.sk-name')].map((n) => n.textContent)).toEqual(['alpha', 'beta']);
    } finally {
      window.ccmws.skillsList = saved;
    }
  });
});

describe('Skills modal', () => {
  it('opens on Project skills with three tabs in order and only the role list on screen', async () => {
    await openModal();
    expect([...body().querySelectorAll('.sk-tab')].map((t) => t.getAttribute('data-sk-tab'))).toEqual(['project', 'lantern', 'linker']);
    expect(activeTab()).toBe('project');
    expect(body().querySelectorAll(':scope > .sk-role')).toHaveLength(2);
    expect(body().querySelector('.sk-extras')).toBeNull();
    expect(body().querySelector('[data-skill-linker]')).toBeNull();
    expect(body().querySelector('[data-import]')).toBeNull();
    expect(foot().textContent).toContain('Link recommended');
  });

  it('Lantern skills shows the role selector and Import list, with no role list and no linker field', async () => {
    await openModal();
    await openTab('lantern');
    expect(activeTab()).toBe('lantern');
    expect(body().querySelectorAll('.sk-roles [data-segment]')).toHaveLength(3);
    expect(body().querySelector('[data-import="list"]')).not.toBeNull();
    expect(body().querySelectorAll(':scope > .sk-role')).toHaveLength(0);
    expect(body().querySelector('.sk-row[aria-disabled]:not(.locked)')).toBeNull();
    expect(body().querySelector('[data-skill-linker]')).toBeNull();
    expect(foot().textContent).not.toContain('Link recommended');
  });

  it('Skill linker shows the path field and state, with no role list and no slots', async () => {
    await openModal();
    await openTab('linker');
    expect(activeTab()).toBe('linker');
    expect(body().querySelector('[data-skill-linker="path"]')).not.toBeNull();
    expect(body().querySelector('[data-linker-state="unset"]')!.textContent).toBe('Not set');
    expect(body().querySelectorAll(':scope > .sk-role')).toHaveLength(0);
    expect(body().querySelector('[data-slot]')).toBeNull();
    expect(body().querySelector('[data-import]')).toBeNull();
  });

  it('Skill linker also holds the skills repo settings: path field, remote, version, status, Browse and Open folder', async () => {
    await openModal();
    await openTab('linker');
    const settings = body().querySelector('.sk-settings')!;
    expect(settings.querySelector<HTMLInputElement>('.sk-set-field')!.value).toBe('/skills');
    const values = [...settings.querySelectorAll('.sk-set-row')].map((row) => [row.querySelector('.sk-set-label')!.textContent, row.querySelector('.sk-set-val')!.textContent]);
    expect(values).toEqual([
      ['Remote', 'git@example.com:skills.git'],
      ['Version', '1.0.0'],
      ['Status', 'found'],
    ]);
    expect([...settings.querySelectorAll('.sk-set-actions button')].map((b) => b.textContent)).toEqual(['Browse…', 'Open folder']);
    expect(document.getElementById('sk-settings')).toBeNull();
  });

  it('keeps the version badge and the refresh button out of the header', async () => {
    await openModal();
    await openTab('linker');
    const head = document.querySelector('.modal-head')!;
    expect(document.getElementById('sk-version')).toBeNull();
    expect(document.getElementById('sk-sync')).toBeNull();
    expect(head.querySelector('.sk-sync, .sk-version')).toBeNull();
    expect(head.querySelector('#sk-proj')!.textContent).toBe('demo');
  });

  it('shows the version once in the linker tab, with the refresh button beside it', async () => {
    await openModal();
    await openTab('linker');
    const rows = [...body().querySelectorAll('.sk-settings .sk-set-row')];
    const version = rows.find((row) => row.querySelector('.sk-set-label')!.textContent === 'Version')!;
    expect(version.querySelector('.sk-set-val')!.textContent).toBe('1.0.0');
    expect(version.querySelector('button.sk-sync')).not.toBeNull();
    expect(body().querySelectorAll('.sk-sync')).toHaveLength(1);
    expect(body().textContent!.match(/1\.0\.0/g)).toHaveLength(1);
  });

  it('refresh spins only the glyph, calls the sync handler and re-reads the listing', async () => {
    await openModal();
    await openTab('linker');
    let release!: () => void;
    window.ccmws.skillsSync = vi.fn(() => new Promise((resolve) => (release = () => resolve({ ok: true })))) as unknown as typeof window.ccmws.skillsSync;
    const button = syncButton();
    const glyph = button.querySelector('.sk-sync-glyph')!;
    button.click();
    expect(window.ccmws.skillsSync).toHaveBeenCalledTimes(1);
    expect(glyph.classList.contains('spinning')).toBe(true);
    expect(button.classList.contains('spinning')).toBe(false);
    release();
    await settled();
    await settled();
    expect(glyph.classList.contains('spinning')).toBe(false);
    expect(activeTab()).toBe('linker');
    expect(syncButton().querySelector('.sk-sync-glyph')).not.toBeNull();
  });

  it('shows a failed refresh above the linker tab', async () => {
    await openModal();
    await openTab('linker');
    window.ccmws.skillsSync = vi.fn(async () => ({ ok: false, error: 'offline' })) as unknown as typeof window.ccmws.skillsSync;
    syncButton().click();
    await settled();
    await settled();
    expect(body().firstElementChild!.textContent).toBe('Sync failed: offline');
  });

  it('does not show the repo settings on the other tabs', async () => {
    await openModal();
    await openTab('project');
    expect(body().querySelector('.sk-settings')).toBeNull();
    await openTab('lantern');
    expect(body().querySelector('.sk-settings')).toBeNull();
  });

  it('Apply on the linker tab adopts the typed path through the repo handler, Browse the picked one, Open folder reveals it', async () => {
    await openModal();
    await openTab('linker');
    const input = body().querySelector<HTMLInputElement>('.sk-settings .sk-set-field')!;
    input.value = ' /typed ';
    body().querySelector<HTMLButtonElement>('.sk-settings .sk-role-act')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsClone).toHaveBeenLastCalledWith('/typed', '');
    expect(activeTab()).toBe('linker');
    expect(body().querySelector('.sk-settings')).not.toBeNull();

    [...body().querySelectorAll<HTMLButtonElement>('.sk-set-actions button')].find((b) => b.textContent === 'Browse…')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsClone).toHaveBeenLastCalledWith('/picked', '');

    [...body().querySelectorAll<HTMLButtonElement>('.sk-set-actions button')].find((b) => b.textContent === 'Open folder')!.click();
    expect(window.ccmws.skillsReveal).toHaveBeenCalled();
  });

  it('shows the failure from Apply in the linker tab and stays there', async () => {
    await openModal();
    await openTab('linker');
    window.ccmws.skillsClone = vi.fn(async () => ({ ok: false, error: 'no access' })) as unknown as typeof window.ccmws.skillsClone;
    body().querySelector<HTMLInputElement>('.sk-settings .sk-set-field')!.value = '/bad';
    body().querySelector<HTMLButtonElement>('.sk-settings .sk-role-act')!.click();
    await settled();
    await settled();
    expect(activeTab()).toBe('linker');
    expect(body().querySelector('.sk-set-err')!.textContent).toBe('Failed: no access');
  });

  it('remembers the selected tab while the modal stays open', async () => {
    await openModal();
    await openTab('linker');
    syncButton().click();
    await settled();
    await settled();
    expect(activeTab()).toBe('linker');
    await openTab('project');
    expect(activeTab()).toBe('project');
  });

  it('opens the add-skill step from Add skill and Back returns to the Lantern skills tab', async () => {
    await openModal();
    await openTab('lantern');
    slotButton('orchestrator').click();
    expect(body().querySelector('[data-add-skill-step="orchestrator"]')).not.toBeNull();
    expect(body().querySelector('.sk-extras')).toBeNull();
    expect(body().querySelector('.sk-scope-pick [aria-checked="true"]')!.textContent).toBe('This project');
    expect(foot().querySelector('[data-add-skill-save]')).not.toBeNull();
    foot().querySelector<HTMLButtonElement>('[data-add-skill-back]')!.click();
    await settled();
    expect(activeTab()).toBe('lantern');
    expect(body().querySelector('.sk-extras')).not.toBeNull();
    expect(body().querySelector('[data-add-skill-step]')).toBeNull();
  });

  it('shows the Reviewer role on the Lantern skills tab and opens its add-skill step', async () => {
    await openModal();
    await openTab('lantern');
    body().querySelector<HTMLButtonElement>('[data-segment="reviewer"]')!.click();
    const section = body().querySelector<HTMLElement>('[data-slot="reviewer"]')!;
    expect(section.querySelector('.sk-col-title')!.textContent).toBe(msg('skillsExtras.attached.title', { role: 'Reviewer' }));
    body().querySelector<HTMLButtonElement>('[data-builtin-toggle]')!.click();
    expect([...section.querySelectorAll('[data-switch] .sk-name')].map((node) => node.textContent)).toEqual(['lantern-no-comments', 'lantern-code-reviewer']);
    expect(section.querySelector('.sk-empty')!.textContent).toBe(msg('skillsExtras.attached.empty', { role: 'Reviewer' }));
    slotButton('reviewer').click();
    expect(body().querySelector('[data-add-skill-step="reviewer"]')).not.toBeNull();
  });

  it('gives the Lantern skills tab the wide card and the other tabs the normal one', async () => {
    document.getElementById('sk-close')!.click();
    await openModal();
    const modal = document.getElementById('skills-modal')!;
    expect(modal.classList.contains('sk-wide')).toBe(false);
    await openTab('lantern');
    expect(modal.classList.contains('sk-wide')).toBe(true);
    await openTab('linker');
    expect(modal.classList.contains('sk-wide')).toBe(false);
  });

  it('saves from the step through the IPC and returns to the Lantern skills tab', async () => {
    await openModal();
    await openTab('lantern');
    slotButton('delegate').click();
    body().querySelector<HTMLInputElement>('[data-skill-name]')!.value = 'fresh';
    body().querySelector<HTMLTextAreaElement>('[data-skill-content]')!.value = 'the text';
    foot().querySelector<HTMLButtonElement>('[data-add-skill-save]')!.click();
    await settled();
    await settled();
    expect(window.ccmws.extensionsCreate).toHaveBeenCalledWith('/demo', 'delegate', 'fresh', 'the text', 'project');
    expect(activeTab()).toBe('lantern');
    expect(body().querySelector('.sk-extras')).not.toBeNull();
    expect(body().querySelector('[data-add-skill-step]')).toBeNull();
  });

  it('keeps the step open and shows the error when main refuses', async () => {
    await openModal();
    await openTab('lantern');
    window.ccmws.extensionsCreate = vi.fn(async () => ({ ...PANEL, error: msg('extensions.skillExists', { name: 'alpha' }) })) as unknown as typeof window.ccmws.extensionsCreate;
    slotButton('delegate').click();
    body().querySelector<HTMLInputElement>('[data-skill-name]')!.value = 'alpha';
    body().querySelector<HTMLTextAreaElement>('[data-skill-content]')!.value = 'x';
    foot().querySelector<HTMLButtonElement>('[data-add-skill-save]')!.click();
    await settled();
    expect(body().querySelector('[data-add-skill-step]')).not.toBeNull();
    expect(body().querySelector('[role="alert"]')!.textContent).toBe(msg('extensions.skillExists', { name: 'alpha' }));
  });
});
