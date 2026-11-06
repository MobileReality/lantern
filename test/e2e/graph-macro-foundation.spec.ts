import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

const WIDE = '1600x1000';
const map = (page: Page) => page.locator('.lt-macroview');
const chip = (page: Page, name: string) => page.locator('.lt-side .chip', { hasText: name }).first();
const sentences = (page: Page) => page.locator('.lt-side .lt-detail .lt-sentence');

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
  return harness;
}

test('lists what the infrastructure platform connects to and lights its partners', async ({}, testInfo) => {
  const harness = await open();
  try {
    const { page } = harness;
    await chip(page, 'Infrastructure').click();
    await settle(page);
    await expect(page.locator('.lt-side .lt-detail')).not.toContainText('No relations to other blocks');
    await expect(sentences(page).filter({ hasText: /^Uses / })).toContainText(['Service (2 relations)']);
    await expect(sentences(page).filter({ hasText: /^Uses / })).toContainText(['Storefront (2 relations)']);
    await expect(map(page).locator('.is-related')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('foundation-infra.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('lights the features where a platform has files', async ({}, testInfo) => {
  const harness = await open();
  try {
    const { page } = harness;
    await chip(page, 'Storefront').click();
    await settle(page);
    await expect(sentences(page).filter({ hasText: /^Files here: / })).toContainText([/Ordering \(31 files\)/]);
    await expect(map(page).locator('.mv-feature.is-related')).toHaveCount(17);
    await page.screenshot({ path: testInfo.outputPath('foundation-storefront.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('shows the platforms of an area in the side panel', async ({}) => {
  const harness = await open();
  try {
    const { page } = harness;
    await chip(page, 'Ordering').click();
    await expect(sentences(page).filter({ hasText: /^Platforms: / })).toContainText(['Storefront']);
    await expect(sentences(page).filter({ hasText: /^Platforms: / })).toContainText(['Service']);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
