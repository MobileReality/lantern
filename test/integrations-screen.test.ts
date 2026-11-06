// @vitest-environment jsdom
import { msg } from '@shared/lang/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openIntegrations } from '@renderer/features/integrations';
import { app } from '@renderer/state';
import { DAY_MS } from '@shared/auth-expiry';
import { installAuthWindow } from './helpers/auth-window';
import type { AuthWindow } from './helpers/auth-window';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN } from './helpers/fake-tokens';

const GITHUB_TOKEN = FAKE_GITHUB_TOKEN;
const SECOND_GITHUB_TOKEN = 'ghp_ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210zy';
const ATLASSIAN_TOKEN = FAKE_ATLASSIAN_TOKEN;
const SHOP = { path: '/work/shop', name: 'shop' };
const GITHUB_HOST = { provider: 'github', owner: 'acme', repo: 'shop' } as const;

let world: AuthWindow;
let opener: HTMLButtonElement;

const $ = <T extends HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;
const $$ = <T extends HTMLElement>(selector: string, root: ParentNode = document) => [...root.querySelectorAll<T>(selector)];
const section = (provider: string) => $(`.int-provider[data-provider="${provider}"]`);
const rows = (provider: string) => $$('.int-account', section(provider));
const buttonNamed = (root: ParentNode, text: string) => $$<HTMLButtonElement>('button', root).find((candidate) => candidate.textContent === text)!;
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
};
const field = (provider: string, name: string) => $<HTMLInputElement>(`#int-form-${provider}-${name}`);
const detail = (row: HTMLElement) => $$('.int-detail-part', row).map((part) => part.textContent);
const settle = () => vi.waitFor(() => expect($$('.int-modal').length).toBe(1));

async function open(options: { projects?: { path: string; name: string }[]; focusProject?: string } = {}) {
  opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  openIntegrations(opener, { projects: () => options.projects ?? [], focusProject: options.focusProject, now: world.clock.now });
  await settle();
  await vi.waitFor(() => expect($$('.int-provider').length).toBe(3));
}

const tile = (path: string) => $<HTMLButtonElement>(`.int-tile[data-project="${path}"]`);

async function openDetail(project = SHOP) {
  await open({ projects: [project] });
  tile(project.path).click();
  await vi.waitFor(() => expect($$('.int-project')).toHaveLength(1));
}

async function addGithub(token = GITHUB_TOKEN, nickname = '') {
  buttonNamed(section('github'), msg('integrations.provider.add')).click();
  type(field('github', 'token'), token);
  type(field('github', 'nickname'), nickname);
  submit($<HTMLFormElement>('.int-form', section('github')));
  await vi.waitFor(() => expect($$('.int-form', section('github')).length).toBe(0));
}

beforeEach(() => {
  document.body.replaceChildren();
  app.activeKey = null;
});

afterEach(async () => {
  for (const close of $$('.int-modal .modal-close')) close.click();
  await world.close();
});

async function start(options: Parameters<typeof installAuthWindow>[0] = {}) {
  world = await installAuthWindow({ clock: undefined, ...options });
  world.fake.allow('github', { token: GITHUB_TOKEN, login: 'octo', displayName: 'Octo Cat', expires: '2026-12-31 10:30:00 UTC' });
  world.fake.allow('github', { token: SECOND_GITHUB_TOKEN, login: 'home-bot', displayName: 'Home Bot' });
  world.fake.allow('jira', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
  world.fake.allow('bitbucket', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme', scopes: ['write:pullrequest:bitbucket'] });
}

describe('the dialog', () => {
  beforeEach(() => start());

  it('is a labelled modal dialog that starts on its close button', async () => {
    await open();
    const modal = $('.int-modal');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect($(`#${modal.getAttribute('aria-labelledby')}`).textContent).toBe('Integrations');
    expect(document.activeElement).toBe($('.modal-close', modal));
  });

  it('closes on Escape and on the close button, giving focus back to what opened it', async () => {
    await open();
    key($('.int-modal'), 'Escape');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect($$('.int-modal')).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
    await open();
    $('.int-modal .modal-close').click();
    expect($$('.int-modal')).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it('opens once, however often it is asked', async () => {
    await open();
    openIntegrations(opener, { projects: () => [] });
    expect($$('.int-modal')).toHaveLength(1);
  });

  it('keeps Tab inside the dialog', async () => {
    await open();
    const last = $$<HTMLElement>('button, input, select', $('.int-modal')).filter((node) => !node.closest('[hidden]')).at(-1)!;
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect($('.int-modal').contains(document.activeElement)).toBe(true);
  });
});

describe('with no accounts yet', () => {
  beforeEach(() => start());

  it('has one section per provider, grouped as code hosts and tickets, each saying how to begin', async () => {
    await open();
    expect($$('.int-group-title').map((node) => node.textContent)).toEqual([msg('integrations.group.code-host'), msg('integrations.group.tracker'), msg('integrations.projects.title')]);
    expect($$('.int-provider-name').map((node) => node.textContent)).toEqual(['GitHub', 'Bitbucket', 'Jira']);
    expect(section('github').querySelector('.int-empty')?.textContent).toMatch(/No GitHub accounts yet/);
    expect(section('jira').querySelector('.int-empty')?.textContent).toMatch(/tickets/);
    expect($('.int-tiles').textContent).toMatch(/Open a project/);
    expect($('.int-banner').hidden).toBe(true);
  });

  it('asks for exactly the fields each provider needs, and keeps the token field secret', async () => {
    await open();
    const fieldsOf = (provider: string) => {
      buttonNamed(section(provider), msg('integrations.provider.add')).click();
      return $$<HTMLInputElement>('.int-input', $('.int-form', section(provider))).map((input) => input.name);
    };
    expect(fieldsOf('github')).toEqual(['token', 'email', 'nickname', 'expiresOn']);
    expect(fieldsOf('bitbucket')).toEqual(['email', 'token', 'nickname', 'expiresOn']);
    expect(fieldsOf('jira')).toEqual(['site', 'email', 'token', 'nickname', 'expiresOn']);
    expect($$('.int-form')).toHaveLength(1);
    for (const input of $$<HTMLInputElement>('input[name="token"]')) {
      expect(input.type).toBe('password');
      expect(input.autocomplete).toBe('off');
    }
  });

  it('shows where to create the token and which permissions to tick', async () => {
    await open();
    const help = async (provider: string) => {
      buttonNamed(section(provider), msg('integrations.provider.add')).click();
      return $('.int-help', section(provider)).textContent ?? '';
    };
    expect(await help('github')).toMatch(/Pull requests = Read and write.*Contents = Read/s);
    expect(await help('bitbucket')).toMatch(/write:pullrequest/);
    expect(await help('jira')).toMatch(/without scopes/);
    expect($('.int-help-page', section('jira')).textContent).toBe('id.atlassian.com/manage-profile/security/api-tokens');
  });

  it('marks the add button as expanded and closes the form on Cancel, returning focus to the button', async () => {
    await open();
    const add = buttonNamed(section('github'), msg('integrations.provider.add'));
    add.click();
    expect(add.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field('github', 'token'));
    buttonNamed($('.int-form'), msg('common.cancel')).click();
    expect($$('.int-form')).toHaveLength(0);
    expect(add.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(add);
  });

  it('closes the form on Escape without closing the dialog', async () => {
    await open();
    buttonNamed(section('github'), msg('integrations.provider.add')).click();
    const input = field('github', 'token');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect($$('.int-form')).toHaveLength(0);
    expect($$('.int-modal')).toHaveLength(1);
  });

  it('warns that nothing is kept after quitting when the computer has no secure storage', async () => {
    world.cipher.setAvailable(false);
    await open();
    expect($('.int-banner').hidden).toBe(false);
    expect($('.int-banner').textContent).toMatch(/only until you quit/);
  });
});

describe('adding an account', () => {
  beforeEach(() => start());

  it('refuses an empty token or a foreign Jira site on the spot, without asking the main process', async () => {
    await open();
    buttonNamed(section('github'), msg('integrations.provider.add')).click();
    submit($('.int-form'));
    expect(field('github', 'token').getAttribute('aria-invalid')).toBe('true');
    expect($('.int-field-error:not([hidden])').textContent).toMatch(/Paste the whole token/);
    expect(document.activeElement).toBe(field('github', 'token'));
    buttonNamed(section('jira'), msg('integrations.provider.add')).click();
    type(field('jira', 'token'), ATLASSIAN_TOKEN);
    type(field('jira', 'email'), 'me@acme.test');
    type(field('jira', 'site'), 'https://evil.test');
    submit($('.int-form', section('jira')));
    expect(field('jira', 'site').getAttribute('aria-invalid')).toBe('true');
    expect(world.calls.filter((call) => call.name === 'authAddToken')).toEqual([]);
  });

  it('checks the token, lists the account with its login, name and the expiry GitHub reports, and clears the paste field', async () => {
    await open();
    buttonNamed(section('github'), msg('integrations.provider.add')).click();
    const input = field('github', 'token');
    type(input, GITHUB_TOKEN);
    submit($('.int-form'));
    await vi.waitFor(() => expect(rows('github')).toHaveLength(1));
    expect(input.value).toBe('');
    const row = rows('github')[0];
    expect($('.int-nickname', row).textContent).toBe('octo');
    expect(detail(row)).toEqual(['Octo Cat']);
    expect($('.int-added', row).textContent).toMatch(/^Added \d{1,2} \w{3} \d{4}$/);
    expect($('.int-expiry', row).textContent).toContain('Expires 31 Dec 2026');
    expect($('.int-expiry-source', row).textContent).toBe(msg('integrations.expiry.providerReported'));
    expect($('.int-announce').textContent).toBe('Added octo.');
    expect($$('.int-form')).toHaveLength(0);
    expect(section('github').querySelector('.int-empty')?.hasAttribute('hidden')).toBe(true);
    expect($('.int-count', section('github')).textContent).toBe('1 account');
  });

  it('shows the busy state while the provider is asked, and leaves the form usable after a refusal', async () => {
    await open();
    buttonNamed(section('github'), msg('integrations.provider.add')).click();
    type(field('github', 'token'), 'ghp_notaknowntokennotaknowntokennotakno');
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => (release = resolve));
    const real = window.ccmws.authAddToken;
    window.ccmws.authAddToken = (input) => pending.then(() => real(input));
    submit($('.int-form'));
    expect($<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect($('.int-form-status').textContent).toBe('Checking with GitHub…');
    expect($('.int-form').getAttribute('aria-busy')).toBe('true');
    release(undefined);
    await vi.waitFor(() => expect($('.int-form-failure:not([hidden])').textContent).toMatch(/GitHub rejected this token/));
    expect($<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    expect($('.int-form-status').textContent).toBe('');
    expect(field('github', 'token').value).toBe('ghp_notaknowntokennotaknowntokennotakno');
    expect(rows('github')).toHaveLength(0);
    expect(world.auth.status().providers.github.profiles).toEqual([]);
  });

  it('says clearly when the provider cannot be reached', async () => {
    world.fake.mode('github', { kind: 'status', status: 503 });
    await open();
    buttonNamed(section('github'), msg('integrations.provider.add')).click();
    type(field('github', 'token'), GITHUB_TOKEN);
    submit($('.int-form'));
    await vi.waitFor(() => expect($('.int-form-failure:not([hidden])').textContent).toMatch(/not available right now \(status 503\)/));
  });

  it('adds Bitbucket and Jira accounts with their email and site, shown as details', async () => {
    await open();
    buttonNamed(section('bitbucket'), msg('integrations.provider.add')).click();
    type(field('bitbucket', 'email'), 'me@acme.test');
    type(field('bitbucket', 'token'), ATLASSIAN_TOKEN);
    submit($('.int-form', section('bitbucket')));
    await vi.waitFor(() => expect(rows('bitbucket')).toHaveLength(1));
    expect(detail(rows('bitbucket')[0])).toEqual(['Me Acme', 'me@acme.test']);
    buttonNamed(section('jira'), msg('integrations.provider.add')).click();
    type(field('jira', 'site'), 'acme.atlassian.net');
    type(field('jira', 'email'), 'me@acme.test');
    type(field('jira', 'token'), ATLASSIAN_TOKEN);
    type(field('jira', 'nickname'), 'Acme tickets');
    submit($('.int-form', section('jira')));
    await vi.waitFor(() => expect(rows('jira')).toHaveLength(1));
    expect($('.int-nickname', rows('jira')[0]).textContent).toBe('Acme tickets');
    expect(detail(rows('jira')[0])).toEqual(['me@acme.test', 'acme.atlassian.net']);
    expect($('.int-nickname', rows('jira')[0]).textContent).toBe('Acme tickets');
  });

  it('keeps two accounts of one provider side by side', async () => {
    await open();
    await addGithub(GITHUB_TOKEN);
    await addGithub(SECOND_GITHUB_TOKEN, 'Home');
    expect(rows('github').map((row) => $('.int-nickname', row).textContent)).toEqual(['octo', 'Home']);
    expect($('.int-count', section('github')).textContent).toBe('2 accounts');
  });

  it('never leaves a token in the page', async () => {
    await open();
    await addGithub();
    expect(document.body.innerHTML).not.toContain(GITHUB_TOKEN);
    expect($$<HTMLInputElement>('input').some((input) => input.value.includes(GITHUB_TOKEN))).toBe(false);
  });
});

describe('what an account shows and lets you do', () => {
  beforeEach(() => start());

  it('flags a token that expires within 14 days or has expired, and says nothing for the rest', async () => {
    const now = world.clock.now();
    world.addStatic('github', 'tok-a-0001', 'soon', { expiresAt: now + 6 * DAY_MS, expirySource: 'manual' });
    world.addStatic('github', 'tok-b-0001', 'tomorrow', { expiresAt: now + DAY_MS / 2, expirySource: 'manual' });
    world.addStatic('github', 'tok-c-0001', 'gone', { expiresAt: now - 3 * DAY_MS, expirySource: 'manual' });
    world.addStatic('github', 'tok-d-0001', 'later', { expiresAt: now + 90 * DAY_MS, expirySource: 'manual' });
    world.addStatic('github', 'tok-e-0001', 'open-ended');
    await open();
    const chips = rows('github').map((row) => $('.int-expiry', row));
    expect(chips.map((chip) => chip.className.replace('int-expiry ', ''))).toEqual(['int-expiry-soon', 'int-expiry-soon', 'int-expiry-expired', 'int-expiry-ok', 'int-expiry-none']);
    expect(chips.map((chip) => chip.textContent)).toEqual(['Expires in 6 days', msg('integrations.expiry.tomorrow'), 'Expired 3 days ago', expect.stringMatching(/^Expires \d+ \w{3} \d{4}$/), msg('integrations.expiry.none')]);
    expect(chips.map((chip) => chip.querySelector('svg') !== null)).toEqual([true, true, true, false, false]);
  });

  it('renames an account inline and cancels with Escape', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    await open();
    const row = () => rows('github')[0];
    buttonNamed(row(), msg('common.rename')).click();
    expect($('.int-nickname', row()).closest('[hidden]')).not.toBeNull();
    const input = $<HTMLInputElement>('.int-inline .int-input', row());
    expect(input.value).toBe('work');
    expect(document.activeElement).toBe(input);
    key(input, 'Escape');
    expect($$('.int-inline', row())).toHaveLength(0);
    expect(document.activeElement).toBe(buttonNamed(row(), msg('common.rename')));
    buttonNamed(row(), msg('common.rename')).click();
    type($<HTMLInputElement>('.int-inline .int-input', row()), 'Laptop');
    submit($<HTMLFormElement>('.int-inline', row()));
    await vi.waitFor(() => expect($('.int-nickname', rows('github')[0]).textContent).toBe('Laptop'));
  });

  it('tells you when a name cannot be used', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    await open();
    buttonNamed(rows('github')[0], msg('common.rename')).click();
    type($<HTMLInputElement>('.int-inline .int-input'), '   ');
    submit($<HTMLFormElement>('.int-inline'));
    await vi.waitFor(() => expect($('.int-account-error:not([hidden])').textContent).toBe('Use a name of up to 60 characters.'));
  });

  it('sets, changes and clears a manual expiry, but not one the provider reports', async () => {
    world.addStatic('bitbucket', 'tok-a-0001', 'meacme', { email: 'me@acme.test' });
    world.addStatic('github', 'tok-b-0001', 'octo', { expiresAt: world.clock.now() + 90 * DAY_MS, expirySource: 'provider' });
    await open();
    expect($$<HTMLButtonElement>('button', rows('github')[0]).map((b) => b.textContent)).toEqual([msg('common.rename'), msg('integrations.account.setEmail'), msg('integrations.account.remove')]);
    const row = () => rows('bitbucket')[0];
    buttonNamed(row(), msg('integrations.account.setExpiry')).click();
    const date = $<HTMLInputElement>('.int-inline input[type="date"]', row());
    type(date, new Date(world.clock.now() + 5 * DAY_MS).toISOString().slice(0, 10));
    submit($<HTMLFormElement>('.int-inline', row()));
    await vi.waitFor(() => expect($('.int-expiry', rows('bitbucket')[0]).className).toContain('int-expiry-soon'));
    buttonNamed(row(), msg('integrations.account.changeExpiry')).click();
    expect($<HTMLInputElement>('.int-inline input[type="date"]', row()).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    buttonNamed(row(), msg('integrations.account.noExpiry')).click();
    await vi.waitFor(() => expect($('.int-expiry', rows('bitbucket')[0]).textContent).toBe(msg('integrations.expiry.none')));
  });

  it('shows the commit email of a GitHub account, and says plainly when there is none', async () => {
    world.addStatic('github', 'tok-a-0001', 'octo');
    world.addStatic('github', 'tok-b-0001', 'home-bot', { email: 'bot@acme.test' });
    await open();
    const [none, withEmail] = rows('github');
    expect($('.int-account-email-value', none).textContent).toBe(msg('integrations.account.emailNone'));
    expect($('.int-account-email-label', none).textContent).toBe(msg('integrations.account.emailLine'));
    expect(buttonNamed(none, msg('integrations.account.setEmail'))).toBeDefined();
    expect($('.int-account-email-value', withEmail).textContent).toBe('bot@acme.test');
    expect(detail(withEmail)).not.toContain('bot@acme.test');
    expect(buttonNamed(withEmail, msg('integrations.account.changeEmail'))).toBeDefined();
  });

  it('sets, validates, changes and clears the commit email of a GitHub account', async () => {
    world.addStatic('github', 'tok-a-0001', 'octo');
    await open();
    const row = () => rows('github')[0];
    buttonNamed(row(), msg('integrations.account.setEmail')).click();
    const input = () => $<HTMLInputElement>('.int-inline input[type="email"]', row());
    type(input(), 'nope');
    submit($<HTMLFormElement>('.int-inline', row()));
    expect($('.int-account-error:not([hidden])', row()).textContent).toBe(msg('integrations.failure.emailInvalid'));
    type(input(), 'work@acme.test');
    submit($<HTMLFormElement>('.int-inline', row()));
    await vi.waitFor(() => expect($('.int-account-email-value', row()).textContent).toBe('work@acme.test'));
    buttonNamed(row(), msg('integrations.account.changeEmail')).click();
    expect(input().value).toBe('work@acme.test');
    buttonNamed(row(), msg('integrations.account.noEmail')).click();
    await vi.waitFor(() => expect($('.int-account-email-value', row()).textContent).toBe(msg('integrations.account.emailNone')));
    expect(world.auth.status().providers.github.profiles[0].email).toBeNull();
  });

  it('offers no commit email edit on a Bitbucket account, which has its email already', async () => {
    world.addStatic('bitbucket', 'tok-a-0001', 'meacme', { email: 'me@acme.test' });
    await open();
    expect($$('.int-account-email', rows('bitbucket')[0])).toHaveLength(0);
    expect($$<HTMLButtonElement>('button', rows('bitbucket')[0]).map((b) => b.textContent)).not.toContain(msg('integrations.account.setEmail'));
  });

  it('draws each provider logo in its header, account card and add form, with no letter', async () => {
    world.addStatic('github', 'tok-a-0001', 'octo');
    world.addStatic('bitbucket', 'tok-b-0001', 'meacme', { email: 'me@acme.test' });
    world.addStatic('jira', 'tok-c-0001', 'me@acme.test', { email: 'me@acme.test', site: 'https://acme.atlassian.net' });
    await open();
    for (const provider of ['github', 'bitbucket', 'jira']) {
      expect($(`.int-provider-head .prov-logo-${provider} svg`, section(provider))).toBeTruthy();
      expect($(`.int-mark .prov-logo-${provider} svg`, rows(provider)[0])).toBeTruthy();
      expect($('.int-mark', rows(provider)[0]).textContent).toBe('');
      buttonNamed(section(provider), msg('integrations.provider.add')).click();
      expect($(`.int-form-title .prov-logo-${provider} svg`, section(provider))).toBeTruthy();
    }
  });

  it('removes an account after a second click, and says so', async () => {
    const { profile } = world.addStatic('github', 'tok-a-0001', 'work');
    world.auth.bind('github', profile.id, '/work/shop');
    await open();
    const remove = buttonNamed(rows('github')[0], msg('integrations.account.remove'));
    remove.click();
    expect(remove.textContent).toBe(msg('integrations.account.removeConfirm'));
    expect(rows('github')).toHaveLength(1);
    remove.click();
    await vi.waitFor(() => expect(rows('github')).toHaveLength(0));
    expect($('.int-announce').textContent).toBe('Removed work.');
    expect(world.auth.status('/work/shop').providers.github.profiles).toEqual([]);
  });

  it('says what is wrong with an account whose stored token is gone', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    world.cipher.setAvailable(false);
    const locked = await installAuthWindow({ dir: world.dir, cipher: world.cipher, clock: world.clock });
    await world.close();
    world = locked;
    await open();
    expect($('.int-account-problem').textContent).toMatch(/Secure storage could not be read/);
  });
});

describe('the projects section', () => {
  beforeEach(() => start({ host: GITHUB_HOST }));

  it('suggests the code host from the remote and asks which account when there are several', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    world.addStatic('github', 'tok-b-0001', 'home');
    await openDetail();
    const card = $('.int-project');
    expect($('.int-project-name', card).textContent).toBe('shop');
    expect($('.int-project-remote', card).textContent).toBe('Remote github.com/acme/shop');
    const slot = $('.int-slot[data-provider="github"]', card);
    expect([...$('.int-slot-title', slot).children].map((node) => node.textContent)).toEqual(['GitHub', msg('integrations.role.code-host')]);
    const select = $<HTMLSelectElement>('select', slot);
    expect(select.getAttribute('aria-label')).toBe('GitHub account for shop');
    expect($$('option', select).map((option) => option.textContent)).toEqual([msg('integrations.projects.choose'), 'work', 'home']);
    expect(select.selectedOptions[0].disabled).toBe(true);
    expect($('.int-slot-note', slot).textContent).toBe('Choose a GitHub account for this project');
    expect($('.int-slot-note', slot).className).toContain('int-slot-ask');
    expect(buttonNamed(slot, msg('integrations.projects.unlink'))).toBeUndefined();
  });

  it('pins the chosen account, offers Unlink, and unlinks back to the question', async () => {
    const work = world.addStatic('github', 'tok-a-0001', 'work').profile;
    world.addStatic('github', 'tok-b-0001', 'home');
    await openDetail();
    const slot = () => $('.int-project .int-slot[data-provider="github"]');
    const select = $<HTMLSelectElement>('select', slot());
    select.value = work.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('.int-slot-note', slot()).textContent).toBe(msg('integrations.binding.bound')));
    expect(world.auth.status(SHOP.path).providers.github.bound).toBe(work.id);
    expect($<HTMLSelectElement>('select', slot()).value).toBe(work.id);
    buttonNamed(slot(), msg('integrations.projects.unlink')).click();
    await vi.waitFor(() => expect($('.int-slot-note', slot()).textContent).toBe('Choose a GitHub account for this project'));
    expect(world.auth.status(SHOP.path).providers.github.bound).toBeNull();
  });

  it('uses the only account by default, without an Unlink', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    await openDetail();
    const slot = $('.int-slot[data-provider="github"]');
    expect($('.int-slot-note', slot).textContent).toBe('Your only GitHub account, used by default');
    expect(buttonNamed(slot, msg('integrations.projects.unlink'))).toBeUndefined();
    expect($('.int-slot-run', slot).textContent).toBe(msg('integrations.winner.lantern'));
  });

  it('offers to add an account when there is none, and opens that form', async () => {
    await openDetail();
    const slot = $('.int-slot[data-provider="jira"]');
    expect([...$('.int-slot-title', slot).children].map((node) => node.textContent)).toEqual(['Jira', msg('integrations.role.tracker')]);
    buttonNamed(slot, 'Add a Jira account').click();
    expect($$('.int-form', section('jira'))).toHaveLength(1);
    expect(document.activeElement).toBe(field('jira', 'site'));
  });

  it('shows a slot for every provider for a project without a GitHub or Bitbucket remote, suggesting none', async () => {
    world.surroundings.host = null;
    await openDetail();
    expect($('.int-project-remote').textContent).toBe(msg('integrations.projects.noRemote', { hosts: 'GitHub or Bitbucket' }));
    expect($$('.int-slot').map((slot) => slot.dataset.provider)).toEqual(['github', 'bitbucket', 'jira']);
    expect($$('.int-slot-hint')).toHaveLength(0);
  });

  it('names the provider of the origin remote as the suggestion, without hiding the others', async () => {
    await openDetail();
    expect($$('.int-slot').map((slot) => slot.dataset.provider)).toEqual(['github', 'bitbucket', 'jira']);
    expect($$('.int-slot-hint').map((hint) => [hint.closest<HTMLElement>('.int-slot')!.dataset.provider, hint.textContent])).toEqual([['github', 'Suggested: GitHub, from the origin remote']]);
  });

  it('lets a brand-new project without an origin remote use the accounts already added, with a choice per provider', async () => {
    world.surroundings.host = null;
    const octo = world.addStatic('github', 'tok-a-0001', 'octo').profile;
    world.addStatic('github', 'tok-b-0001', 'home');
    const meacme = world.addStatic('bitbucket', 'tok-c-0001', 'meacme', { email: 'me@acme.test' }).profile;
    await openDetail();
    const slot = (provider: string) => $(`.int-project .int-slot[data-provider="${provider}"]`);
    expect($$('option', $<HTMLSelectElement>('select', slot('github'))).map((option) => option.textContent)).toEqual([msg('integrations.projects.choose'), 'octo', 'home']);
    expect($('.int-slot-note', slot('github')).textContent).toBe('This project does not use GitHub yet. Choose an account to use it here.');
    expect($$('option', $<HTMLSelectElement>('select', slot('bitbucket'))).map((option) => option.textContent)).toEqual([msg('integrations.projects.choose'), 'meacme']);
    expect(buttonNamed(slot('jira'), 'Add a Jira account')).toBeDefined();
    expect($('.int-slot-note', slot('jira')).textContent).toBe(msg('integrations.binding.none', { provider: 'Jira' }));
    const select = $<HTMLSelectElement>('select', slot('github'));
    select.value = octo.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('.int-slot-note', slot('github')).textContent).toBe(msg('integrations.binding.bound')));
    const bitbucket = $<HTMLSelectElement>('select', slot('bitbucket'));
    bitbucket.value = meacme.id;
    bitbucket.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('.int-slot-note', slot('bitbucket')).textContent).toBe(msg('integrations.binding.bound')));
    expect(Object.keys(await world.auth.injectionFor(SHOP.path)).sort()).toEqual(['bitbucket', 'github']);
    expect(buttonNamed(slot('github'), msg('integrations.projects.unlink'))).toBeDefined();
  });

  it('lets a GitHub project choose a Bitbucket account, and clear it again', async () => {
    const meacme = world.addStatic('bitbucket', 'tok-c-0001', 'meacme', { email: 'me@acme.test' }).profile;
    await openDetail();
    const slot = () => $('.int-project .int-slot[data-provider="bitbucket"]');
    expect($('.int-slot-note', slot()).className).not.toContain('int-slot-ask');
    const select = $<HTMLSelectElement>('select', slot());
    select.value = meacme.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('.int-slot-note', slot()).textContent).toBe(msg('integrations.binding.bound')));
    expect($('.int-slot-run', slot()).textContent).toBe(msg('integrations.winner.lantern'));
    expect(Object.keys(await world.auth.injectionFor(SHOP.path))).toEqual(['bitbucket']);
    buttonNamed(slot(), msg('integrations.projects.unlink')).click();
    await vi.waitFor(() => expect($('.int-slot-note', slot()).textContent).toMatch(/does not use Bitbucket yet/));
    expect(await world.auth.injectionFor(SHOP.path)).toEqual({});
  });

  it('shows the empty state of a provider with no account, with the add flow', async () => {
    await openDetail();
    const slot = $('.int-project .int-slot[data-provider="bitbucket"]');
    expect($('.int-slot-note', slot).textContent).toBe(msg('integrations.binding.none', { provider: 'Bitbucket' }));
    expect($$('select', slot)).toHaveLength(0);
    buttonNamed(slot, 'Add a Bitbucket account').click();
    expect($$('.int-form', section('bitbucket'))).toHaveLength(1);
  });

  it('warns, apart from the grey hint, when a chosen account is shadowed by a variable in the environment', async () => {
    world.surroundings.env = { GITHUB_TOKEN: 'from-the-shell' };
    const work = world.addStatic('github', 'tok-a-0001', 'work').profile;
    world.addStatic('github', 'tok-b-0001', 'home');
    await openDetail();
    const slot = () => $('.int-project .int-slot[data-provider="github"]');
    expect($$('.int-slot-warn', slot())).toHaveLength(0);
    const select = $<HTMLSelectElement>('select', slot());
    select.value = work.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($$('.int-slot-warn', slot())).toHaveLength(1));
    expect($('.int-slot-warn', slot()).textContent).toBe(msg('integrations.projects.shadowed'));
    expect($('.int-slot-run', slot()).className).not.toContain('int-slot-warn');
    expect($$('.int-slot-env', slot()).map((line) => line.textContent)).toEqual(['Set in the environment: GITHUB_TOKEN']);
    expect(document.body.innerHTML).not.toContain('from-the-shell');
  });

  it('does not warn about a shadow for an account used by default', async () => {
    world.surroundings.env = { GITHUB_TOKEN: 'from-the-shell' };
    world.addStatic('github', 'tok-a-0001', 'work');
    await openDetail();
    expect($$('.int-slot-warn')).toHaveLength(0);
  });

  it('says nothing about a token file, however many tokens it holds', async () => {
    world.surroundings.fileNames = ['GITHUB_TOKEN'];
    world.addStatic('github', 'tok-a-0001', 'work');
    await openDetail();
    const slot = $('.int-slot[data-provider="github"]');
    expect($('.int-slot-run', slot).textContent).toBe(msg('integrations.winner.lantern'));
    expect($$('.int-slot-env', slot)).toHaveLength(0);
    expect($('.int-modal').textContent).not.toContain('.ai/.env');
    expect(document.body.innerHTML).not.toContain('tok-a-0001');
  });

  it('says the environment wins when the variable is already set', async () => {
    world.surroundings.env = { GITHUB_TOKEN: 'from-the-shell' };
    world.addStatic('github', 'tok-a-0001', 'work');
    await openDetail();
    const slot = $('.int-slot[data-provider="github"]');
    expect($('.int-slot-run', slot).textContent).toMatch(/variable already set in the environment/);
    expect($$('.int-slot-env', slot).map((line) => line.textContent)).toEqual(['Set in the environment: GITHUB_TOKEN']);
    expect(document.body.innerHTML).not.toContain('from-the-shell');
  });

  it('lands on the detail of the project the screen was opened for', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    world.addStatic('github', 'tok-b-0001', 'home');
    await open({ projects: [SHOP, { path: '/work/blog', name: 'blog' }], focusProject: '/work/blog' });
    await vi.waitFor(() => expect($('.int-project[data-project="/work/blog"]').contains(document.activeElement)).toBe(true));
    expect($$('.int-tile')).toHaveLength(0);
  });

  it('follows changes made while it is open', async () => {
    await openDetail();
    expect($('.int-slot[data-provider="github"] button').textContent).toBe('Add a GitHub account');
    world.addStatic('github', 'tok-a-0001', 'work');
    await vi.waitFor(() => expect($('.int-slot[data-provider="github"] select')).not.toBeNull());
  });

  it('shows the project selected in the window when it is not told which one, without leaving the accounts', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    world.addStatic('github', 'tok-b-0001', 'home');
    app.activeKey = SHOP.path;
    await open({ projects: [SHOP, { path: '/work/blog', name: 'blog' }] });
    await vi.waitFor(() => expect($$('.int-project[data-project="/work/shop"] select')).toHaveLength(1));
    expect($$('.int-tile')).toHaveLength(0);
    expect(document.activeElement).toBe($('.int-modal .modal-close'));
  });

  it('shows the list of projects when the selected one is not among those opened', async () => {
    app.activeKey = '/work/elsewhere';
    await open({ projects: [SHOP] });
    await vi.waitFor(() => expect($$('.int-tile')).toHaveLength(1));
    expect($$('.int-project')).toHaveLength(0);
  });

  it('offers a button next to the accounts that jumps to the projects, so the choice is not out of sight', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    world.addStatic('github', 'tok-b-0001', 'home');
    await open({ projects: [SHOP] });
    await vi.waitFor(() => expect($$('.int-tile')).toHaveLength(1));
    const jump = $<HTMLButtonElement>('.int-jump');
    expect(jump.textContent).toBe(msg('integrations.projects.jump'));
    expect(jump.dataset.tip).toBe(msg('integrations.projects.jumpTitle'));
    expect(jump.compareDocumentPosition($('.int-projects')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    jump.click();
    expect(document.activeElement).toBe(tile(SHOP.path));
  });

  it('jumps to the open project, on its first chooser, when the detail is showing', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    world.addStatic('github', 'tok-b-0001', 'home');
    await openDetail();
    $<HTMLElement>('.int-modal .modal-close').focus();
    $<HTMLButtonElement>('.int-jump').click();
    expect(document.activeElement).toBe($('.int-project select'));
  });
});

describe('the project tiles', () => {
  beforeEach(() => start({ host: GITHUB_HOST }));

  const MANY = Array.from({ length: 12 }, (_, index) => ({ path: `/work/app-${index}`, name: `app-${index}` }));

  it('shows one compact tile per project instead of twelve expanded sections', async () => {
    await open({ projects: MANY });
    expect($$('.int-tile').map((node) => $('.int-tile-name', node).textContent)).toEqual(MANY.map((project) => project.name));
    expect($$('.int-project')).toHaveLength(0);
    expect($$('.int-slot')).toHaveLength(0);
    expect($('.int-tiles').className).toBe('int-tiles');
  });

  it('says on each tile what is connected, or that it needs attention', async () => {
    world.addStatic('github', 'tok-a-0001', 'work');
    await open({ projects: [SHOP] });
    expect($('.int-tile-state', tile(SHOP.path)).textContent).toBe(msg('integrations.tile.connected', { providers: 'GitHub' }));
    expect(tile(SHOP.path).getAttribute('aria-label')).toBe(msg('integrations.projects.openTile', { project: 'shop', state: msg('integrations.tile.connected', { providers: 'GitHub' }) }));
    expect($$('.prov-logo', tile(SHOP.path)).map((logo) => logo.className)).toEqual([expect.stringContaining('prov-logo-github')]);
    world.addStatic('github', 'tok-b-0001', 'home');
    await vi.waitFor(() => expect($('.int-tile-state', tile(SHOP.path)).textContent).toBe(msg('integrations.tile.attention')));
    expect(tile(SHOP.path).className).toContain('int-tile-ask');
  });

  it('says nothing is connected when a project has no account yet', async () => {
    await open({ projects: [SHOP] });
    expect($('.int-tile-state', tile(SHOP.path)).textContent).toBe(msg('integrations.tile.none'));
  });

  it('does not ask for attention because of accounts of a provider the project does not use', async () => {
    world.addStatic('bitbucket', 'tok-c-0001', 'meacme', { email: 'me@acme.test' });
    world.addStatic('bitbucket', 'tok-d-0001', 'other', { email: 'other@acme.test' });
    await open({ projects: [SHOP] });
    expect($('.int-tile-state', tile(SHOP.path)).textContent).toBe(msg('integrations.tile.none'));
    expect(tile(SHOP.path).className).not.toContain('int-tile-ask');
  });

  it('opens one project on click and goes back to the tiles', async () => {
    await open({ projects: MANY });
    tile(MANY[3].path).click();
    await vi.waitFor(() => expect($$('.int-project')).toHaveLength(1));
    expect($('.int-project').dataset.project).toBe(MANY[3].path);
    expect($$('.int-tile')).toHaveLength(0);
    expect(buttonNamed(document, msg('integrations.projects.back'))).toBeDefined();
    buttonNamed(document, msg('integrations.projects.back')).click();
    await vi.waitFor(() => expect($$('.int-tile')).toHaveLength(MANY.length));
    expect($$('.int-project')).toHaveLength(0);
    await vi.waitFor(() => expect(document.activeElement).toBe(tile(MANY[3].path)));
  });
});
