// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rtkPanel } from '../src/renderer/features/rtk-panel';
import { app } from '../src/renderer/state';
import type { RtkStatus } from '../src/shared/rtk';

const status = (overrides: Partial<RtkStatus> = {}): RtkStatus => ({ found: false, path: null, version: null, edition: null, hookFound: false, hookFiles: [], reason: 'not-installed', ...overrides });
const rtkStatus = vi.fn<(project: string | null) => Promise<RtkStatus>>();
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

async function mount(result: RtkStatus) {
  rtkStatus.mockResolvedValue(result);
  const section = document.createElement('section');
  document.body.replaceChildren(section);
  rtkPanel.mount(section);
  await vi.waitFor(() => expect($('.rtk-state').textContent).not.toBe('Checking…'));
}

beforeEach(() => {
  rtkStatus.mockReset();
  app.activeKey = null;
  window.ccmws = { rtkStatus } as unknown as Window['ccmws'];
});

describe('RTK settings panel', () => {
  it('says it is optional and read only when RTK is missing, and offers no button', async () => {
    await mount(status());
    expect($('.rtk-state').textContent).toBe('Not installed. Lantern works the same without it.');
    expect($('.st-desc').textContent).toMatch(/never installs RTK or edits its settings/);
    expect(document.querySelector('button')).toBeNull();
    expect($('.rtk-hook').textContent).toBe('');
  });

  it('shows path, version and edition when found', async () => {
    await mount(status({ found: true, path: '/opt/homebrew/bin/rtk', version: '1.0.1', edition: 'oss', reason: null }));
    expect($('.rtk-state').textContent).toBe('Found — /opt/homebrew/bin/rtk · 1.0.1 · oss edition');
  });

  it('names a different rtk as not RTK', async () => {
    await mount(status({ path: '/usr/bin/rtk', reason: 'not-rtk' }));
    expect($('.rtk-state').textContent).toBe('/usr/bin/rtk is not RTK (Rust Token Killer), so Lantern ignores it.');
  });

  it('warns about a hook, names the file and says Lantern changes nothing', async () => {
    await mount(status({ found: true, path: '/x/rtk', version: '1.0.1', edition: 'full', hookFound: true, hookFiles: ['/Users/me/.claude/settings.json'], reason: null }));
    expect($('.rtk-hook').textContent).toContain('/Users/me/.claude/settings.json');
    expect($('.rtk-hook').textContent).toContain('Lantern changes nothing');
  });

  it('asks about the active project, and about none when only a blank tab is open', async () => {
    app.activeKey = '/work/app';
    await mount(status());
    expect(rtkStatus).toHaveBeenLastCalledWith('/work/app');
    app.activeKey = 'blank:1';
    await mount(status());
    expect(rtkStatus).toHaveBeenLastCalledWith(null);
  });

  it('shows a failed check inline without the IPC prefix', async () => {
    rtkStatus.mockRejectedValue(new Error("Error invoking remote method 'rtk:status': Error: boom"));
    const section = document.createElement('section');
    document.body.replaceChildren(section);
    rtkPanel.mount(section);
    await vi.waitFor(() => expect($('.rtk-error').textContent).toBe("Couldn't check for RTK: boom"));
    expect($('.rtk-state').textContent).toBe('');
  });
});
