import { expect, test } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

let harness: GraphHarness;

test.beforeAll(async () => {
  harness = await launchGraphHarness('pr-review');
  await loadGraphFixture(harness, 'pr-review', undefined, '', { explain: '1' });
});

test.afterAll(async () => {
  const errors = harness.errors;
  try {
    await closeGraphHarness(harness);
  } finally {
    expect(errors).toEqual([]);
  }
});

test('collapsing the Explain panel gives the file view its height back', async () => {
  const page = harness.page;
  const toggle = page.locator('.lt-explain-toggle');
  await expect(page.locator('.lt-explain-sec')).toHaveCount(4);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const view = page.locator('.lt-review-body');
  const open = (await view.boundingBox())!.height;

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.lt-explain-body')).toBeHidden();
  await expect(page.locator('.lt-explain-state')).toHaveText('Ready');
  expect((await view.boundingBox())!.height).toBeGreaterThan(open + 40);

  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect((await view.boundingBox())!.height).toBeCloseTo(open, 0);
});
