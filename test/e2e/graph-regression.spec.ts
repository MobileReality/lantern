import { expect, test } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

let harness: GraphHarness;

test.beforeAll(async () => { harness = await launchGraphHarness(); });
test.beforeEach(async () => { await loadGraphFixture(harness); });
test.afterAll(async () => {
  const errors = harness.errors;
  try { await closeGraphHarness(harness); } finally { expect(errors).toEqual([]); }
});

test('@visual renders the deterministic Pixi overview', async () => {
  const style = await harness.page.locator('#graph-harness').evaluate((element) => {
    const computed = getComputedStyle(element);
    return { font: computed.fontFamily, glow: computed.getPropertyValue('--lt-glow').trim() };
  });
  expect(style.font).toContain('Overpass');
  expect(style.glow).toBe('#ffb422');
  await expect(harness.page.locator('html')).toHaveAttribute('data-graph-renderer', 'webgl');
  await expect(harness.page).toHaveScreenshot('pixi-overview.png');
});

test('@visual renders selection, directional edges, badges and long Unicode labels', async () => {
  const service = harness.page.getByRole('button', { name: 'src/services/project-service.ts', exact: true });
  await service.evaluate((button: HTMLButtonElement) => button.click());
  await expect(service).toHaveAttribute('aria-pressed', 'true');
  await expect(harness.page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
  await expect(harness.page).toHaveScreenshot('pixi-selected.png');
});

test('uses native pointer and keyboard input for selection and clearing', async () => {
  const page = harness.page;
  const service = page.getByRole('button', { name: 'src/services/project-service.ts', exact: true });
  await service.evaluate((button: HTMLButtonElement) => button.click());
  await expect(service).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.locator('canvas.lt-pixi-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Pixi canvas is not visible');
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(service).toHaveAttribute('aria-pressed', 'false');
  await service.focus();
  await page.keyboard.press('Enter');
  await expect(service).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(service).toHaveAttribute('aria-pressed', 'false');
});

test('wraps long relation filenames inside a narrow detail panel', async () => {
  const page = harness.page;
  const service = page.getByRole('button', { name: 'src/services/project-service.ts', exact: true });
  await service.evaluate((button: HTMLButtonElement) => button.click());
  await expect(service).toHaveAttribute('aria-pressed', 'true');
  const detail = page.locator('.lt-detail');
  await detail.evaluate((element) => { (element as HTMLElement).style.width = '180px'; });
  const label = detail.locator('.file-name').first();
  await label.evaluate((element) => { element.textContent = `${'x'.repeat(80)}.ts`; });

  const dimensions = await detail.evaluate((element) => {
    const button = element.querySelector('li button[data-go]') as HTMLElement;
    return {
      detailClient: element.clientWidth,
      detailScroll: element.scrollWidth,
      buttonClient: button.clientWidth,
      buttonScroll: button.scrollWidth,
    };
  });
  expect(dimensions.detailScroll).toBeLessThanOrEqual(dimensions.detailClient);
  expect(dimensions.buttonScroll).toBeLessThanOrEqual(dimensions.buttonClient);
});

test('applies the real debounced search and keeps the input focused', async () => {
  const search = harness.page.getByPlaceholder('Find a file or purpose');
  await search.fill('repository');
  await expect(harness.page.locator('.lt-pixi-node-access:not([aria-description^="external"])')).toHaveCount(1, { timeout: 1000 });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('repository');
});

test('shows the production empty state', async () => {
  await loadGraphFixture(harness, 'empty');
  await expect(harness.page.locator('.lt-none')).toContainText('No file matches these filters');
  await expect(harness.page.locator('.lt-pixi-node-access')).toHaveCount(0);
});
