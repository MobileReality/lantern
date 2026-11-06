import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import path from 'node:path';
import { launchIntegrationsHarness } from './support/integrations-harness';
import type { IntegrationsHarness } from './support/integrations-harness';

const SHOTS = process.env.LANTERN_INTEGRATIONS_SHOTS;
const ACCOUNTS = [1, 2, 3];

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const file = `bindings-${name}.png`;
  await page.screenshot({ path: SHOTS ? path.join(SHOTS, file) : testInfo.outputPath(file) });
}

const token = (kind: string, n: number) => `${kind}-fake-token-${String(n).padStart(2, '0')}-abcdefghijklmnopqrstuvwxyz0123`;

test.describe.serial('choosing the account of each provider for each project', () => {
  let h: IntegrationsHarness;

  test.beforeAll(async () => {
    h = await launchIntegrationsHarness([
      { name: 'shop', remote: 'git@github.com:acme/shop.git' },
      { name: 'ledger', remote: 'https://bitbucket.org/acme/ledger.git' },
      { name: 'fresh', remote: null },
    ]);
    for (const n of ACCOUNTS) {
      h.fake.allow('github', { token: token('gh', n), login: `gh-user-${n}`, displayName: `GitHub User ${n}` });
      h.fake.allow('bitbucket', { token: token('bb', n), email: `bb${n}@acme.test`, login: `bb-user-${n}`, displayName: `Bitbucket User ${n}`, scopes: ['write:pullrequest:bitbucket'] });
      h.fake.allow('jira', { token: token('jr', n), email: `jr${n}@acme.test`, login: `jr-user-${n}`, displayName: `Jira User ${n}` });
    }
  });

  test.afterAll(async () => {
    const errors = h.errors;
    await h.close();
    expect(errors).toEqual([]);
  });

  const dialog = () => h.page.getByRole('dialog', { name: 'Integrations' });
  const tile = (name: string) => dialog().locator('.int-tile').filter({ hasText: name });
  const detail = () => dialog().locator('.int-project');
  const slot = (provider: string) => detail().locator(`.int-slot[data-provider="${provider}"]`);
  const select = (provider: string) => slot(provider).getByRole('combobox');
  const note = (provider: string) => slot(provider).locator('.int-slot-note');
  const back = () => dialog().getByRole('button', { name: 'All projects' });
  const chip = (provider: string) => h.page.locator(`.lt-int-icon[data-provider="${provider}"]`);

  async function open(project: string) {
    if ((await detail().count()) > 0) await back().click();
    await tile(project).click();
    await expect(detail().locator('.int-project-name')).toHaveText(project);
  }

  async function inView(selector: string) {
    return h.page.evaluate((query) => {
      const box = document.querySelector(query)?.getBoundingClientRect();
      const body = document.querySelector('.int-body')?.getBoundingClientRect();
      return !!box && !!body && box.top >= body.top && box.bottom <= body.bottom;
    }, selector);
  }

  test('three accounts of each provider are added', async ({}, testInfo) => {
    const { page } = h;
    for (const n of ACCOUNTS) {
      const added = await page.evaluate(
        async ([gh, bb, jr, i]) => [
          await window.ccmws.authAddToken({ provider: 'github', token: gh, nickname: `GH ${i}` }),
          await window.ccmws.authAddToken({ provider: 'bitbucket', token: bb, email: `bb${i}@acme.test`, nickname: `BB ${i}` }),
          await window.ccmws.authAddToken({ provider: 'jira', token: jr, email: `jr${i}@acme.test`, site: `site${i}.atlassian.net`, nickname: `JR ${i}` }),
        ],
        [token('gh', n), token('bb', n), token('jr', n), n] as const,
      );
      expect(added.map((reply) => reply.ok)).toEqual([true, true, true]);
    }
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await expect(dialog()).toBeVisible();
    await expect(dialog().locator('.int-count')).toHaveText(['3 accounts', '3 accounts', '3 accounts']);
    await shot(page, testInfo, '1-three-accounts-each');
  });

  test('a button next to the accounts jumps to the projects, which sit below them', async ({}, testInfo) => {
    const { page } = h;
    expect(await inView('.int-tile')).toBe(false);
    const jump = dialog().getByRole('button', { name: 'Choose accounts per project' });
    await expect(jump).toBeVisible();
    await jump.click();
    await expect(tile('shop')).toBeFocused();
    expect(await inView('.int-tile')).toBe(true);
    await shot(page, testInfo, '2-jump-to-projects');
  });

  test('a project lists every account of its providers and each choice can be changed while pinned', async ({}, testInfo) => {
    const { page } = h;
    await open('shop');
    await expect(note('github')).toHaveText('Choose a GitHub account for this project');
    await shot(page, testInfo, '3-shop-asks');
    for (const [provider, prefix] of [['github', 'GH'], ['jira', 'JR']] as const) {
      await expect(select(provider).locator('option')).toHaveCount(4);
      await select(provider).selectOption({ index: 2 });
      await expect(note(provider)).toHaveText('Chosen for this project');
      await expect(select(provider).locator('option:checked')).toContainText(`${prefix} 2`);
      await select(provider).selectOption({ index: 2 });
      await expect(select(provider).locator('option:checked')).toContainText(`${prefix} 3`);
      await select(provider).selectOption({ index: 0 });
      await expect(select(provider).locator('option:checked')).toContainText(`${prefix} 1`);
      await expect(note(provider)).toHaveText('Chosen for this project');
      await expect(slot(provider).locator('.int-slot-run')).toContainText('Runs started from Lantern use this account');
    }
    await expect(chip('github')).toHaveAttribute('data-tip', 'GitHub: GH 1. Click to change.');
    await expect(chip('jira')).toHaveAttribute('data-tip', 'Jira: JR 1. Click to change.');
    await shot(page, testInfo, '4-shop-pinned');
  });

  test('another project keeps its own choice, and a choice can be cleared back to the question', async ({}, testInfo) => {
    const { page } = h;
    await open('ledger');
    await expect(select('bitbucket').locator('option')).toHaveCount(4);
    await expect(note('bitbucket')).toHaveText('Choose a Bitbucket account for this project');
    await expect(note('jira')).toHaveText('Choose a Jira account for this project');
    await select('bitbucket').selectOption({ index: 3 });
    await select('jira').selectOption({ index: 3 });
    await expect(select('bitbucket').locator('option:checked')).toContainText('BB 3');
    await expect(select('jira').locator('option:checked')).toContainText('JR 3');
    await shot(page, testInfo, '5-ledger-pinned');
    await open('shop');
    await expect(select('jira').locator('option:checked')).toContainText('JR 1');
    await slot('jira').getByRole('button', { name: 'Unlink' }).click();
    await expect(note('jira')).toHaveText('Choose a Jira account for this project');
    await open('ledger');
    await expect(select('jira').locator('option:checked')).toContainText('JR 3');
  });

  test('a brand-new project without an origin remote lists all three providers and takes the accounts already added', async ({}, testInfo) => {
    const { page } = h;
    await open('fresh');
    await expect(detail().locator('.int-project-remote')).toContainText('No GitHub or Bitbucket origin remote found');
    expect(await detail().locator('.int-slot').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.provider))).toEqual(['github', 'bitbucket', 'jira']);
    await expect(detail().locator('.int-slot-hint')).toHaveCount(0);
    for (const provider of ['github', 'bitbucket', 'jira']) await expect(select(provider).locator('option')).toHaveCount(4);
    await expect(note('github')).toHaveText('This project does not use GitHub yet. Choose an account to use it here.');
    await expect(note('bitbucket')).toHaveText('This project does not use Bitbucket yet. Choose an account to use it here.');
    await expect(note('jira')).toHaveText('Choose a Jira account for this project');
    await shot(page, testInfo, '6-fresh-three-slots');
    await select('github').selectOption({ index: 1 });
    await select('bitbucket').selectOption({ index: 3 });
    await select('jira').selectOption({ index: 2 });
    for (const provider of ['github', 'bitbucket', 'jira']) await expect(note(provider)).toHaveText('Chosen for this project');
    await expect(select('github').locator('option:checked')).toContainText('GH 1');
    await expect(select('bitbucket').locator('option:checked')).toContainText('BB 3');
    await expect(select('jira').locator('option:checked')).toContainText('JR 2');
    await expect(slot('bitbucket').locator('.int-slot-run')).toContainText('Runs started from Lantern use this account');
    await expect(detail().locator('.int-slot-warn')).toHaveCount(0);
    await shot(page, testInfo, '7-fresh-accounts-chosen');
  });

  test('a GitHub project can also choose a Bitbucket account, and the remote stays the suggestion', async ({}, testInfo) => {
    const { page } = h;
    await open('shop');
    await expect(slot('github').locator('.int-slot-hint')).toHaveText('Suggested: GitHub, from the origin remote');
    await expect(slot('bitbucket').locator('.int-slot-hint')).toHaveCount(0);
    await expect(note('bitbucket')).toHaveText('This project does not use Bitbucket yet. Choose an account to use it here.');
    await select('bitbucket').selectOption({ index: 2 });
    await expect(note('bitbucket')).toHaveText('Chosen for this project');
    await expect(select('bitbucket').locator('option:checked')).toContainText('BB 2');
    await shot(page, testInfo, '8-shop-pins-a-bitbucket-account');
    await slot('bitbucket').getByRole('button', { name: 'Unlink' }).click();
    await expect(note('bitbucket')).toHaveText('This project does not use Bitbucket yet. Choose an account to use it here.');
  });

  test('the choices are still there when the dialog is opened again', async ({}) => {
    const { page } = h;
    await page.keyboard.press('Escape');
    await expect(dialog()).toHaveCount(0);
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await tile('shop').click();
    await expect(select('github').locator('option:checked')).toContainText('GH 1');
    await expect(note('jira')).toHaveText('Choose a Jira account for this project');
    await back().click();
    await tile('ledger').click();
    await expect(select('bitbucket').locator('option:checked')).toContainText('BB 3');
  });
});

test.describe.serial('a chosen account that the environment shadows', () => {
  let h: IntegrationsHarness;

  test.beforeAll(async () => {
    h = await launchIntegrationsHarness([{ name: 'fresh', remote: null }], '1280x800', { LANTERN_HARNESS_ENV: JSON.stringify({ GITHUB_TOKEN: token('env', 1) }) });
    h.fake.allow('github', { token: token('gh', 1), login: 'gh-user-1', displayName: 'GitHub User 1' });
  });

  test.afterAll(async () => {
    const errors = h.errors;
    await h.close();
    expect(errors).toEqual([]);
  });

  test('says so in a visible warning on the slot, without showing the value', async ({}, testInfo) => {
    const { page } = h;
    const added = await page.evaluate(async (value) => window.ccmws.authAddToken({ provider: 'github', token: value, nickname: 'GH 1' }), token('gh', 1));
    expect(added.ok).toBe(true);
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Integrations' });
    await dialog.locator('.int-tile').filter({ hasText: 'fresh' }).click();
    const slot = dialog.locator('.int-slot[data-provider="github"]');
    await slot.getByRole('combobox').selectOption({ index: 1 });
    await expect(slot.locator('.int-slot-note')).toHaveText('Chosen for this project');
    await expect(slot.locator('.int-slot-warn')).toContainText('The chosen account is not used');
    await expect(slot.locator('.int-slot-env')).toContainText('GITHUB_TOKEN');
    await expect(dialog).not.toContainText(token('env', 1));
    await shot(page, testInfo, '9-fresh-shadowed-by-environment');
  });
});
