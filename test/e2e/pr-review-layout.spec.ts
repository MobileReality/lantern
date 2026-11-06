import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness } from './support/graph-harness';

const LAPTOP_VIEWPORT = '1100x760';
const MIN = { left: 240, middle: 280, right: 300 };
let harness: GraphHarness;

test.beforeAll(async () => {
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = LAPTOP_VIEWPORT;
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

async function widths(page: Page) {
  return page.evaluate(() => {
    const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    return { left: width('.lt-side'), middle: width('.lt-review'), right: width('.lt-main'), page: document.documentElement.scrollWidth, window: document.documentElement.clientWidth, grid: (document.querySelector('.lt-grid') as HTMLElement).scrollWidth };
  });
}

test('keeps list, file and graph inside a laptop window, and the dividers move with the keyboard', async ({}, testInfo) => {
  const page = harness.page;
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('order-summary.tsx');

  const start = await widths(page);
  expect(start.page).toBeLessThanOrEqual(start.window);
  expect(start.grid).toBeLessThanOrEqual(start.window);
  expect(start.left).toBeGreaterThanOrEqual(MIN.left);
  expect(start.middle).toBeGreaterThanOrEqual(MIN.middle);
  expect(start.right).toBeGreaterThanOrEqual(MIN.right);
  await page.screenshot({ path: testInfo.outputPath('laptop-three-panes.png') });

  const first = page.locator('.lt-split').first();
  await first.focus();
  await page.keyboard.press('End');
  const wide = await widths(page);
  expect(wide.left).toBeGreaterThan(start.left);
  expect(wide.right).toBeGreaterThanOrEqual(MIN.right - 1);
  expect(wide.middle).toBeGreaterThanOrEqual(MIN.middle - 1);
  expect(wide.page).toBeLessThanOrEqual(wide.window);

  await page.keyboard.press('Home');
  expect((await widths(page)).left).toBeCloseTo(MIN.left, 0);

  const second = page.locator('.lt-split').nth(1);
  await second.focus();
  await page.keyboard.press('End');
  const tall = await widths(page);
  expect(tall.right).toBeGreaterThanOrEqual(MIN.right - 1);
  expect(tall.page).toBeLessThanOrEqual(tall.window);

  const box = await second.boundingBox();
  if (!box) throw new Error('the second divider is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 200, { steps: 4 });
  await page.mouse.up();
  const dragged = await widths(page);
  expect(dragged.middle).toBeLessThan(tall.middle);
  expect(dragged.middle).toBeGreaterThanOrEqual(MIN.middle - 1);
  await page.screenshot({ path: testInfo.outputPath('laptop-after-resize.png') });
});
