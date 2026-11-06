import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import path from 'node:path';
import { launchIntegrationsHarness } from './support/integrations-harness';
import type { IntegrationsHarness } from './support/integrations-harness';
import { findClippedText } from './support/overflow';
import { FAKE_ATLASSIAN_TOKEN_LONG, fakeAtlassianToken, fakeFineGrainedToken, fakeGithubToken } from '../helpers/fake-tokens';

const VIEWPORTS = ['1280x800', '700x640'];
const DAY_MS = 86_400_000;
const WORK_TOKEN = fakeFineGrainedToken('11AAAAAAA0workworkworkworkworkworkworkwork');
const HOME_TOKEN = fakeFineGrainedToken('11BBBBBBB0homehomehomehomehomehomehomehome');
const CI_TOKEN = fakeGithubToken('ciciciciciciciciciciciciciciciciciciciciCI');
const ATLASSIAN_TOKEN = FAKE_ATLASSIAN_TOKEN_LONG;

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ').concat(' UTC');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function shot(page: Page, testInfo: TestInfo, name: string, viewport: string) {
  const file = `${name}-${viewport}.png`;
  await page.screenshot({ path: process.env.LANTERN_INTEGRATIONS_SHOTS ? path.join(process.env.LANTERN_INTEGRATIONS_SHOTS, file) : testInfo.outputPath(file) });
}

async function expectNothingClipped(page: Page) {
  expect(await findClippedText(page, ['.int-body'])).toEqual([]);
  const sizes = await page.evaluate(() => {
    const body = document.querySelector('.int-body') as HTMLElement;
    const card = document.querySelector('.int-card') as HTMLElement;
    const box = card.getBoundingClientRect();
    return { overflowX: body.scrollWidth - body.clientWidth, left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight };
  });
  expect(sizes.overflowX).toBeLessThanOrEqual(1);
  expect(sizes.left).toBeGreaterThanOrEqual(0);
  expect(sizes.top).toBeGreaterThanOrEqual(0);
  expect(sizes.right).toBeLessThanOrEqual(sizes.width);
  expect(sizes.bottom).toBeLessThanOrEqual(sizes.height);
}

for (const viewport of VIEWPORTS) {
  test.describe.serial(`integrations at ${viewport}`, () => {
    let h: IntegrationsHarness;

    test.beforeAll(async () => {
      h = await launchIntegrationsHarness(
        [
          { name: 'shop', remote: 'git@github.com:acme/shop.git', envFile: 'GITHUB_TOKEN=a-token-that-must-never-be-shown\n' },
          { name: 'ledger', remote: 'https://bitbucket.org/acme/ledger.git' },
          { name: 'scratch', remote: null },
        ],
        viewport,
      );
      h.fake.allow('github', { token: WORK_TOKEN, login: 'octo-work', displayName: 'Octo Work', scopes: [] });
      h.fake.allow('github', { token: HOME_TOKEN, login: 'home-bot', displayName: 'Home Bot' });
      h.fake.allow('github', { token: CI_TOKEN, login: 'ci-bot', displayName: 'CI Bot', expires: utc(Date.now() + 6 * DAY_MS) });
      h.fake.allow('bitbucket', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme', scopes: ['write:pullrequest:bitbucket'] });
      h.fake.allow('jira', { token: ATLASSIAN_TOKEN, email: 'me@acme.test', login: 'meacme', displayName: 'Me Acme' });
    });

    test.afterAll(async () => {
      const errors = h.errors;
      await h.close();
      expect(errors).toEqual([]);
    });

    const dialog = () => h.page.getByRole('dialog', { name: 'Integrations' });
    const section = (name: string) => dialog().locator(`.int-provider[data-provider="${name}"]`);
    const addAccount = (provider: string, name: string) => section(provider).getByRole('button', { name: `Add a ${name} account` });

    async function addGithub(token: string, nickname?: string) {
      await addAccount('github', 'GitHub').click();
      await section('github').getByLabel('Personal access token').fill(token);
      if (nickname) await section('github').getByLabel('Name (optional)').fill(nickname);
      await section('github').getByRole('button', { name: 'Check and save' }).click();
      await expect(section('github').locator('.int-form')).toHaveCount(0);
    }

    test('Integrations opens from its button, empty, with one section per provider', async ({}, testInfo) => {
      const { page } = h;
      await page.getByRole('button', { name: 'Integrations', exact: true }).click();
      await expect(dialog()).toBeVisible();
      await expect(dialog().locator('.int-provider-name')).toHaveText(['GitHub', 'Bitbucket', 'Jira']);
      await expect(section('github')).toContainText('No GitHub accounts yet');
      await expect(dialog().locator('.int-tile')).toHaveCount(3);
      await expect(dialog().locator('.int-project')).toHaveCount(0);
      await expect(dialog()).not.toContainText('.ai/.env');
      await shot(page, testInfo, '2-integrations-empty', viewport);
      await expectNothingClipped(page);
    });

    test('adding an account asks the provider first and stores nothing when it says no', async ({}, testInfo) => {
      const { page } = h;
      await addAccount('jira', 'Jira').click();
      const jira = section('jira');
      await expect(jira.getByLabel('Jira site address')).toBeFocused();
      await expect(jira.locator('.int-help')).toContainText('without scopes');
      await shot(page, testInfo, '3-add-account-form', viewport);
      await jira.getByLabel('Jira site address').fill('https://evil.example.com');
      await jira.getByLabel('Atlassian email').fill('me@acme.test');
      await jira.getByLabel('API token').fill(ATLASSIAN_TOKEN);
      await jira.getByRole('button', { name: 'Check and save' }).click();
      await expect(jira.locator('.int-field-error:not([hidden])')).toContainText('address of your Jira site');
      await jira.getByLabel('Jira site address').fill('acme.atlassian.net');
      await jira.getByLabel('API token').fill(fakeAtlassianToken('not-the-right-token-at-all-0000'));
      await jira.getByRole('button', { name: 'Check and save' }).click();
      await expect(jira.locator('.int-form-failure')).toContainText('Jira rejected this email and token');
      await expect(jira.locator('.int-account')).toHaveCount(0);
      await shot(page, testInfo, '4-add-account-refused', viewport);
      expect(h.fake.requests.filter((request) => request.provider === 'jira')).toHaveLength(1);
      await jira.getByLabel('API token').fill(ATLASSIAN_TOKEN);
      await jira.getByRole('button', { name: 'Check and save' }).click();
      await expect(jira.locator('.int-account')).toHaveCount(1);
      await expect(jira.locator('.int-account-detail .int-detail-part')).toHaveText(['acme.atlassian.net']);
      expect(h.fake.requests.at(-1)?.authorization).toBe(`Basic ${Buffer.from(`me@acme.test:${ATLASSIAN_TOKEN}`).toString('base64')}`);
      await expectNothingClipped(page);
    });

    test('two accounts of one provider sit side by side, and the token is never shown again', async ({}, testInfo) => {
      const { page } = h;
      await addGithub(WORK_TOKEN, 'Work');
      await addGithub(HOME_TOKEN, 'Home');
      const github = section('github');
      await expect(github.locator('.int-nickname')).toHaveText(['Work', 'Home']);
      await expect(github.locator('.int-count')).toHaveText('2 accounts');
      expect(h.fake.requests.filter((request) => request.provider === 'github').map((request) => request.authorization)).toEqual([`Bearer ${WORK_TOKEN}`, `Bearer ${HOME_TOKEN}`]);
      const html = await page.content();
      for (const secret of [WORK_TOKEN, HOME_TOKEN, ATLASSIAN_TOKEN, 'a-token-that-must-never-be-shown']) expect(html).not.toContain(secret);
      await shot(page, testInfo, '5-two-github-accounts', viewport);
      await expectNothingClipped(page);
    });

    const tile = (name: string) => dialog().locator('.int-tile').filter({ hasText: name });
    const detail = () => dialog().locator('.int-project');
    const back = () => dialog().getByRole('button', { name: 'All projects' });

    test('a project suggests its code host from the remote and asks which account to use', async ({}, testInfo) => {
      const { page } = h;
      await tile('shop').scrollIntoViewIfNeeded();
      await expect(tile('shop').locator('.int-tile-state')).toHaveText('Needs attention');
      await shot(page, testInfo, '6-project-tiles', viewport);
      await tile('shop').click();
      await expect(detail()).toHaveCount(1);
      await expect(dialog().locator('.int-tile')).toHaveCount(0);
      const shop = detail();
      await expect(shop.locator('.int-project-remote')).toContainText('github.com/acme/shop');
      const slot = shop.locator('.int-slot[data-provider="github"]');
      await expect(slot.locator('.int-slot-note')).toHaveText('Choose a GitHub account for this project');
      await expect(dialog()).not.toContainText('.ai/.env');
      await expect(shop.locator('.int-slot-env')).toHaveCount(0);
      await shot(page, testInfo, '7-project-detail-choose-account', viewport);
      await slot.getByRole('combobox').selectOption({ label: 'Home – home-bot' });
      await expect(slot.locator('.int-slot-note')).toHaveText('Chosen for this project');
      await expect(slot.getByRole('button', { name: 'Unlink' })).toBeVisible();
      await expect(slot.locator('.int-slot-run')).toContainText('Runs started from Lantern use this account');
      await slot.getByRole('button', { name: 'Unlink' }).click();
      await expect(slot.locator('.int-slot-note')).toHaveText('Choose a GitHub account for this project');
      await slot.getByRole('combobox').selectOption({ label: 'Work – octo-work' });
      await expect(slot.locator('.int-slot-note')).toHaveText('Chosen for this project');
      await expectNothingClipped(page);
      await back().click();
      await expect(tile('shop')).toBeFocused();
      await expect(tile('shop').locator('.int-tile-state')).toHaveText('GitHub and Jira connected');
      await expect(detail()).toHaveCount(0);
      await tile('ledger').click();
      await expect(detail().locator('.int-slot[data-provider="bitbucket"]')).toContainText('Add a Bitbucket account');
      await back().click();
      await tile('scratch').click();
      await expect(detail().locator('.int-project-remote')).toContainText('No GitHub or Bitbucket origin remote found');
      await expect(detail().locator('.int-slot')).toHaveCount(3);
      await shot(page, testInfo, '8-project-detail-no-remote', viewport);
      await expectNothingClipped(page);
      await back().click();
    });

    test('a token about to expire is flagged in its row and on the header chip', async ({}, testInfo) => {
      const { page } = h;
      await addGithub(CI_TOKEN, 'CI');
      await addAccount('bitbucket', 'Bitbucket').click();
      const bitbucket = section('bitbucket');
      await bitbucket.getByLabel('Atlassian email').fill('me@acme.test');
      await bitbucket.getByLabel('API token').fill(ATLASSIAN_TOKEN);
      await bitbucket.getByLabel('Token expires on (optional)').fill(day(Date.now() + 5 * DAY_MS));
      await bitbucket.getByRole('button', { name: 'Check and save' }).click();
      await expect(bitbucket.locator('.int-account')).toHaveCount(1);
      const github = section('github').locator('.int-account').filter({ hasText: 'CI' });
      await expect(github.locator('.int-expiry')).toHaveClass(/int-expiry-soon/);
      await expect(github.locator('.int-expiry')).toContainText(/Expires in [5-7] days/);
      await expect(github.locator('.int-expiry-source')).toHaveText('reported by the provider');
      await expect(bitbucket.locator('.int-expiry')).toHaveClass(/int-expiry-soon/);
      await expect(bitbucket.locator('.int-expiry')).toContainText(/Expires in [4-6] days/);
      await expect(section('github').locator('.int-account').filter({ hasText: 'Work' }).locator('.int-expiry')).toHaveText('No expiry set');
      await expect(async () => github.scrollIntoViewIfNeeded()).toPass();
      await shot(page, testInfo, '9-expiring-token', viewport);
      await expectNothingClipped(page);
      await page.keyboard.press('Escape');
      await expect(dialog()).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Integrations', exact: true })).toBeFocused();
      await expect(page.locator('.lt-int-icon[data-provider="github"]')).toHaveAttribute('data-tip', 'GitHub: Work. Click to change.');
      await expect(page.locator('.lt-int-icon[data-provider="github"]')).not.toHaveClass(/is-missing/);
      await shot(page, testInfo, '10-integration-icons', viewport);
    });

    test('an account can be removed after a second click, and its projects fall back to the question', async ({}) => {
      const { page } = h;
      await page.getByRole('button', { name: 'Integrations', exact: true }).click();
      const work = section('github').locator('.int-account').filter({ hasText: 'Work' });
      const remove = work.getByRole('button', { name: 'Remove' });
      await remove.click();
      await expect(remove).toHaveText('Click again to remove');
      await remove.click();
      await expect(section('github').locator('.int-account')).toHaveCount(2);
      await expect(dialog().locator('.int-announce')).toHaveText('Removed Work.');
      await expect(tile('shop').locator('.int-tile-state')).toHaveText('Needs attention');
      await tile('shop').click();
      await expect(detail().locator('.int-slot[data-provider="github"] .int-slot-note')).toHaveText('Choose a GitHub account for this project');
      await page.keyboard.press('Escape');
    });

    test('a provider icon opens Integrations on that project', async ({}, testInfo) => {
      const { page } = h;
      const icon = page.locator('.lt-int-icon[data-provider="github"]');
      await expect(icon).toHaveClass(/is-missing/);
      await expect(icon).toHaveAttribute('data-tip', 'GitHub: no account chosen. Click to choose an account for this project in Integrations.');
      await icon.click();
      await expect(dialog()).toBeVisible();
      await expect(detail()).toHaveCount(1);
      await expect(detail()).toHaveAttribute('data-project', h.projects[0].path);
      await expect(detail().locator('select').first()).toBeFocused();
      await shot(page, testInfo, '11-icon-opens-the-project', viewport);
      await page.keyboard.press('Escape');
      await expect(icon).toBeFocused();
    });
  });
}

const MANY_PROJECTS = Array.from({ length: 12 }, (_, index) => ({ name: `service-${String(index + 1).padStart(2, '0')}`, remote: index % 2 === 0 ? 'git@github.com:acme/service.git' : null }));

for (const viewport of VIEWPORTS) {
  test.describe.serial(`integrations with many projects at ${viewport}`, () => {
    let h: IntegrationsHarness;

    test.beforeAll(async () => {
      h = await launchIntegrationsHarness(MANY_PROJECTS, viewport);
    });

    test.afterAll(async () => {
      const errors = h.errors;
      await h.close();
      expect(errors).toEqual([]);
    });

    const dialog = () => h.page.getByRole('dialog', { name: 'Integrations' });

    test('twelve projects are twelve tiles, not twelve expanded sections, and the detail opens on click', async ({}, testInfo) => {
      const { page } = h;
      await page.getByRole('button', { name: 'Integrations', exact: true }).click();
      await expect(dialog().locator('.int-tile')).toHaveCount(12);
      await expect(dialog().locator('.int-project')).toHaveCount(0);
      await expect(dialog().locator('.int-tile .int-tile-name').first()).toHaveText('service-01');
      await dialog().locator('.int-tile').last().scrollIntoViewIfNeeded();
      const layout = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll<HTMLElement>('.int-tile')];
        return { rows: new Set(tiles.map((tile) => tile.offsetTop)).size, tile: tiles[0].offsetHeight };
      });
      expect(layout.rows).toBeGreaterThan(1);
      expect(layout.rows).toBeLessThan(12);
      expect(layout.tile).toBeLessThan(90);
      await shot(page, testInfo, '12-twelve-project-tiles', viewport);
      await expectNothingClipped(page);
      await dialog().locator('.int-tile').nth(4).click();
      await expect(dialog().locator('.int-project')).toHaveCount(1);
      await expect(dialog().locator('.int-project-name')).toHaveText('service-05');
      await expect(dialog().locator('.int-tile')).toHaveCount(0);
      await shot(page, testInfo, '13-project-detail-of-many', viewport);
      await expectNothingClipped(page);
      await dialog().getByRole('button', { name: 'All projects' }).click();
      await expect(dialog().locator('.int-tile')).toHaveCount(12);
      await expect(dialog()).not.toContainText('.ai/.env');
    });
  });
}
