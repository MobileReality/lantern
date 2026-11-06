import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';
import type { GraphHarness } from './support/graph-harness';
import { findClippedText } from './support/overflow';

const SETTLE_MS = 600;
const WIDE = '1600x1000';
const LAPTOP = '1280x800';
const SYSTEM_NAMES = ['PostgreSQL', 'Card Gateway', 'Email Provider', 'Object Storage', 'Identity Provider', 'Courier Gateway', 'Search Index'];

const map = (page: Page) => page.locator('.lt-macroview');
const dock = (page: Page) => page.locator('.mv-dock');
const entries = (page: Page) => page.locator('.mv-dock .mv-system');
const entry = (page: Page, name: string) => page.locator('.mv-dock .mv-system', { has: page.locator('.mv-system-name', { hasText: new RegExp(`^${name}$`) }) });
const names = (page: Page) => entries(page).locator('.mv-system-name').allTextContents();
const note = (page: Page) => page.locator('.mv-dock-note');
const detail = (page: Page) => page.locator('.lt-side .lt-detail');
const shape = (page: Page, key: string) => map(page).locator(`[data-key="${key}"]`).first().locator('> .mv-shape, > .mv-lane-shape');

async function settle(page: Page) {
  await page.waitForTimeout(SETTLE_MS);
}

async function open(viewport: string): Promise<GraphHarness> {
  const before = process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = viewport;
  const harness = await launchGraphHarness('macro-lab');
  if (before === undefined) delete process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  else process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = before;
  await loadGraphFixture(harness, 'macro-lab');
  await harness.page.getByRole('button', { name: /^Macro/ }).click();
  await expect(map(harness.page)).toBeVisible();
  await settle(harness.page);
  return harness;
}

async function clickShape(page: Page, key: string) {
  const box = await shape(page, key).boundingBox();
  if (!box) throw new Error(`${key} is not on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 80));
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const main = rect('.lt-main');
    const dockBox = rect('.mv-dock');
    const mapBox = rect('.lt-macroview');
    return { main: main && { top: main.top, bottom: main.bottom, left: main.left, right: main.right }, dock: dockBox && { top: dockBox.top, bottom: dockBox.bottom, left: dockBox.left, right: dockBox.right, height: dockBox.height }, map: mapBox && { top: mapBox.top, bottom: mapBox.bottom, height: mapBox.height } };
  });
}

for (const viewport of [WIDE, LAPTOP]) {
  test.describe(`at ${viewport}`, () => {
    test('lists every outside system with its count at rest, below the map, and draws no line to them', async ({}, testInfo) => {
      const harness = await open(viewport);
      try {
        const { page } = harness;
        await expect(dock(page)).toBeVisible();
        expect(await names(page)).toEqual(SYSTEM_NAMES);
        expect(await entries(page).locator('.mv-system-count').allTextContents()).toEqual(['11', '5', '4', '4', '3', '2', '2']);
        await expect(map(page).locator('.mv-ribbon.is-system, [data-key^="ext:"]')).toHaveCount(0);
        const { dock: below, main, map: above } = await boxes(page);
        expect(below && main && above).toBeTruthy();
        if (!below || !main || !above) return;
        expect(below.top).toBeGreaterThanOrEqual(above.bottom - 1);
        expect(below.bottom).toBeLessThanOrEqual(main.bottom + 1);
        expect(below.left).toBeGreaterThanOrEqual(main.left - 1);
        expect(below.right).toBeLessThanOrEqual(main.right + 1);
        expect(above.height).toBeGreaterThan(main.bottom - main.top - 200);
        expect(await findClippedText(page)).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`systems-rest-${viewport}.png`) });
        expect(harness.errors).toEqual([]);
      } finally {
        await closeGraphHarness(harness);
      }
    });

    test('clicking a block filters the list to what it talks to, Show all lists them again, and Escape clears', async ({}, testInfo) => {
      const harness = await open(viewport);
      try {
        const { page } = harness;
        await clickShape(page, 'block:fulfilment');
        await expect(map(page).locator('[data-key="block:fulfilment"]')).toHaveClass(/is-selected/);
        expect(await names(page)).toEqual(['PostgreSQL', 'Courier Gateway']);
        expect(await entries(page).locator('.mv-system-count').allTextContents()).toEqual(['4', '2']);
        await expect(note(page)).toHaveText('2 of 7 systems talk to Fulfilment');
        await page.screenshot({ path: testInfo.outputPath(`systems-filtered-${viewport}.png`) });

        await page.getByRole('button', { name: 'Show all' }).click();
        expect(await names(page)).toEqual(SYSTEM_NAMES);
        await expect(entry(page, 'PostgreSQL')).toHaveClass(/is-linked/);
        await expect(entry(page, 'Search Index')).not.toHaveClass(/is-linked/);
        await expect(map(page).locator('[data-key="block:fulfilment"]')).toHaveClass(/is-selected/);
        await expect(page.getByRole('button', { name: 'Only those of Fulfilment' })).toHaveAttribute('aria-pressed', 'true');

        await map(page).focus();
        await page.keyboard.press('Escape');
        await expect(map(page).locator('.is-selected')).toHaveCount(0);
        expect(await names(page)).toEqual(SYSTEM_NAMES);
        expect(await findClippedText(page)).toEqual([]);
        expect(harness.errors).toEqual([]);
      } finally {
        await closeGraphHarness(harness);
      }
    });

    test('clicking a system lights every area and foundation entry that talks to it with counts, and the panel lists them; clicking it again clears', async ({}, testInfo) => {
      const harness = await open(viewport);
      try {
        const { page } = harness;
        await entry(page, 'PostgreSQL').click();
        await settle(page);
        await expect(entry(page, 'PostgreSQL')).toHaveAttribute('aria-pressed', 'true');
        await expect(map(page).locator('.mv-area.is-related')).toHaveCount(3);
        await expect(map(page).locator('[data-key="block:ordering"]')).toHaveClass(/is-related/);
        await expect(map(page).locator('[data-key="block:fulfilment"]')).toHaveClass(/is-related/);
        await expect(map(page).locator('[data-key="block:insights"]')).toHaveClass(/is-related/);
        await expect(map(page).locator('[data-key="block:catalog"]')).toHaveClass(/is-dim/);
        await expect(map(page).locator('[data-key="block:ordering"]')).toHaveAttribute('aria-label', /4 relations with PostgreSQL/);
        await expect(map(page).locator('[data-key="block:core:service"]')).toHaveClass(/is-related/);
        await expect(detail(page).locator('.path')).toHaveText('PostgreSQL');
        await expect(detail(page).locator('.role')).toHaveText('outside system · 11 relations');
        await expect(detail(page).locator('.lt-sys-area')).toContainText(['Fulfilment', 'Ordering', 'Insights', 'Shared foundation']);
        await expect(detail(page).locator('[data-macro-feature="stock-levels"]')).toBeVisible();
        expect(await names(page)).toEqual(SYSTEM_NAMES);
        expect(await findClippedText(page)).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`systems-selected-${viewport}.png`) });

        await entry(page, 'PostgreSQL').click();
        await expect(map(page).locator('.is-related, .is-dim')).toHaveCount(0);
        await expect(detail(page)).toHaveCount(0);
        expect(harness.errors).toEqual([]);
      } finally {
        await closeGraphHarness(harness);
      }
    });

    test('picking an entry in the panel selects the feature in its area, and Escape on the list clears a system', async ({}, testInfo) => {
      const harness = await open(viewport);
      try {
        const { page } = harness;
        await entry(page, 'PostgreSQL').click();
        await detail(page).locator('[data-macro-feature="stock-levels"]').click();
        await settle(page);
        await expect(page.locator('.lt-graph-crumbs .lt-crumbs')).toContainText('Fulfilment');
        await expect(map(page).locator('[data-key="block:stock-levels"]')).toHaveClass(/is-selected/);
        expect(await names(page)).toEqual(['PostgreSQL']);
        await page.screenshot({ path: testInfo.outputPath(`systems-feature-${viewport}.png`) });

        await page.getByRole('button', { name: 'Show all' }).click();
        await entry(page, 'Card Gateway').focus();
        await page.keyboard.press('Enter');
        await expect(entry(page, 'Card Gateway')).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Escape');
        await expect(entry(page, 'Card Gateway')).toHaveAttribute('aria-pressed', 'false');
        await expect(detail(page)).toHaveCount(0);
        expect(harness.errors).toEqual([]);
      } finally {
        await closeGraphHarness(harness);
      }
    });
  });
}

test('the list is reachable with the keyboard and announces itself', async () => {
  const harness = await open(LAPTOP);
  try {
    const { page } = harness;
    await expect(dock(page)).toHaveAttribute('aria-label', 'Outside systems');
    await entry(page, 'PostgreSQL').focus();
    await page.keyboard.press('ArrowRight');
    await expect(entry(page, 'Card Gateway')).toBeFocused();
    await page.keyboard.press('End');
    await expect(entry(page, 'Search Index')).toBeFocused();
    await expect(entry(page, 'PostgreSQL')).toHaveAttribute('aria-label', /^PostgreSQL, outside system, 11 relations, used by 7 blocks/);
    await expect(note(page)).toHaveAttribute('role', 'status');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
