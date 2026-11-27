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

const step = (page: Page, index: number) => page.locator(`.lt-side .lt-guide-step[data-step="${index}"]`);
const file = (page: Page, index: number, path: string) => step(page, index).locator(`.lt-guide-file[data-path="${path}"] .lt-guide-file-name`);
const reviewed = (page: Page) => page.locator('.lt-review .lt-code-path');

async function openGuide() {
  await loadGraphFixture(harness, 'pr-review', undefined, '', { guide: 'demo' });
  await expect(harness.page.locator('.lt-side .lt-guide-pane')).toBeAttached();
}

test('has no Guide button, and puts the summary, the risk and the steps in the left pane in place of the file list', async () => {
  await openGuide();
  const page = harness.page;
  await expect(page.locator('.lt-viewbar [data-view="guide"]')).toHaveCount(0);
  await expect(page.locator('.lt-viewbar [data-view="files"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lt-viewbar [data-view="flow"]')).toBeVisible();
  await expect(page.locator('.lt-guide')).toHaveCount(0);
  await expect(page.locator('.lt-side .pr-ordered .pr-file')).toHaveCount(0);
  await expect(page.locator('.lt-guide-summary')).toContainText('adds up itemized prices');
  await expect(page.locator('.lt-guide-risk')).toContainText('Medium risk');
  await expect(page.locator('.lt-side .lt-guide-step .lt-guide-title')).toHaveText(['Add the shared total helper', 'Move checkout onto it', 'Format the amount as currency', 'Show the total and the pay action', 'Cover the helper with a test']);
  await expect(step(page, 0)).toContainText('read its contract first');
  await expect(step(page, 0)).toHaveAttribute('data-open', 'true');
  await expect(step(page, 2)).toHaveAttribute('data-open', 'false');
  await expect(step(page, 2).locator('.lt-guide-why')).toBeHidden();
  await expect(step(page, 2).locator('.lt-guide-file')).toHaveCount(1);
  await expect(step(page, 1).locator('.lt-guide-file')).toHaveCount(2);
});

test('a file in the left pane opens its own diff in the middle, with the step title and why, and the lines the step names marked', async () => {
  await openGuide();
  const page = harness.page;
  await file(page, 3, 'src/checkout/order-summary.tsx').click();
  await expect(reviewed(page)).toHaveCount(1);
  await expect(reviewed(page)).toContainText('order-summary.tsx');
  await expect(page.locator('.lt-review .cl.add').first()).toBeVisible();
  await expect(page.locator('.lt-review .lt-guide-note-title')).toHaveText('Show the total and the pay action');
  await expect(page.locator('.lt-review .lt-guide-note-label')).toContainText('Step 4 of 5');
  await expect(page.locator('.lt-review .lt-guide-note-why')).toContainText('button that stays disabled');
  await expect(step(page, 3).locator('.lt-guide-file[data-current="true"]')).toHaveCount(1);
  await expect(step(page, 2).locator('.lt-guide-file[data-current="true"]')).toHaveCount(0);
  await expect(step(page, 3)).toHaveAttribute('aria-current', 'step');
  const marked = page.locator('.lt-review .cl.guide-hit');
  await expect(marked.first()).toBeVisible();
  await expect(page.locator('.lt-review .cl.guide-hit', { hasText: 'aria-live' })).toHaveCount(1);
  await file(page, 2, 'src/checkout/order-summary.tsx').click();
  await expect(page.locator('.lt-review .lt-guide-note-title')).toHaveText('Format the amount as currency');
  await expect(page.locator('.lt-review .cl.guide-hit', { hasText: 'Intl.NumberFormat' })).toHaveCount(1);
  await expect(page.locator('.lt-review .cl.guide-hit', { hasText: 'aria-live' })).toHaveCount(0);
  await expect(step(page, 2).locator('.lt-guide-file[data-current="true"]')).toHaveCount(1);
  await expect(step(page, 3).locator('.lt-guide-file[data-current="true"]')).toHaveCount(0);
});

test('the arrow keys walk the files in guide order across steps, and the middle diff follows', async () => {
  await openGuide();
  const page = harness.page;
  await file(page, 0, 'src/pricing/calculate-order-total.ts').click();
  await expect(reviewed(page)).toContainText('calculate-order-total.ts');
  await expect(page.locator('.lt-review .lt-step-count')).toHaveText('1 / 6');
  await page.keyboard.press('ArrowRight');
  await expect(reviewed(page)).toContainText('use-checkout.ts');
  await expect(page.locator('.lt-review .lt-guide-note-title')).toHaveText('Move checkout onto it');
  await page.keyboard.press('ArrowRight');
  await expect(reviewed(page)).toContainText('legacy-total.ts');
  await expect(page.locator('.lt-review .cl.del').first()).toContainText('legacyTotal');
  await page.keyboard.press('ArrowRight');
  await expect(reviewed(page)).toContainText('order-summary.tsx');
  await expect(page.locator('.lt-review .lt-guide-note-title')).toHaveText('Format the amount as currency');
  await page.keyboard.press('ArrowRight');
  await expect(reviewed(page)).toContainText('order-summary.tsx');
  await expect(page.locator('.lt-review .lt-guide-note-title')).toHaveText('Show the total and the pay action');
  await expect(step(page, 3).locator('.lt-guide-file[data-current="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(reviewed(page)).toContainText('calculate-order-total.test.ts');
  await expect(step(page, 4).locator('.lt-guide-file[data-current="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.lt-review .lt-guide-note-title')).toHaveText('Show the total and the pay action');
});

test('the pseudocode toggle shows and hides the pseudocode of a careful step, and the ticks stay while files change', async () => {
  await openGuide();
  const page = harness.page;
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeHidden();
  await step(page, 0).locator('.lt-guide-pseudo-toggle').click();
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeVisible();
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toContainText('add up every price in the list');
  await step(page, 0).locator('.lt-guide-pseudo-toggle').click();
  await expect(step(page, 0).locator('.lt-guide-pseudo')).toBeHidden();
  await expect(step(page, 2).locator('.lt-guide-pseudo-toggle')).toHaveCount(0);
  await step(page, 0).locator('.lt-guide-check').check();
  await expect(step(page, 0)).toHaveAttribute('data-done', 'true');
  await file(page, 1, 'src/checkout/use-checkout.ts').click();
  await page.keyboard.press('ArrowRight');
  await expect(step(page, 0)).toHaveAttribute('data-done', 'true');
  await step(page, 2).locator('.lt-guide-fold').click();
  await expect(step(page, 2)).toHaveAttribute('data-open', 'true');
  await expect(step(page, 2).locator('.lt-guide-why')).toBeVisible();
});

test('Flow opens while the guide is shown, keeps the steps in the left pane and a file still opens in the middle', async () => {
  await openGuide();
  const page = harness.page;
  await file(page, 0, 'src/pricing/calculate-order-total.ts').click();
  await page.locator('.lt-viewbar [data-view="flow"]').click();
  await expect(page.locator('.lt-flow')).toBeVisible();
  await expect(page.locator('.lt-viewbar [data-view="flow"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lt-side .lt-guide-pane')).toBeVisible();
  await expect(reviewed(page)).toContainText('calculate-order-total.ts');
  await file(page, 1, 'src/checkout/use-checkout.ts').click();
  await expect(reviewed(page)).toContainText('use-checkout.ts');
  await expect(page.locator('.lt-flow')).toBeVisible();
  await page.locator('.lt-viewbar [data-view="files"]').click();
  await expect(page.locator('.lt-flow')).toBeHidden();
  await expect(page.locator('.lt-side .lt-guide-pane')).toBeVisible();
  await expect(reviewed(page)).toContainText('use-checkout.ts');
});

test('the left pane of the guide hides and comes back with the saved layout like the file list', async () => {
  await loadGraphFixture(harness, 'pr-review');
  const page = harness.page;
  await page.keyboard.press('Alt+1');
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeHidden();
  await openGuide();
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeHidden();
  await page.keyboard.press('Alt+0');
  await expect(page.locator('.lt-side .lt-guide-pane')).toBeVisible();
  await expect(page.locator('.lt-side .lt-guide-step')).toHaveCount(5);
});

test('a pull request with no guide keeps the file list and offers no guide', async () => {
  await loadGraphFixture(harness, 'pr-review');
  const page = harness.page;
  await expect(page.locator('.lt-viewbar [data-view="guide"]')).toHaveCount(0);
  await expect(page.locator('.lt-guide-pane')).toHaveCount(0);
  await expect(page.locator('.pr-ordered .pr-file')).toHaveCount(5);
  await expect(page.locator('.lt-pixi-node-access.pr-new')).toContainText('calculate-order-total.ts');
});
