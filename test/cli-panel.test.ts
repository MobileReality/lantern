// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cliPanel } from '../src/renderer/features/cli-panel';
import type { CliStatus } from '../src/main/cli';

const SCRIPT = "/Applications/Lan'tern.app/Contents/Resources/app/cli/lantern";
const LINK = '/usr/local/bin/lantern';
const status = (overrides: Partial<CliStatus> = {}): CliStatus => ({ state: 'missing', link: LINK, script: SCRIPT, target: null, ...overrides });

const cliStatus = vi.fn<() => Promise<CliStatus | null>>();
const cliInstall = vi.fn<() => Promise<CliStatus | null>>();

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const install = () => $<HTMLButtonElement>('.cli-install');

async function mount(initial: CliStatus | null) {
  cliStatus.mockResolvedValue(initial);
  const section = document.createElement('section');
  document.body.replaceChildren(section);
  cliPanel.mount(section);
  await vi.waitFor(() => expect($('.cli-state').textContent).not.toBe(''));
}

beforeEach(() => {
  cliStatus.mockReset();
  cliInstall.mockReset();
  window.ccmws = { cliStatus, cliInstall } as unknown as Window['ccmws'];
});

describe('Command line panel', () => {
  it('offers Install with a manual guide when the command is missing', async () => {
    await mount(status());
    expect($('.cli-state').textContent).toBe('Not installed');
    expect(install().hidden).toBe(false);
    expect(install().textContent).toBe('Install');
    const guide = $('.cli-guide').textContent!;
    expect(guide).toContain(`sudo ln -sf '/Applications/Lan'\\''tern.app/Contents/Resources/app/cli/lantern' ${LINK}`);
    expect(guide).toContain('lantern .');
    expect(guide).toContain('lantern ~/code/app');
    expect(guide).toContain(`sudo rm ${LINK}`);
  });

  it('shows the installed link and offers Reinstall', async () => {
    await mount(status({ state: 'installed', target: SCRIPT }));
    expect($('.cli-state').textContent).toBe(`Installed — ${LINK}`);
    expect(install().textContent).toBe('Reinstall');
  });

  it('names where a foreign link points', async () => {
    await mount(status({ state: 'other', target: '/Old/Lantern.app/cli/lantern' }));
    expect($('.cli-state').textContent).toBe(`${LINK} points somewhere else: /Old/Lantern.app/cli/lantern`);
  });

  it('offers no Install over a foreign command and explains how to replace it by hand', async () => {
    await mount(status({ state: 'other', target: null }));
    expect($('.cli-state').textContent).toBe(`${LINK} points somewhere else: not a link`);
    expect(install().hidden).toBe(true);
    const guide = $('.cli-guide').textContent!;
    expect($('.cli-guide').hidden).toBe(false);
    expect(guide).toContain(`sudo rm ${LINK}`);
    expect(guide).toContain(`sudo ln -s '/Applications/Lan'\\''tern.app/Contents/Resources/app/cli/lantern' ${LINK}`);
    expect(guide).not.toContain('ln -sf');
  });

  it('hides Install and the guide off macOS', async () => {
    await mount(null);
    expect($('.cli-state').textContent).toMatch(/macOS only/);
    expect(install().hidden).toBe(true);
    expect($('.cli-guide').hidden).toBe(true);
  });

  it('installs and shows the new status', async () => {
    await mount(status());
    cliInstall.mockResolvedValue(status({ state: 'installed', target: SCRIPT }));
    install().click();
    await vi.waitFor(() => expect($('.cli-state').textContent).toBe(`Installed — ${LINK}`));
    expect(install().disabled).toBe(false);
    expect($('.cli-error').textContent).toBe('');
  });

  it('shows an install failure inline without the IPC prefix', async () => {
    await mount(status());
    cliInstall.mockRejectedValue(new Error("Error invoking remote method 'cli:install': Error: User canceled."));
    install().click();
    await vi.waitFor(() => expect($('.cli-error').textContent).toBe("Couldn't install: User canceled."));
    expect($('.cli-state').textContent).toBe('Not installed');
    expect(install().disabled).toBe(false);
  });
});
