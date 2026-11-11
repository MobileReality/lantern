import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

const LAPTOP_VIEWPORT = '1280x800';
const SLACK_PX = 3;
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

async function open(project: string) {
  await loadGraphFixture(harness, 'areas-pr', undefined, '', { macro: 'areas', project });
  await harness.page.locator('.lt-review').waitFor();
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const grid = document.querySelector('.lt-grid') as HTMLElement;
    const taken = [...grid.children]
      .filter((child) => {
        const style = getComputedStyle(child);
        return style.display !== 'none' && style.position !== 'absolute';
      })
      .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
    return { left: width('.lt-side'), viewer: width('.lt-review'), graph: width('.lt-main'), grid: grid.clientWidth, taken, page: document.documentElement.scrollWidth, window: document.documentElement.clientWidth, gridScroll: grid.scrollWidth };
  });
}

async function expectFitsAndFills(page: Page) {
  const now = await layout(page);
  expect(now.page).toBeLessThanOrEqual(now.window);
  expect(now.gridScroll).toBeLessThanOrEqual(now.window);
  expect(Math.abs(now.taken - now.grid)).toBeLessThanOrEqual(SLACK_PX);
  return now;
}

const collapse = (page: Page, name: RegExp) => page.getByRole('button', { name });
const showMacro = async (page: Page) => {
  await page.getByRole('button', { name: /^Macro/ }).click();
  await expect(page.locator('.lt-main .lt-region-pill')).toBeVisible();
};

test('hides and restores each area at laptop width and gives the freed space to the rest', async ({}, testInfo) => {
  const page = harness.page;
  await open('/e2e/alpha');
  await showMacro(page);
  await page.waitForTimeout(300);

  const all = await expectFitsAndFills(page);
  expect(all.left).toBeGreaterThan(0);
  expect(all.viewer).toBeGreaterThan(0);
  expect(all.graph).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('all-four-visible.png') });

  await page.keyboard.press('Alt+1');
  await page.getByRole('button', { name: 'Hide shared foundation' }).click();
  await page.waitForTimeout(300);
  const noLeft = await expectFitsAndFills(page);
  expect(noLeft.left).toBe(0);
  expect(noLeft.viewer + noLeft.graph).toBeGreaterThan(all.viewer + all.graph + all.left - 40);
  expect(noLeft.graph).toBeGreaterThan(all.graph);
  await expect(page.getByRole('button', { name: 'Show the left column' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show shared foundation' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('left-and-foundation-hidden.png') });

  await page.keyboard.press('Alt+0');
  await page.waitForTimeout(300);
  const back = await expectFitsAndFills(page);
  expect(Math.abs(back.left - all.left)).toBeLessThanOrEqual(SLACK_PX);
  expect(Math.abs(back.viewer - all.viewer)).toBeLessThanOrEqual(SLACK_PX);

  await collapse(page, /^Hide the file viewer$/).click();
  await page.waitForTimeout(300);
  const noViewer = await expectFitsAndFills(page);
  expect(noViewer.viewer).toBe(0);
  expect(noViewer.graph).toBeGreaterThan(all.graph + all.viewer - 40);
  await expect(page.getByRole('button', { name: 'Show the file viewer' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('viewer-hidden.png') });

  await page.getByRole('button', { name: 'Show the file viewer' }).click();
  await collapse(page, /^Hide the graph$/).click();
  await page.waitForTimeout(300);
  const noGraph = await expectFitsAndFills(page);
  expect(noGraph.graph).toBe(0);
  expect(noGraph.viewer).toBeGreaterThan(all.viewer + all.graph - 40);
  await page.screenshot({ path: testInfo.outputPath('graph-hidden.png') });
  await page.keyboard.press('Alt+0');
});

test('never lets the last of the file viewer and the graph go', async () => {
  const page = harness.page;
  await open('/e2e/beta');
  await page.keyboard.press('Alt+1');
  await page.keyboard.press('Alt+2');
  await page.keyboard.press('Alt+4');

  await expect(page.locator('.lt-main')).toBeVisible();
  await expect(page.locator('.lt-review')).toBeHidden();
  await expect(page.locator('.lt-sr')).toHaveText('The file viewer or the graph has to stay visible.');
  await expectFitsAndFills(page);
  await page.keyboard.press('Alt+0');
});

test('remembers the layout per project and forgets it on reset', async () => {
  const page = harness.page;
  await open('/e2e/gamma');
  await page.keyboard.press('Alt+1');
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeHidden();

  await open('/e2e/gamma');
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeHidden();
  await expectFitsAndFills(page);

  await open('/e2e/delta');
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeVisible();

  await open('/e2e/gamma');
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeVisible();
  await open('/e2e/gamma');
  await expect(page.locator('.lt-side:not(.lt-overview)')).toBeVisible();
});
