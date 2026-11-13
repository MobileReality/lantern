// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cliPanel } from '../src/renderer/features/cli-panel';
import type { CliStatus } from '../src/main/cli';

const SCRIPT = "/Applications/Lan'tern.app/Contents/Resources/app/cli/lantern";
const LINK = '/usr/local/bin/lantern';
const status = (overrides: Partial<CliStatus> = {}): CliStatus => ({ state: 'missing', link: LINK, script: SCRIPT, target: null, ...overrides });

const cliStatus = vi.fn<() => Promise<CliStatus | null>>();
const cliInstall = vi.fn<() => Promise<CliStatus | null>>();
const cliUninstall = vi.fn<() => Promise<CliStatus | null>>();

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const install = () => $<HTMLButtonElement>('.cli-install');
const uninstall = () => $<HTMLButtonElement>('.cli-uninstall');

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
  cliUninstall.mockReset();
  window.ccmws = { cliStatus, cliInstall, cliUninstall } as unknown as Window['ccmws'];
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

  it('hides Install and the guide in a development run', async () => {
    await mount(null);
    expect($('.cli-state').textContent).toMatch(/development run/);
    expect(install().hidden).toBe(true);
    expect($('.cli-guide').hidden).toBe(true);
  });

  it('shows the Linux PATH hint and the Windows new-terminal note beside an installed command', async () => {
    await mount(status({ state: 'installed', platform: 'linux', link: '/home/ann/.local/bin/lantern', target: SCRIPT, note: '~/.local/bin is not on your PATH.' }));
    expect($('.cli-note').textContent).toBe('~/.local/bin is not on your PATH.');
    expect($('.cli-note').hidden).toBe(false);
    expect($('.cli-guide').textContent).toContain('ln -sf');
    expect($('.cli-guide').textContent).not.toContain('sudo');
    await mount(status({ state: 'missing', platform: 'win32', link: 'C:\\L\\bin\\lantern.cmd' }));
    expect($('.cli-note').hidden).toBe(true);
    expect($('.cli-guide').textContent).toContain('user PATH');
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

  it('shows Uninstall only when the command is installed', async () => {
    await mount(status({ state: 'installed', target: SCRIPT }));
    expect(uninstall().hidden).toBe(false);
    expect(uninstall().textContent).toBe('Uninstall');
    for (const other of [status(), status({ state: 'other' }), null]) {
      await mount(other);
      expect(uninstall().hidden).toBe(true);
    }
  });

  it('uninstalls once and shows the new status with its note', async () => {
    await mount(status({ state: 'installed', platform: 'win32', target: SCRIPT }));
    cliUninstall.mockResolvedValue(status({ state: 'missing', platform: 'win32', note: 'Open a new terminal for it to take effect.' }));
    uninstall().click();
    await vi.waitFor(() => expect($('.cli-state').textContent).toBe('Not installed'));
    expect(cliUninstall).toHaveBeenCalledTimes(1);
    expect($('.cli-note').textContent).toBe('Open a new terminal for it to take effect.');
    expect(uninstall().hidden).toBe(true);
    expect(uninstall().disabled).toBe(false);
    expect($('.cli-error').textContent).toBe('');
  });

  it('shows an uninstall failure inline and keeps the command installed', async () => {
    await mount(status({ state: 'installed', target: SCRIPT }));
    cliUninstall.mockRejectedValue(new Error("Error invoking remote method 'cli:uninstall': Error: User canceled."));
    uninstall().click();
    await vi.waitFor(() => expect($('.cli-error').textContent).toBe("Couldn't uninstall: User canceled."));
    expect($('.cli-state').textContent).toBe(`Installed — ${LINK}`);
    expect(uninstall().hidden).toBe(false);
    expect(uninstall().disabled).toBe(false);
  });
});
