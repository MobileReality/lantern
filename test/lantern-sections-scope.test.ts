// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RbacSection, StatesSection } from '../src/main/lantern';
import { mapOf, node } from './helpers/lantern-map';
import { NODES, RBAC, STATES, cite, mount, openSection, overlay, q } from './helpers/lantern-sections';

const state = vi.hoisted(() => ({
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));
vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj', providerForProject: () => 'claude', app: state.app }));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn() }));

describe('platform scoping', () => {
  const platforms = [
    { id: 'web', kind: 'web' as const, label: 'Web', count: 1 },
    { id: 'backend', kind: 'backend' as const, label: 'API', count: 1 },
  ];
  const nodes = [node('web/a.ts', 'page', { platform: 'web' }), node('api/b.ts', 'service', { platform: 'backend' })];
  const scoped: RbacSection = { ...RBAC, id: 'api-access', platform: 'backend', roles: [{ ...RBAC.roles[0], cites: [cite('api/b.ts')] }], resources: [], cells: [] };
  const everywhere: StatesSection = { ...STATES, machines: [{ ...STATES.machines[0], cites: [cite('web/a.ts')] }] };
  const tabbed = () => mapOf({ platforms, nodes, sections: [scoped, everywhere] });
  const labels = (root: HTMLElement) => [...root.querySelectorAll('.lt-sec')].map((b) => b.textContent);
  const tab = (root: HTMLElement, id: string) => q(root, `.lt-plat[data-plat="${id}"]`).click();

  it('shows a scoped section only in its platform and in All, and unscoped ones everywhere', () => {
    const root = mount(tabbed());
    expect(labels(root)).toEqual(['RBAC 1', 'States 1']);
    tab(root, 'web');
    expect(labels(root)).toEqual(['States 1']);
    tab(root, 'backend');
    expect(labels(root)).toEqual(['RBAC 1', 'States 1']);
  });

  it('recomputes the counts for the tab and drops the bar when nothing is left', () => {
    const onlyScoped = mapOf({ platforms, nodes, sections: [scoped] });
    const root = mount(onlyScoped);
    tab(root, 'web');
    expect(root.querySelector('.lt-secbar')).toBeNull();
  });

  it('closes the overlay when the open section is not part of the tab switched to', () => {
    const onSection = vi.fn();
    const root = mount(tabbed(), { onSection });
    openSection(root, 'api-access');
    tab(root, 'web');
    expect(overlay(root).hidden).toBe(true);
    expect(q(root, '.lt-side').hidden).toBe(false);
    expect(onSection).toHaveBeenLastCalledWith('');
  });

  it('keeps the overlay open across a tab switch when the section is in both', () => {
    const root = mount(tabbed());
    openSection(root, 'states');
    tab(root, 'web');
    expect(overlay(root).hidden).toBe(false);
  });

  it('still closes on Esc after a platform tab was clicked and rebuilt', () => {
    const root = mount(tabbed());
    openSection(root, 'states');
    tab(root, 'web');
    expect(overlay(root).hidden).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay(root).hidden).toBe(true);
  });

  it('leaves Esc to an open modal, even one that closes itself first on the same key', () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    document.body.appendChild(modal);
    const closeModal = (ev: KeyboardEvent) => ev.key === 'Escape' && modal.classList.add('hidden');
    document.addEventListener('keydown', closeModal);
    const root = mount(tabbed());
    openSection(root, 'states');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(overlay(root).hidden).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay(root).hidden).toBe(true);
    document.removeEventListener('keydown', closeModal);
    modal.remove();
  });

  it('ignores Esc for a view that was removed from the page', () => {
    const onSection = vi.fn();
    const root = mount(tabbed(), { onSection });
    openSection(root, 'states');
    onSection.mockClear();
    root.remove();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onSection).not.toHaveBeenCalled();
  });

  it('switches to the platform tab of a cited file that lives in another one', () => {
    const onPlatform = vi.fn();
    const root = mount(tabbed(), { platform: 'backend', onPlatform });
    openSection(root, 'states');
    q(root, '.sx-machine .sx-cite[data-cite="web/a.ts"]').click();
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('web');
    expect(onPlatform).toHaveBeenLastCalledWith('web');
    expect(q(root, '.lt-detail .path .file-label').getAttribute('data-tip')).toBe('web/a.ts');
    expect(overlay(root).hidden).toBe(true);
  });

  it('stays on All when a cited file is inside the current scope', () => {
    const root = mount(tabbed());
    openSection(root, 'states');
    q(root, '.sx-machine .sx-cite[data-cite="web/a.ts"]').click();
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('');
    expect(q(root, '.lt-detail .path .file-label').getAttribute('data-tip')).toBe('web/a.ts');
  });
});

describe('panel memory', () => {
  async function open() {
    document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
    window.ccmws = { lanternLoad: vi.fn().mockResolvedValue(mapOf({ nodes: NODES, sections: [RBAC, STATES] })) } as unknown as Window['ccmws'];
    vi.resetModules();
    const { openLantern } = await import('../src/renderer/features/lantern');
    openLantern();
    await vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
  }

  it('remembers the open section per project across reopening the tab', async () => {
    await open();
    openSection(document.body, 'states');
    expect(state.app.lanternSection.get('/proj')).toBe('states');
    await open();
    expect(document.querySelector<HTMLElement>('.lt-overlay')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.lt-side')?.hidden).toBe(true);
    (document.querySelector('.sx-close') as HTMLElement).click();
    expect(state.app.lanternSection.get('/proj')).toBe('');
  });
});
