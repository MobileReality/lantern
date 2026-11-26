import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

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

const step = (page: Page, index: number) => page.locator(`.lt-guide-step[data-step="${index}"]`);

async function openGuide() {
  await loadGraphFixture(harness, 'pr-review', undefined, '', { guide: 'demo' });
  await expect(harness.page.locator('.lt-guide-view')).toBeVisible();
}

test('opens on the guide with the summary, the risk, a step rail and the steps in order', async () => {
  await openGuide();
  const page = harness.page;
  await expect(page.locator('.lt-viewbar [data-view="guide"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lt-viewbar [data-view="files"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.lt-guide-summary')).toContainText('adds up itemized prices');
  await expect(page.locator('.lt-guide-risk')).toContainText('Medium risk');
  await expect(page.locator('.lt-guide-rail-item')).toHaveCount(5);
  await expect(page.locator('.lt-guide-step .lt-guide-title')).toHaveText(['Add the shared total helper', 'Move checkout onto it', 'Format the amount as currency', 'Show the total and the pay action', 'Cover the helper with a test']);
  await expect(step(page, 0)).toHaveAttribute('data-open', 'true');
  await expect(step(page, 1)).toHaveAttribute('data-open', 'true');
  await expect(step(page, 2)).toHaveAttribute('data-open', 'false');
  await expect(step(page, 2).locator('.lt-guide-step-body')).toBeHidden();
  await expect(step(page, 0).locator('.lt-guide-why')).toContainText('read its contract first');
  await expect(step(page, 0).locator('.cl.add').first()).toContainText('export function calculateOrderTotal');
  await expect(page.locator('.lt-pixi-host')).toBeHidden();
  await expect(page.locator('.lt-review')).toBeHidden();
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(0);
  await expect(page.locator('.lt-side .lt-guide-rail')).toBeVisible();
  const [rail, guide] = await Promise.all([page.locator('.lt-side:not(.lt-overview)').boundingBox(), page.locator('.lt-guide-view').boundingBox()]);
  expect(rail).not.toBeNull();
  expect(guide).not.toBeNull();
  expect(guide?.x).toBeGreaterThan((rail?.x ?? 0) + (rail?.width ?? 0) - 1);
  expect(guide?.width).toBeGreaterThan(700);
});

test('shows only the hunks a step names, a file may sit in several steps', async () => {
  await openGuide();
  const page = harness.page;
  await expect(step(page, 3).locator('.cl.add')).toHaveCount(10);
  await expect(step(page, 3)).toContainText('Continue to payment');
  await expect(step(page, 3)).not.toContainText('Intl.NumberFormat');
  await step(page, 2).locator('.lt-guide-fold').click();
  await expect(step(page, 2)).toHaveAttribute('data-open', 'true');
  await expect(step(page, 2).locator('.cl.add')).toHaveCount(4);
  await expect(step(page, 2)).toContainText('Intl.NumberFormat');
  await expect(step(page, 2)).not.toContainText('Continue to payment');
  await expect(step(page, 1)).toContainText('legacy-total.ts');
  await expect(step(page, 1).locator('.cl.del').first()).toContainText('legacyTotal');
});

test('J and K move the current step, a collapsed skim step expands on click', async () => {
  await openGuide();
  const page = harness.page;
  await expect(step(page, 0)).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('j');
  await expect(step(page, 1)).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 0)).not.toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.lt-guide-rail-item[data-step="1"]')).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(step(page, 3)).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('k');
  await expect(step(page, 2)).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 2)).toBeInViewport();
  await page.locator('.lt-guide-go[data-guide-go="4"]').click();
  await expect(step(page, 4)).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.lt-guide-rail-item[data-step="4"]')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 4)).toBeInViewport();
  await page.locator('.lt-guide-go[data-guide-go="2"]').click();
  await expect(step(page, 2)).toHaveAttribute('data-open', 'false');
  await step(page, 4).locator('.lt-guide-fold').click();
  await expect(step(page, 4)).toHaveAttribute('data-open', 'true');
  await expect(step(page, 4).locator('.cl.add').first()).toContainText("import { calculateOrderTotal }");
  await step(page, 4).locator('.lt-guide-fold').click();
  await expect(step(page, 4)).toHaveAttribute('data-open', 'false');
});

test('the pseudocode toggle shows and hides the pseudocode of a careful step, and the checkboxes tick the rail', async () => {
  await openGuide();
  const page = harness.page;
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeHidden();
  await step(page, 0).locator('.lt-guide-pseudo-toggle').click();
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeVisible();
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toContainText('add up every price in the list');
  await step(page, 0).locator('.lt-guide-pseudo-toggle').click();
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeHidden();
  await expect(step(page, 2).locator('.lt-guide-pseudo-toggle')).toHaveCount(0);
  const check = page.locator('.lt-guide-rail-item[data-step="0"] input');
  await check.check();
  await expect(page.locator('.lt-guide-rail-item[data-step="0"]')).toHaveAttribute('data-done', 'true');
  await expect(step(page, 0)).toHaveAttribute('data-done', 'true');
  await check.uncheck();
  await expect(step(page, 0)).toHaveAttribute('data-done', 'false');
});

test('switching to Files shows the file list and the graph, and back to Guide keeps the steps', async () => {
  await openGuide();
  const page = harness.page;
  await step(page, 0).locator('.lt-guide-pseudo-toggle').click();
  await page.locator('.lt-viewbar [data-view="files"]').click();
  await expect(page.locator('.lt-guide-view')).toBeHidden();
  await expect(page.locator('.lt-viewbar [data-view="files"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pr-review')).toContainText('Changed files');
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(5);
  await expect(page.locator('.lt-side .lt-guide-rail')).toHaveCount(0);
  await expect(page.locator('.lt-review')).toBeVisible();
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toContainText('calculate-order-total.ts');
  await page.locator('.lt-viewbar [data-view="guide"]').click();
  await expect(page.locator('.lt-guide-view')).toBeVisible();
  await expect(page.locator('.lt-review')).toBeHidden();
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(0);
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeVisible();
});

test('hidden areas saved in Files do not break the guide', async () => {
  await loadGraphFixture(harness, 'pr-review');
  const page = harness.page;
  await page.keyboard.press('Alt+1');
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeHidden();
  await openGuide();
  await expect(page.locator('.lt-side .lt-guide-rail')).toBeVisible();
  await expect(page.locator('.lt-guide-view')).toBeVisible();
  await expect(page.locator('[data-rail]')).toHaveCount(0);
  await page.locator('.lt-viewbar [data-view="files"]').click();
  await page.keyboard.press('Alt+0');
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(5);
});

test('a file name inside a step switches to Files with that file open', async () => {
  await openGuide();
  const page = harness.page;
  await step(page, 1).locator('.lt-guide-file-name').first().click();
  await expect(page.locator('.lt-viewbar [data-view="files"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lt-guide-view')).toBeHidden();
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('use-checkout.ts');
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(5);
});

test('a pull request with no guide opens in Files and offers no Guide switch', async () => {
  await loadGraphFixture(harness, 'pr-review');
  const page = harness.page;
  await expect(page.locator('.lt-viewbar [data-view="guide"]')).toHaveCount(0);
  await expect(page.locator('.lt-guide')).toBeHidden();
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(5);
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toContainText('calculate-order-total.ts');
});
