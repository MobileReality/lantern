import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

const SETTLE_MS = 700;
const AREAS = ['block:project-map', 'block:pull-request-review', 'block:agent-sessions', 'block:workspace-setup', 'block:to-assign'];
const FOUNDATION = ['block:core:desktop', 'block:core:shared', 'block:core:skills'];
const MAP_FEATURES = ['block:lantern-map', 'block:lantern-sections', 'block:code-insight'];

const map = (page: Page) => page.locator('.lt-macroview');
const item = (page: Page, key: string) => map(page).locator(`[data-key="${key}"]`).first();
const shapeOf = (page: Page, key: string) => item(page, key).locator('> .mv-shape, > .mv-lane-shape');
const keysOf = (page: Page, selector: string) => map(page).locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-key')));
const crumbs = (page: Page) => page.locator('.lt-graph-crumbs .lt-crumbs');

async function settle(page: Page) {
  await page.waitForTimeout(SETTLE_MS);
}

async function centreOf(page: Page, key: string) {
  const box = await shapeOf(page, key).boundingBox();
  if (!box) throw new Error(`${key} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 60) };
}

async function openMacro(fixture: string) {
  const harness = await launchGraphHarness(fixture);
  await loadGraphFixture(harness, fixture, undefined, '', { macro: 'areas' });
  await harness.page.getByRole('button', { name: /^Macro/ }).click();
  await expect(map(harness.page)).toBeVisible();
  await settle(harness.page);
  return harness;
}

async function dive(page: Page, key: string) {
  const at = await centreOf(page, key);
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
}

test('opens on the areas, enters one with a double-click and comes back with Escape', async ({}, testInfo) => {
  const harness = await openMacro('large');
  try {
    const { page } = harness;
    expect((await keysOf(page, '.mv-area')).sort()).toEqual([...AREAS].sort());
    expect((await keysOf(page, '.mv-entry')).sort()).toEqual([...FOUNDATION].sort());
    await expect(page.locator('.lt-viewbar select')).toHaveCount(0);
    await expect(crumbs(page)).toHaveText('Areas');
    await expect(page.locator('.lt-sr')).toHaveText('Areas: 4 areas, and 1 feature to assign. Press Enter on an area to open it.');
    await page.screenshot({ path: testInfo.outputPath('areas-level-0.png') });

    const at = await centreOf(page, 'block:project-map');
    await page.mouse.click(at.x, at.y);
    await expect(item(page, 'block:project-map')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lt-side .lt-detail')).toContainText('mapping a project and reading its code');
    await page.screenshot({ path: testInfo.outputPath('areas-level-0-picked.png') });

    await dive(page, 'block:project-map');
    await expect(crumbs(page)).toContainText('Project map');
    await expect(page.locator('.lt-sr')).toHaveText('Inside Project map: 3 features. Press Escape to go back to the areas.');
    await page.screenshot({ path: testInfo.outputPath('areas-level-1.png') });

    const feature = await centreOf(page, 'block:lantern-map');
    await page.mouse.click(feature.x, feature.y);
    await expect(item(page, 'block:lantern-map')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('areas-level-1-picked.png') });

    await page.keyboard.press('Escape');
    await expect(item(page, 'block:lantern-map')).toHaveAttribute('aria-pressed', 'false');
    await expect(crumbs(page)).toContainText('Project map');
    await page.keyboard.press('Escape');
    await expect(crumbs(page)).toHaveText('Areas');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('goes sideways to another area from the panel, back with Backspace and with the breadcrumb', async () => {
  const harness = await openMacro('large');
  try {
    const { page } = harness;
    await dive(page, 'block:project-map');
    await expect(crumbs(page)).toContainText('Project map');
    expect(await keysOf(page, '.mv-feature')).toEqual(expect.arrayContaining(MAP_FEATURES));

    await page.locator('.lt-side .chip[data-macro-go="block:pull-request-review"]').click();
    await expect(page.locator('.lt-side .lt-detail')).toContainText('relation');
    await page.locator('.lt-side .lt-detail [data-macro-enter]').click();
    await settle(page);
    await expect(crumbs(page)).toContainText('Pull request review');

    await page.keyboard.press('Backspace');
    await expect(crumbs(page)).toHaveText('Areas');
    await settle(page);

    await dive(page, 'block:agent-sessions');
    await expect(crumbs(page)).toContainText('Agent sessions');
    await crumbs(page).getByRole('button', { name: 'Areas' }).click();
    await expect(crumbs(page)).toHaveText('Areas');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('keeps the entered area when the view switches to Files and back', async () => {
  const harness = await openMacro('large');
  try {
    const { page } = harness;
    await dive(page, 'block:workspace-setup');
    await expect(crumbs(page)).toContainText('Workspace setup');

    await page.getByRole('button', { name: /^Files/ }).click();
    await expect(page.locator('.lt-graph-crumbs .lt-crumbs')).toHaveCount(0);
    await expect(map(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Macro/ }).click();
    await expect(crumbs(page)).toContainText('Workspace setup');
    await expect(map(page)).toHaveAttribute('data-entered', 'workspace-setup');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('marks the areas a pull request touches and moves the reading marker between areas while stepping', async ({}, testInfo) => {
  const harness = await launchGraphHarness('large');
  try {
    const { page } = harness;
    const lit = map(page).locator('.mv-area.is-lit');
    const reading = map(page).locator('.mv-area.is-reading');
    await loadGraphFixture(harness, 'areas-pr', undefined, '', { macro: 'areas' });
    await page.getByRole('button', { name: /^Macro/ }).click();
    await expect(crumbs(page)).toHaveText('Areas');
    await expect(lit).toHaveCount(3);
    expect(await keysOf(page, '.mv-area.is-lit')).toEqual(expect.arrayContaining(['block:project-map', 'block:pull-request-review', 'block:workspace-setup']));
    await expect(item(page, 'block:agent-sessions')).not.toHaveClass(/is-lit/);
    await expect(item(page, 'block:project-map')).toHaveAttribute('aria-label', /1 of 121 files changed in the pull request/);
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath('areas-level-0-pr.png') });

    await page.locator('.lt-side-list [data-pr-go]').first().click();
    await expect(reading).toHaveCount(1);
    const before = await reading.getAttribute('data-key');
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath('areas-level-0-reading.png') });

    await page.locator('.lt-review .lt-step-next').click();
    await expect(reading).toHaveCount(1);
    expect(await reading.getAttribute('data-key')).not.toBe(before);

    await page.locator('.lt-viewbar [data-prmark]').click();
    await expect(lit).toHaveCount(0);
    await expect(reading).toHaveCount(1);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
