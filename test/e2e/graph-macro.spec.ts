import { expect, test } from '@playwright/test';
import type { MacroView } from '../../src/main/lantern-macro';
import { macroGraph } from '../../src/renderer/lib/lanternmacro';
import ownView from '../fixtures/lantern-macro-own-view.json';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

const graph = macroGraph(ownView as MacroView);
const BLOCKS = ownView.blocks.length;
const FEATURES = graph.blocks.filter((block) => block.kind === 'feature').length;
const MAIN_LINES = graph.edges.filter((edge) => edge.main);
const STRONG = MAIN_LINES.filter((edge) => edge.strong).length;

test('draws the macro view in the real canvas and goes back to the file graph', async ({}, testInfo) => {
  const harness = await launchGraphHarness('large');
  try {
    const { page } = harness;
    await loadGraphFixture(harness, 'large', undefined, '', { macro: '1' });
    await expect(page.getByRole('button', { name: /^Macro/ })).toBeVisible();

    await page.getByRole('button', { name: /^Macro/ }).click();
    await expect(page.locator('.lt-pixi-edge-access')).toHaveCount(MAIN_LINES.length);
    await expect(page.locator('.lt-pixi-node-access')).toHaveCount(BLOCKS);
    await expect(page.locator('.lt-pixi-edge-access[data-strong="true"]')).toHaveCount(STRONG);
    await expect(page.locator('.lt-side .stats')).toContainText(`${FEATURES}feature blocks`);
    await expect(page.locator('.lt-side .stats')).toContainText('main links, of');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: testInfo.outputPath('macro-overview.png') });

    const hub = page.getByRole('button', { name: 'Desktop shell, 40 files', exact: true });
    const canvasBox = await page.locator('canvas.lt-pixi-canvas').boundingBox();
    if (!canvasBox) throw new Error('Pixi canvas is not visible');
    const position = await hub.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }));
    const scroll = await page.locator('.lt-main').evaluate((element, top) => {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
      return { left: element.scrollLeft, top: element.scrollTop };
    }, position.y);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.click(canvasBox.x + position.x - scroll.left + position.width / 2, canvasBox.y + position.y - scroll.top + 8);
    await expect(hub).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lt-side .lt-detail')).toContainText('Desktop shell');
    await expect(page.locator('.lt-side .lt-detail')).toContainText('not a feature');
    await page.screenshot({ path: testInfo.outputPath('macro-selected.png') });

    await page.keyboard.press('Escape');
    await expect(hub).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: /^Files/ }).click();
    await expect(page.locator('.lt-pixi-edge-access')).toHaveCount(0);
    await expect(page.locator('.lt-viewbar [data-view="files"]')).toHaveAttribute('aria-pressed', 'true');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
