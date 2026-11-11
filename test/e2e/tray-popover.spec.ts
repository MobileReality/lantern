import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import path from 'node:path';
import { crowdedGroups, longGroups, manyGroups, model, quietGroups } from '../fixtures/tray-groups';
import { launchTrayHarness } from './support/tray-popover-harness';
import type { TrayHarness } from './support/tray-popover-harness';

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const file = `${name}.png`;
  await page.mouse.move(2, 810);
  await page.screenshot({ path: process.env.LANTERN_TRAY_SHOTS ? path.join(process.env.LANTERN_TRAY_SHOTS, file) : testInfo.outputPath(file) });
}

test.describe.serial('tray popover', () => {
  let h: TrayHarness;

  test.beforeAll(async () => {
    h = await launchTrayHarness();
  });

  test.afterAll(async () => {
    const errors = h.errors;
    await h.close();
    expect(errors).toEqual([]);
  });

  const pop = () => h.frame.locator('#pop');
  const rows = () => h.frame.locator('.group .row');

  async function expectFitsWidth() {
    const overflow = await h.frame.evaluate(() => {
      const root = document.getElementById('pop') as HTMLElement;
      return [...root.querySelectorAll<HTMLElement>('*')].filter((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).textOverflow !== 'ellipsis' && getComputedStyle(node).overflowX === 'visible' && node.clientWidth > 0).map((node) => node.className);
    });
    expect(overflow).toEqual([]);
  }

  test('many projects in every state, most urgent first, notifications on', async ({}, testInfo) => {
    await h.show(model(manyGroups()));
    await expect(h.frame.locator('.pill')).toHaveText('4 need you');
    await expect(h.frame.locator('.group .eyebrow span:first-child')).toHaveText(['Needs you', 'Working', 'Finished', 'Other']);
    await expect(rows().first().locator('.name')).toHaveText('shop-frontend');
    await expect(rows().first().locator('.state')).toHaveText('needs approval');
    await expectFitsWidth();
    await shot(h.page, testInfo, 'many-projects');
  });

  test('a long name and a long path are cut to fit, never pushed out of the window', async ({}, testInfo) => {
    await h.show(model(longGroups()));
    await expect(rows().first().locator('.tail')).toContainText('…');
    expect(await rows().first().locator('.state .label').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false);
    await expectFitsWidth();
    await shot(h.page, testInfo, 'long-path');
  });

  test('nothing needs you', async ({}, testInfo) => {
    await h.show(model(quietGroups()));
    await expect(h.frame.locator('.pill.quiet')).toHaveText('Nothing needs you');
    await shot(h.page, testInfo, 'quiet');
  });

  test('no projects shows an empty state', async ({}, testInfo) => {
    await h.show(model([]));
    await expect(h.frame.locator('.empty-title')).toHaveText('No projects yet');
    await expect(h.frame.getByRole('button', { name: 'Clear finished' })).toHaveCount(0);
    await shot(h.page, testInfo, 'empty');
  });

  test('without notifications the more menu has no test items', async ({}, testInfo) => {
    await h.show(model(manyGroups(), false));
    await h.frame.getByRole('button', { name: 'More' }).click();
    await expect(h.frame.locator('.more .test')).toHaveCount(0);
    await expect(h.frame.getByRole('button', { name: 'Quit Lantern' })).toBeVisible();
    await shot(h.page, testInfo, 'more-notifications-off');
  });

  test('with notifications the more menu lists the test cards and Quit', async ({}, testInfo) => {
    await h.show(model(manyGroups()));
    await h.frame.getByRole('button', { name: 'More' }).click();
    await expect(h.frame.locator('.more .test')).toHaveCount(4);
    await shot(h.page, testInfo, 'more-notifications-on');
  });

  test('arrow keys move, Enter opens, Escape closes', async ({}, testInfo) => {
    await h.show(model(manyGroups()));
    const before = (await h.calls()).length;
    await pop().press('ArrowDown');
    await expect(rows().nth(0)).toBeFocused();
    await pop().press('ArrowDown');
    await expect(rows().nth(1)).toBeFocused();
    await shot(h.page, testInfo, 'keyboard-focus');
    await pop().press('ArrowUp');
    await pop().press('Enter');
    expect((await h.calls()).slice(before)).toEqual([`open:/Users/ada/GIT/clients/acme/shop-frontend`]);
    await pop().press('Escape');
    expect((await h.calls()).at(-1)).toBe('close');
  });

  test('the row under the pointer is the active one', async () => {
    await h.show(model(manyGroups()));
    await rows().nth(2).hover();
    await expect(rows().nth(2)).toHaveClass(/is-active/);
    await expect(rows().nth(2)).toBeFocused();
    await expect(h.frame.locator('#pop')).toHaveAttribute('data-input', 'pointer');
    await h.page.mouse.move(2, 810);
  });

  test('the working spinner stops when the system asks to reduce motion', async () => {
    await h.show(model(manyGroups()));
    const spin = () => h.frame.evaluate(() => getComputedStyle(document.querySelector('.row[data-tone="working"] .mark svg') as Element).animationName);
    expect(await spin()).toBe('spin');
    await h.page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await spin()).toBe('none');
    await h.page.emulateMedia({ reducedMotion: null });
  });

  test('a long list scrolls inside the popover and keeps the footer in view', async ({}, testInfo) => {
    await h.show(model(crowdedGroups()), 520);
    const sizes = await h.frame.evaluate(() => {
      const scroller = document.querySelector('.scroller') as HTMLElement;
      const root = document.getElementById('pop') as HTMLElement;
      return { scrolls: scroller.scrollHeight > scroller.clientHeight, height: root.getBoundingClientRect().height };
    });
    expect(sizes.scrolls).toBe(true);
    expect(sizes.height).toBeLessThanOrEqual(520);
    await expect(h.frame.getByRole('button', { name: 'Open workspace' })).toBeVisible();
    await shot(h.page, testInfo, 'many-scrolling');
  });

  test('a state change while open updates the rows and keeps the keyboard position', async () => {
    await h.show(model(manyGroups()));
    await pop().press('ArrowDown');
    await pop().press('ArrowDown');
    const key = await rows().nth(1).getAttribute('data-key');
    await h.update(model(manyGroups().slice(1)));
    await expect(h.frame.locator('.pill')).toHaveText('3 need you');
    await expect(h.frame.locator(`[data-key="${key}"]`)).toBeFocused();
  });
});
