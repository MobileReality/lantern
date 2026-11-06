import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { macroGraph } from '../../src/renderer/lib/lanternmacro';
import type { MacroView } from '../../src/main/lantern-macro';
import ownView from '../fixtures/lantern-macro-own-view.json';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

const SETTLE_MS = 500;
const LAPTOP = '1280x800';
const PAINTED = ['stroke', 'stroke-width', 'stroke-dasharray', 'fill', 'opacity'];

const map = (page: Page) => page.locator('.lt-macroview');
const legend = (page: Page) => page.locator('.lt-side .legend');
const rows = (page: Page) => legend(page).locator('[data-legend]');
const ids = (page: Page) => rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-legend')));
const shapeOf = (page: Page, key: string) => map(page).locator(`[data-key="${key}"]`).first().locator('> .mv-shape');

async function open() {
  const before = process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = LAPTOP;
  const harness = await launchGraphHarness('macro-lab');
  if (before === undefined) delete process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  else process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = before;
  await loadGraphFixture(harness, 'macro-lab');
  await harness.page.getByRole('button', { name: /^Macro/ }).click();
  await expect(map(harness.page)).toBeVisible();
  await harness.page.waitForTimeout(SETTLE_MS);
  return harness;
}

async function painted(shape: Locator) {
  return shape.evaluate((node, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(node).getPropertyValue(name)])), PAINTED);
}

async function clickShape(page: Page, key: string) {
  const box = await shapeOf(page, key).boundingBox();
  if (!box) throw new Error(`${key} is not on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 80));
  await page.waitForTimeout(SETTLE_MS);
}

test('the areas map legend is short, fits the side panel, and its swatches are painted exactly like the map', async ({}, testInfo) => {
  const harness = await open();
  try {
    const { page } = harness;

    expect(await ids(page)).toEqual(['main', 'lit', 'pending', 'system']);
    await legend(page).scrollIntoViewIfNeeded();
    await legend(page).screenshot({ path: testInfo.outputPath('legend-rest.png') });

    await clickShape(page, 'block:ordering');
    expect(await ids(page)).toEqual(['main', 'selected', 'related', 'hot', 'dim', 'lit', 'pending', 'system']);
    await expect(shapeOf(page, 'block:ordering')).toBeVisible();
    for (const [id, key] of [['selected', 'block:ordering'], ['related', 'block:payments'], ['lit', 'block:ordering']] as const) {
      await expect(map(page).locator(`[data-key="${key}"]`).first(), `${id} on ${key}`).toHaveClass(new RegExp(`is-${id}`));
    }
    const key = (id: string) => legend(page).locator(`[data-legend="${id}"] .mv-shape`);
    const pending = await painted(key('pending'));
    expect(pending['stroke-dasharray']).not.toBe('none');
    for (const id of ['selected', 'related', 'dim', 'lit']) expect((await painted(key(id)))['stroke-dasharray'], id).toBe('none');
    const selected = await painted(key('selected'));
    const own = await painted(shapeOf(page, 'block:ordering'));
    expect(selected.stroke).toBe(own.stroke);
    await legend(page).scrollIntoViewIfNeeded();
    await legend(page).screenshot({ path: testInfo.outputPath('legend-selected.png') });
    await page.screenshot({ path: testInfo.outputPath('legend-page-selected.png') });

    const side = (await page.locator('.lt-side').boundingBox())!;
    for (const row of await rows(page).all()) {
      const box = (await row.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width);
      expect(await row.locator('.legend-text').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('with a platform selected the uses style is in the legend, drawn like the places it lights', async ({}, testInfo) => {
  const harness = await open();
  try {
    const { page } = harness;
    await page.locator('.lt-side .chip', { hasText: 'Help bot' }).first().click();
    await page.waitForTimeout(SETTLE_MS);

    expect(await ids(page)).toContain('uses');
    const key = legend(page).locator('[data-legend="uses"] .mv-shape');
    const place = shapeOf(page, 'block:accounts');
    await expect(map(page).locator('[data-key="block:accounts"]').first()).toHaveClass(/is-uses/);
    const [swatch, drawn] = [await painted(key), await painted(place)];
    expect(swatch['stroke-dasharray']).toBe('none');
    expect(drawn['stroke-dasharray']).toBe('none');
    expect(swatch.stroke).toBe(drawn.stroke);
    expect(swatch['stroke-width']).toBe(drawn['stroke-width']);
    await legend(page).scrollIntoViewIfNeeded();
    await legend(page).screenshot({ path: testInfo.outputPath('legend-uses.png') });
    await page.screenshot({ path: testInfo.outputPath('legend-page-uses.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('the legend of the flat Macro view shows the links it draws and two lines of help', async ({}, testInfo) => {
  const graph = macroGraph(ownView as MacroView);
  const harness = await launchGraphHarness('large');
  try {
    const { page } = harness;
    await loadGraphFixture(harness, 'large', undefined, '', { macro: '1' });
    await page.getByRole('button', { name: /^Macro/ }).click();
    await expect(page.locator('.lt-pixi-node-access')).toHaveCount(graph.blocks.length);

    expect(await ids(page)).toEqual(['strong', 'weak']);
    await expect(legend(page)).toContainText(/Strong link, \d+\+ relations/);
    await expect(legend(page).locator(':scope > p')).toHaveCount(2);
    await legend(page).scrollIntoViewIfNeeded();
    await legend(page).screenshot({ path: testInfo.outputPath('legend-flat.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
