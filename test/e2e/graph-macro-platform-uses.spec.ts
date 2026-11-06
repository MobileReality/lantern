import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

const WIDE = '1600x1000';
const map = (page: Page) => page.locator('.lt-macroview');
const chip = (page: Page, name: string) => page.locator('.lt-side .chip', { hasText: name }).first();
const sentences = (page: Page) => page.locator('.lt-side .lt-detail .lt-sentence');
const shape = (page: Page, key: string) => map(page).locator(`[data-key="${key}"]`);

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function open() {
  const before = process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = WIDE;
  const harness = await launchGraphHarness('macro-lab');
  if (before === undefined) delete process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  else process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = before;
  await loadGraphFixture(harness, 'macro-lab');
  await harness.page.getByRole('button', { name: /^Macro/ }).click();
  await expect(map(harness.page)).toBeVisible();
  await harness.page.locator('[data-prmark]').click();
  await expect(harness.page.locator('[data-prmark]')).toHaveAttribute('aria-pressed', 'false');
  return harness;
}

async function pick(page: Page, name: string) {
  await chip(page, name).click();
  await settle(page);
}

test('lists the places a platform has files in apart from the places its files use, for two platforms of one kind', async () => {
  const harness = await open();
  try {
    const { page } = harness;

    await pick(page, 'Order bot');
    await expect(sentences(page).filter({ hasText: /^Files here: / })).toContainText([/Accounts \(2 files\)/]);
    await expect(sentences(page).filter({ hasText: /^Uses, through relations: / })).not.toContainText([/Accounts/]);

    await pick(page, 'Order bot');
    await pick(page, 'Help bot');
    await expect(sentences(page).filter({ hasText: /^Files here: / })).not.toContainText([/Accounts/]);
    await expect(sentences(page).filter({ hasText: /^Uses, through relations: / })).toContainText([/Accounts \(5 relations\)/]);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('lights the accounts area strongly for one bot and as uses for the other, and the legend draws it the same way', async ({}, testInfo) => {
  const harness = await open();
  try {
    const { page } = harness;

    await pick(page, 'Order bot');
    await expect(shape(page, 'block:accounts')).toHaveClass(/is-related/);
    await expect(shape(page, 'block:sign-in')).toHaveClass(/is-related/);
    await page.screenshot({ path: testInfo.outputPath('uses-order-bot.png') });
    await pick(page, 'Order bot');

    await pick(page, 'Help bot');
    await expect(shape(page, 'block:accounts')).toHaveClass(/is-uses/);
    await expect(shape(page, 'block:sign-in')).toHaveClass(/is-uses/);
    await expect(shape(page, 'block:chat-channels')).toHaveClass(/is-related/);
    const outline = shape(page, 'block:accounts').locator('> .mv-shape');
    const key = page.locator('.lt-side .legend [data-legend="uses"] .mv-shape');
    await expect(key).toHaveCount(1);
    await expect(outline).toHaveCSS('stroke-dasharray', 'none');
    await expect(key).toHaveCSS('stroke-dasharray', 'none');
    for (const property of ['stroke', 'stroke-width']) expect(await key.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property)).toBe(await outline.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property));
    await expect(page.locator('.lt-side .legend [data-legend="pending"] .mv-shape')).toHaveCSS('stroke-dasharray', /7/);
    await page.screenshot({ path: testInfo.outputPath('uses-help-bot.png') });
    await page.locator('.lt-side .legend').screenshot({ path: testInfo.outputPath('uses-legend.png') });
    await pick(page, 'Help bot');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('lights nothing as uses at rest, and the legend then shows only what the map draws at rest', async () => {
  const harness = await open();
  try {
    const { page } = harness;
    await expect(page.locator('.lt-macroview .is-uses')).toHaveCount(0);
    await expect(page.locator('.lt-side .legend [data-legend="uses"]')).toHaveCount(0);
    await expect(page.locator('.lt-side .legend [data-legend="selected"]')).toHaveCount(0);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
