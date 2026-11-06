import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';
import type { GraphHarness } from './support/graph-harness';

const SETTLE_MS = 700;
const WIDE = '1600x1000';
const LAPTOP = '1280x800';
const CHANGED_FILE = 'api/checkout/checkout.service.ts';
const UNCHANGED_FILE = 'api/checkout/checkout.events.ts';
const LAB_AREAS = ['catalog', 'ordering', 'payments', 'fulfilment', 'accounts', 'insights', 'to-assign'];

interface OpenOptions {
  fixture?: string;
  viewport?: string;
  extra?: Record<string, string>;
}

const view = (page: Page) => page.locator('.lt-macroview');
const level = (page: Page) => view(page).getAttribute('data-level');
const zoomOf = async (page: Page) => Number(await view(page).getAttribute('data-zoom'));
const crumbs = (page: Page) => page.locator('.lt-graph-crumbs .lt-crumbs');
const shapeOf = (page: Page, key: string) => page.locator(`.lt-macroview [data-key="${key}"]`).first().locator('> .mv-shape, > .mv-lane-shape');

async function settle(page: Page) {
  await page.waitForTimeout(SETTLE_MS);
}

async function openMacroView({ fixture = 'macro-lab', viewport = WIDE, extra = {} }: OpenOptions = {}): Promise<GraphHarness> {
  const before = process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = viewport;
  const harness = await launchGraphHarness(fixture);
  if (before === undefined) delete process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
  else process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = before;
  await loadGraphFixture(harness, fixture, undefined, '', extra);
  await harness.page.getByRole('button', { name: /^Macro/ }).click();
  await expect(view(harness.page)).toBeVisible();
  await settle(harness.page);
  return harness;
}

async function centreOf(page: Page, key: string) {
  const box = await shapeOf(page, key).boundingBox();
  if (!box) throw new Error(`${key} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function wheelAt(page: Page, x: number, y: number, deltaY: number, times = 1) {
  await page.mouse.move(x, y);
  for (let step = 0; step < times; step += 1) await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(60);
}

async function diveInto(page: Page, key: string) {
  const { x, y, box } = await centreOf(page, key);
  await page.mouse.dblclick(x, Math.min(Math.max(y, box.y + 12), box.y + box.height - 12));
  await settle(page);
}

async function diveToCheckout(page: Page) {
  await diveInto(page, 'block:ordering');
  await diveInto(page, 'block:checkout');
  expect(await level(page)).toBe('files');
}

async function areaFrames(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('.lt-macroview') as HTMLElement;
    const frame = root.getBoundingClientRect();
    return [...root.querySelectorAll('.mv-area > .mv-shape')].map((shape) => {
      const box = shape.getBoundingClientRect();
      return { key: shape.parentElement?.getAttribute('data-key') ?? '', inside: box.left >= frame.left - 0.5 && box.top >= frame.top - 0.5 && box.right <= frame.right + 0.5 && box.bottom <= frame.bottom + 0.5, width: box.width, height: box.height };
    });
  });
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('.lt-main') as HTMLElement;
    const root = document.documentElement;
    return { pageX: root.scrollWidth - window.innerWidth, pageY: root.scrollHeight - window.innerHeight, mainX: main.scrollWidth - main.clientWidth, mainY: main.scrollHeight - main.clientHeight, scale: window.visualViewport?.scale ?? 1, scrollX: window.scrollX, scrollY: window.scrollY };
  });
}

const FIXTURES: [string, string, Record<string, string>][] = [
  ['evaluation', 'macro-lab', {}],
  ['small', 'macro-sized', { areas: '4', features: '8' }],
  ['large', 'macro-sized', { areas: '7', features: '24' }],
];

for (const [name, fixture, extra] of FIXTURES) {
  for (const viewport of [WIDE, LAPTOP]) {
    test(`${name} project at ${viewport}: fitted it shows every area inside the view, with no page scroll, and screenshots three zoom levels`, async ({}, testInfo) => {
      const harness = await openMacroView({ fixture, viewport, extra });
      try {
        const { page } = harness;
        const expected = fixture === 'macro-lab' ? LAB_AREAS.length : Number(extra.areas);
        const frames = await areaFrames(page);
        expect(frames).toHaveLength(expected);
        for (const frame of frames) {
          expect(frame.inside, `${frame.key} must be inside the view when fitted`).toBe(true);
          expect(frame.width).toBeGreaterThan(80);
          expect(frame.height).toBeGreaterThan(60);
        }
        expect(await level(page)).toBe('areas');
        expect(await zoomOf(page)).toBe(1);
        const overflow = await pageOverflow(page);
        expect(overflow.pageX).toBeLessThanOrEqual(0);
        expect(overflow.pageY).toBeLessThanOrEqual(0);
        expect(overflow.mainX).toBeLessThanOrEqual(0);
        expect(overflow.mainY).toBeLessThanOrEqual(0);
        await page.screenshot({ path: testInfo.outputPath(`macroview-${name}-${viewport}-1-fit.png`) });

        const firstArea = frames[1].key;
        await diveInto(page, firstArea);
        expect(await level(page)).not.toBe('areas');
        await page.screenshot({ path: testInfo.outputPath(`macroview-${name}-${viewport}-2-area.png`) });

        const feature = await page.locator('.lt-macroview .mv-feature').evaluateAll((nodes, areaKey) => {
          const owner = document.querySelector(`.lt-macroview [data-key="${areaKey}"]`);
          const own = nodes.filter((node) => owner?.contains(node));
          return own[0]?.getAttribute('data-key') ?? null;
        }, firstArea);
        expect(feature).not.toBeNull();
        await diveInto(page, feature as string);
        expect(await level(page)).toBe('files');
        await page.screenshot({ path: testInfo.outputPath(`macroview-${name}-${viewport}-3-feature.png`) });

        const after = await pageOverflow(page);
        expect(after.pageX).toBeLessThanOrEqual(0);
        expect(after.pageY).toBeLessThanOrEqual(0);
        expect(harness.errors).toEqual([]);
      } finally {
        await closeGraphHarness(harness);
      }
    });
  }
}

test('zooming in reveals features, then files with the changed ones marked; zooming out hides them again', async ({}, testInfo) => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    const ordering = await centreOf(page, 'block:ordering');
    expect(await level(page)).toBe('areas');
    await expect(page.locator('.lt-macroview .mv-features').first()).toHaveCSS('display', 'none');
    const seen: Record<string, boolean> = {};
    for (let step = 0; step < 14 && !seen.files; step += 1) {
      await wheelAt(page, ordering.x, ordering.y, -160);
      const now = await level(page);
      seen[now as string] = true;
    }
    expect(seen.features).toBe(true);
    const rows = page.locator('.lt-macroview .mv-file:visible');
    await expect(rows.first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('macroview-wheel-files.png') });
    for (let step = 0; step < 30; step += 1) await wheelAt(page, ordering.x, ordering.y, 160);
    expect(await level(page)).toBe('areas');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('a changed file is marked in its feature at deep zoom, and an unchanged one is not', async ({}, testInfo) => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    await diveToCheckout(page);
    const changed = page.locator(`.lt-macroview .mv-file[data-path="${CHANGED_FILE}"]`);
    const unchanged = page.locator(`.lt-macroview .mv-file[data-path="${UNCHANGED_FILE}"]`);
    await expect(changed).toBeVisible();
    await expect(changed).toHaveClass(/is-changed/);
    await expect(changed.locator('.mv-rowtag')).toHaveText('changed');
    await expect(unchanged).toBeVisible();
    await expect(unchanged).not.toHaveClass(/is-changed/);
    const rowsInOrder = await page.locator('.lt-macroview [data-key="block:checkout"] .mv-file:visible').evaluateAll((rows) => rows.map((row) => row.classList.contains('is-changed')));
    expect(rowsInOrder.slice(0, 4)).toEqual([true, true, true, true]);
    expect(rowsInOrder.slice(4).every((flag) => !flag)).toBe(true);
    await expect(page.locator('.lt-macroview [data-key="block:checkout"] > .mv-tally text')).toHaveText('4 of 20 files');
    await page.screenshot({ path: testInfo.outputPath('macroview-changed-files.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('a lit area at the fitted zoom says how much of it changed, features and files light up as you zoom in', async () => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    const badge = (key: string) => page.locator(`.lt-macroview [data-key="${key}"] > .mv-tally text`);
    await expect(badge('block:ordering')).toHaveText('6 of 51 files');
    await expect(badge('block:payments')).toHaveText('3 of 41 files');
    await expect(badge('block:fulfilment')).toHaveText('4 of 41 files');
    await expect(badge('block:catalog')).toHaveText('');
    await expect(page.locator('.lt-macroview [data-key="block:ordering"]')).toHaveClass(/is-lit/);
    await expect(page.locator('.lt-macroview [data-key="block:catalog"]')).not.toHaveClass(/is-lit/);
    await diveInto(page, 'block:ordering');
    await expect(badge('block:checkout')).toHaveText('4 of 20 files');
    await expect(badge('block:cart')).toHaveText('2 of 17 files');
    await expect(page.locator('.lt-macroview [data-key="block:order-history"]')).not.toHaveClass(/is-lit/);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('opening a file marks it READING in its row, its feature and its area, and calms the rest', async ({}, testInfo) => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    await diveToCheckout(page);
    await page.locator(`.lt-macroview .mv-file[data-path="${CHANGED_FILE}"]`).click();
    await settle(page);
    const row = page.locator(`.lt-macroview .mv-file[data-path="${CHANGED_FILE}"]`);
    await expect(row).toHaveClass(/is-reading/);
    await expect(row.locator('.mv-rowtag')).toHaveText('READING');
    await expect(page.locator('.lt-macroview [data-key="block:checkout"]')).toHaveClass(/is-reading/);
    await expect(page.locator('.lt-macroview [data-key="block:ordering"]')).toHaveClass(/is-reading/);
    await expect(page.locator('.lt-macroview [data-key="block:checkout"] > .mv-mark text')).toHaveText('READING');
    await expect(page.locator('.lt-review, .lt-rvpane').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('macroview-reading.png') });
    await page.keyboard.press('0');
    await settle(page);
    await expect(page.locator('.lt-macroview [data-key="block:ordering"] > .mv-mark text')).toHaveText('READING');
    await expect(page.locator('.lt-macroview [data-key="block:catalog"]')).toHaveClass(/is-dim/);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('a picked Flow step marks the features and files it names', async ({}, testInfo) => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    await page.locator('.lt-viewbar [data-view="flow"]').click();
    await page.locator('[data-flow-step]').first().click();
    await page.locator('.lt-viewbar [data-view="macro"]').click();
    await settle(page);
    await expect(page.locator('.lt-macroview .mv-item.is-flow').first()).toBeVisible();
    await expect(page.locator('.lt-macroview [data-key="block:checkout"]')).toHaveClass(/is-flow|is-reading/);
    await diveToCheckout(page);
    await expect(page.locator('.lt-macroview .mv-file.is-flow').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('macroview-flow-step.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('selecting highlights partners and dims the rest, systems appear, Escape clears and Fit returns', async ({}, testInfo) => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    const area = await centreOf(page, 'block:payments');
    await page.mouse.click(area.x, area.y);
    await expect(page.locator('.lt-macroview [data-key="block:payments"]')).toHaveClass(/is-selected/);
    await expect(page.locator('.lt-macroview [data-key="block:ordering"]')).toHaveClass(/is-related/);
    await expect(page.locator('.lt-macroview [data-key="block:catalog"]')).toHaveClass(/is-dim/);
    await expect(page.locator('.mv-dock .mv-system').first()).toBeVisible();
    await expect(page.locator('.mv-dock .mv-dock-note')).toContainText('talk to Payments');
    await expect(page.locator('.lt-side .lt-detail')).toContainText('taking money');
    await page.screenshot({ path: testInfo.outputPath('macroview-selected.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('.lt-macroview .is-selected')).toHaveCount(0);
    await expect(page.locator('.lt-macroview .is-dim')).toHaveCount(0);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('double-click dives into an area and the breadcrumb follows; the crumb, Escape and Fit bring it back', async () => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    await expect(crumbs(page)).toHaveText('Areas');
    await diveInto(page, 'block:ordering');
    await expect(crumbs(page)).toContainText('Ordering');
    expect(await zoomOf(page)).toBeGreaterThan(1.5);
    await page.locator('.lt-graph-crumbs [data-macro-up], .lt-crumbs button').first().click();
    await settle(page);
    await expect(crumbs(page)).toHaveText('Areas');
    expect(await zoomOf(page)).toBe(1);
    await diveInto(page, 'block:payments');
    await expect(crumbs(page)).toContainText('Payments');
    await page.keyboard.press('Escape');
    await settle(page);
    await expect(crumbs(page)).toHaveText('Areas');
    expect(await zoomOf(page)).toBe(1);
    await diveInto(page, 'block:fulfilment');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await settle(page);
    await expect(crumbs(page)).toHaveText('Areas');
    expect(await zoomOf(page)).toBe(1);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('zooming in with the wheel enters the area under the pointer, and the breadcrumb says so', async () => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    const fulfilment = await centreOf(page, 'block:fulfilment');
    await wheelAt(page, fulfilment.x, fulfilment.y, -300, 5);
    await settle(page);
    await expect(crumbs(page)).toContainText('Fulfilment');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('keyboard: arrows move between neighbours, + and - zoom, 0 fits, Enter dives in, Escape steps out, and the focus is visible', async ({}, testInfo) => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    await view(page).focus();
    await page.keyboard.press('ArrowRight');
    const focused = page.locator('.lt-macroview .mv-item.is-focus');
    await expect(focused).toHaveCount(1);
    const first = await focused.getAttribute('data-key');
    await expect(view(page)).toHaveAttribute('aria-activedescendant', /mv\d+-\d+/);
    await expect(focused.locator('> .mv-shape')).toHaveCSS('stroke-dasharray', 'none');
    await expect(focused.locator('> .mv-shape')).toHaveCSS('stroke-width', '3px');
    await page.keyboard.press('ArrowDown');
    expect(await focused.getAttribute('data-key')).not.toBe(first);
    for (let step = 0; step < 6 && (await focused.getAttribute('data-kind')) !== 'area'; step += 1) await page.keyboard.press('ArrowUp');
    await expect(focused).toHaveAttribute('data-kind', 'area');
    const before = await zoomOf(page);
    await page.keyboard.press('+');
    await page.waitForTimeout(100);
    expect(await zoomOf(page)).toBeGreaterThan(before);
    await page.keyboard.press('-');
    await page.waitForTimeout(100);
    expect(await zoomOf(page)).toBeCloseTo(before, 1);
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await level(page)).not.toBe('areas');
    await expect(crumbs(page)).not.toHaveText('Areas');
    await page.screenshot({ path: testInfo.outputPath('macroview-keyboard-dive.png') });
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await zoomOf(page)).toBe(1);
    await expect(crumbs(page)).toHaveText('Areas');
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.keyboard.press('0');
    await settle(page);
    expect(await zoomOf(page)).toBe(1);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('the wheel, a pinch and the buttons zoom the map and never the page', async () => {
  const harness = await openMacroView({ viewport: LAPTOP });
  try {
    const { page } = harness;
    const before = await pageOverflow(page);
    const spot = await centreOf(page, 'block:catalog');
    await wheelAt(page, spot.x, spot.y, -200, 2);
    expect(await zoomOf(page)).toBeGreaterThan(1.2);
    await page.keyboard.down('Control');
    await wheelAt(page, spot.x, spot.y, -30, 3);
    await page.keyboard.up('Control');
    await page.keyboard.down('Meta');
    await wheelAt(page, spot.x, spot.y, 30, 2);
    await page.keyboard.up('Meta');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    const after = await pageOverflow(page);
    expect(after.scale).toBe(before.scale);
    expect(after.scrollX).toBe(0);
    expect(after.scrollY).toBe(0);
    expect(after.pageX).toBeLessThanOrEqual(0);
    expect(after.pageY).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
    await expect(page.locator('.lt-zoom')).toBeHidden();
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('dragging pans the map and a click that did not move still selects', async () => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    const spot = await centreOf(page, 'block:catalog');
    await wheelAt(page, spot.x, spot.y, -240, 2);
    const transform = () => page.locator('.mv-world').getAttribute('transform');
    const before = await transform();
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x - 120, spot.y - 60, { steps: 6 });
    await page.mouse.up();
    expect(await transform()).not.toBe(before);
    await expect(page.locator('.lt-macroview .is-selected')).toHaveCount(0);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('leaving the Macro view and coming back mounts the map once, with no layout to choose and the systems list in place', async () => {
  const harness = await openMacroView();
  try {
    const { page } = harness;
    await expect(page.locator('.lt-viewbar select')).toHaveCount(0);
    await page.getByRole('button', { name: /^Files/ }).click();
    await expect(view(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Macro/ }).click();
    await expect(view(page)).toBeVisible();
    await expect(page.locator('.lt-macroview')).toHaveCount(1);
    await expect(page.locator('.mv-dock')).toHaveCount(1);
    await settle(page);
    expect(await areaFrames(page)).toHaveLength(LAB_AREAS.length);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

