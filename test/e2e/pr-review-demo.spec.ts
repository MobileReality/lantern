import { expect, test } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness } from './support/graph-harness';

let harness: GraphHarness;

test.beforeAll(async () => {
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = '1440x900';
  harness = await launchGraphHarness('pr-review');
});

test.afterAll(async () => {
  delete process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  const errors = harness.errors;
  try {
    await closeGraphHarness(harness);
  } finally {
    expect(errors).toEqual([]);
  }
});

test('walks the synthetic review through production graph, diff, and code views', async ({}, testInfo) => {
  const page = harness.page;
  await expect(page).toHaveTitle('Lantern — PR review demo');
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('order-summary.tsx');
  await expect(page.locator('.lt-review .cl.add')).toContainText(['return new Intl.NumberFormat']);
  await expect(page.locator('.lt-review .cl.del').first()).toContainText('toFixed(2)');
  await page.screenshot({ path: testInfo.outputPath('order-summary-diff.png') });
  await expect(page.locator('.pr-review')).toContainText('Changed files');
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(5);
  await expect(page.locator('.pr-num, .pr-file .diff-open, .pr-file .code-open')).toHaveCount(0);
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toContainText('calculate-order-total.ts');

  await page.locator('[data-pr-go="src/checkout/use-checkout.ts"]').click();
  await page.locator('.lt-review [data-review-mode="diff"]').click();
  await expect(page.locator('.lt-review .lt-step-count')).toHaveText('1 / 5');
  await expect(page.locator('.lt-review')).toContainText('calculateOrderTotal');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('calculate-order-total.ts');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('legacy-total.ts');
  await expect(page.locator('.lt-review')).toContainText('legacyTotal');
  await expect(page.locator('.pr-file.sel')).toContainText('legacy-total.ts');

  await page.locator('[data-pr-go="src/pricing/legacy-total.ts"]').click();
  await page.locator('.lt-review [data-review-mode="file"]').click();
  await expect(page.locator('.lt-review .lt-code-note')).toHaveText('version before PR #317');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('calculate-order-total.ts');
  await page.screenshot({ path: testInfo.outputPath('calculate-order-total-file.png') });

  await page.locator('[data-pr-go="src/pricing/calculate-order-total.ts"]').click();
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('calculate-order-total.ts');
  await page.locator('[data-pr-back]').click();
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toHaveCount(0);
  await expect(page.locator('.lt-review')).toHaveCount(0);
  await page.locator('.pr-chip[data-pr="317"]').click();
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toHaveCount(1);
});
