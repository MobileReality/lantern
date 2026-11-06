// @vitest-environment jsdom
import { msg } from '@shared/lang/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountIntegrationChip } from '@renderer/lib/integrations-chip';
import type { IntegrationChip } from '@renderer/lib/integrations-chip';
import { installAuthWindow } from './helpers/auth-window';
import type { AuthWindow } from './helpers/auth-window';

const SHOP = '/work/shop';

let world: AuthWindow;
let chip: IntegrationChip;
let opened = 0;

async function mount(host: Parameters<typeof installAuthWindow>[0]) {
  world = await installAuthWindow(host);
  opened = 0;
  chip = mountIntegrationChip(SHOP, () => (opened += 1));
  document.body.replaceChildren(chip.el);
}

afterEach(async () => {
  chip.dispose();
  await world.close();
});

const icons = () => [...chip.el.querySelectorAll<HTMLButtonElement>('.lt-int-icon')];
const summary = () => icons().map((icon) => `${icon.dataset.provider}${icon.classList.contains('is-missing') ? '!' : ''}: ${icon.dataset.tip}`);

describe('the integrations icons in the Lantern status bar', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('shows one icon per provider, named with its account in the tooltip, and says how to get one for those without', async () => {
    await mount({ host: { provider: 'github', owner: 'acme', repo: 'shop' } });
    world.addStatic('github', 'tok-a-0001', 'work');
    world.addStatic('jira', 'tok-j-0001', 'me@x.test', { email: 'me@x.test', site: 'https://x.atlassian.net' });
    await vi.waitFor(() => expect(summary()).toEqual([
      'github: GitHub: work. Click to change.',
      `bitbucket!: Bitbucket: ${msg('integrations.chip.noAccount')}. Click to choose an account for this project in Integrations.`,
      'jira: Jira: me@x.test. Click to change.',
    ]));
    expect(chip.el.hidden).toBe(false);
    expect(chip.el.textContent).toBe('');
    expect(icons().every((icon) => icon.getAttribute('aria-label') === icon.dataset.tip)).toBe(true);
  });

  it('asks for a choice when there are several accounts and none is pinned, then follows the pin', async () => {
    await mount({ host: { provider: 'github', owner: 'acme', repo: 'shop' } });
    world.addStatic('github', 'tok-a-0001', 'work');
    const home = world.addStatic('github', 'tok-b-0001', 'home').profile;
    await vi.waitFor(() => expect(summary()).toContain(`github!: GitHub: ${msg('integrations.chip.chooseAccount')}. Click to choose an account for this project in Integrations.`));
    world.auth.bind('github', home.id, SHOP);
    await vi.waitFor(() => expect(summary()).toContain('github: GitHub: home. Click to change.'));
  });

  it('offers an added account of a provider the project has no remote for, and follows the choice', async () => {
    await mount({ host: null });
    const bitbucket = world.addStatic('bitbucket', 'tok-b-0001', 'meacme', { email: 'me@x.test' }).profile;
    await vi.waitFor(() => expect(summary()).toContain(`bitbucket!: Bitbucket: ${msg('integrations.chip.chooseAccount')}. Click to choose an account for this project in Integrations.`));
    world.auth.bind('bitbucket', bitbucket.id, SHOP);
    await vi.waitFor(() => expect(summary()).toContain('bitbucket: Bitbucket: meacme. Click to change.'));
  });

  it('marks every provider without an account, whether or not there is a remote, and opens the screen on click', async () => {
    await mount({ host: null });
    await vi.waitFor(() => expect(chip.el.hidden).toBe(false));
    expect(summary()).toEqual(['GitHub', 'Bitbucket', 'Jira'].map((name) => `${name.toLowerCase()}!: ${name}: no account yet. Click to choose an account for this project in Integrations.`));
    icons()[0].click();
    expect(opened).toBe(1);
  });

  it('stops asking the main process once it is disposed, so a closed project costs nothing', async () => {
    await mount({ host: { provider: 'github', owner: 'acme', repo: 'shop' } });
    await vi.waitFor(() => expect(chip.el.hidden).toBe(false));
    const asked = () => world.calls.filter((call) => call.name === 'authProject').length;
    world.addStatic('github', 'tok-a-0001', 'work');
    await vi.waitFor(() => expect(summary().join()).toContain('work'));
    chip.dispose();
    const before = asked();
    world.addStatic('github', 'tok-b-0001', 'home');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked()).toBe(before);
  });

  it('stays hidden when the main process cannot answer', async () => {
    await mount({});
    window.ccmws.authProject = async () => ({ ok: false, error: 'invalid-request' });
    await chip.refresh();
    expect(chip.el.hidden).toBe(true);
  });
});
