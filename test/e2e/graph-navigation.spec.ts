import { expect, test } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

let harness: GraphHarness;

test.beforeAll(async () => { harness = await launchGraphHarness(); });
test.afterAll(async () => {
  const errors = harness.errors;
  try { await closeGraphHarness(harness); } finally { expect(errors).toEqual([]); }
});

test.describe('pixi', () => {
    test.beforeEach(async () => {
      await harness.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
      await loadGraphFixture(harness, 'overview');
    });

    test('shows controls and handles exact, bounded and canceled percentages', async () => {
      const page = harness.page;
      const toolbar = page.getByRole('group', { name: 'Graph zoom controls' });
      const input = page.getByRole('textbox', { name: 'Graph zoom percentage' });
      await expect(toolbar).toBeVisible();
      const box = await toolbar.boundingBox();
      const main = await page.locator('.lt-main').boundingBox();
      expect(box && main && box.x >= main.x && box.x + box.width <= main.x + main.width).toBeTruthy();
      await input.fill('900%');
      await input.press('Enter');
      await expect(input).toHaveValue('400%');
      await input.fill('12junk');
      await input.press('Enter');
      await expect(input).toHaveValue('400%');
      await input.fill('5');
      await input.press('Enter');
      await expect(input).toHaveValue('10%');
      await page.getByRole('button', { name: 'Fit' }).click();
      const fit = await input.inputValue();
      await input.focus();
      await input.fill('250%');
      await input.press('Escape');
      await expect(input).toHaveValue(fit);
      await page.locator('.lt-main').focus();
      await page.keyboard.press('Control+0');
      await expect(input).toHaveValue('100%');
      await page.keyboard.press('Shift+Digit1');
      await expect(input).toHaveValue(fit);
    });

    test('keeps manual zoom through resize while Fit recomputes', async () => {
      const page = harness.page;
      const input = page.getByRole('textbox', { name: 'Graph zoom percentage' });
      await input.fill('175%');
      await input.press('Enter');
      await harness.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), 940);
      await expect(input).toHaveValue('175%');
      await page.getByRole('button', { name: 'Fit' }).click();
      const narrow = await input.inputValue();
      await harness.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), 1600);
      await expect.poll(() => input.inputValue()).not.toBe(narrow);
    });

    test('rubber-bands at every pan limit and settles without changing scroll extents', async () => {
      const page = harness.page;
      await loadGraphFixture(harness, 'large');
      const main = page.locator('.lt-main');
      await page.locator('[data-zoom-natural]').click();
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      const box = await main.boundingBox();
      if (!box) throw new Error('graph viewport is missing');
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const cursor = () => page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y) as Element).cursor, centre);
      await page.mouse.move(centre.x, centre.y);
      await page.keyboard.down('Space');
      await expect.poll(cursor).toBe('grab');
      await main.focus();
      await expect(main).toHaveCSS('outline-style', 'none');

      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        const horizontal = edge === 'left' || edge === 'right';
        const direction = edge === 'left' || edge === 'top' ? 1 : -1;
        const start = await main.evaluate((element, side) => {
          element.scrollLeft = side === 'right' ? element.scrollWidth : 0;
          element.scrollTop = side === 'bottom' ? element.scrollHeight : 0;
          return { x: element.scrollLeft, y: element.scrollTop, width: element.scrollWidth, height: element.scrollHeight };
        }, edge);
        const fixedBefore = await Promise.all([toolbarOf(page).boundingBox(), page.locator('.lt-side').boundingBox()]);
        await page.mouse.move(centre.x, centre.y);
        await page.mouse.down();
        await expect.poll(cursor).toBe('grabbing');
        const pushed = { x: centre.x + (horizontal ? 180 * direction : 0), y: centre.y + (horizontal ? 0 : 180 * direction) };
        await page.mouse.move(pushed.x, pushed.y, { steps: 5 });
        const offset = await main.evaluate((element, axis) => Number.parseFloat(getComputedStyle(element).getPropertyValue(axis === 'x' ? '--lt-pan-x' : '--lt-pan-y')), horizontal ? 'x' : 'y');
        expect(Math.sign(offset)).toBe(direction);
        expect(Math.abs(offset)).toBeGreaterThan(0);
        expect(Math.abs(offset)).toBeLessThanOrEqual(20);
        const extents = await main.evaluate((element) => ({ width: element.scrollWidth, height: element.scrollHeight }));
        expect(extents).toEqual({ width: start.width, height: start.height });
        expect(await Promise.all([toolbarOf(page).boundingBox(), page.locator('.lt-side').boundingBox()])).toEqual(fixedBefore);
        await page.mouse.move(pushed.x - (horizontal ? 8 * direction : 0), pushed.y - (horizontal ? 0 : 8 * direction));
        const reversed = await main.evaluate((element, axis) => Number.parseFloat(getComputedStyle(element).getPropertyValue(axis === 'x' ? '--lt-pan-x' : '--lt-pan-y')), horizontal ? 'x' : 'y');
        expect(Math.abs(reversed)).toBeLessThan(Math.abs(offset));
        await page.mouse.up();
        await expect(main).not.toHaveClass(/lt-panning/);
        if (edge === 'left') {
          await page.keyboard.up('Space');
          const hit = await page.locator('.lt-pixi-a11y').evaluate((accessibility) => {
            const main = accessibility.closest('.lt-main') as HTMLElement;
            const rect = main.getBoundingClientRect();
            const offsetX = Number.parseFloat(getComputedStyle(main).getPropertyValue('--lt-pan-x'));
            const offsetY = Number.parseFloat(getComputedStyle(main).getPropertyValue('--lt-pan-y'));
            const buttons = [...accessibility.querySelectorAll<HTMLElement>('.lt-pixi-node-access')];
            const button = buttons.find((candidate) => {
              const x = Number(candidate.dataset.graphX) - main.scrollLeft + Number(candidate.dataset.graphWidth) / 2 + offsetX;
              const y = Number(candidate.dataset.graphY) - main.scrollTop + Number(candidate.dataset.graphHeight) / 2 + offsetY;
              return x > 40 && y > 40 && x < main.clientWidth - 40 && y < main.clientHeight - 40;
            });
            if (!button) throw new Error('No interior Pixi node during overscroll settle');
            return {
              x: rect.left + Number(button.dataset.graphX) - main.scrollLeft + Number(button.dataset.graphWidth) / 2 + offsetX,
              y: rect.top + Number(button.dataset.graphY) - main.scrollTop + Number(button.dataset.graphHeight) / 2 + offsetY,
              key: button.getAttribute('aria-label') ?? '',
            };
          });
          expect(await main.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue('--lt-pan-x')))).toBeGreaterThan(0);
          await page.mouse.move(hit.x, hit.y);
          await expect.poll(() => page.locator('html').getAttribute('data-graph-hovered')).toBe(hit.key);
          await page.mouse.click(hit.x, hit.y);
          await expect(page.getByRole('button', { name: hit.key, exact: true })).toHaveAttribute('aria-pressed', 'true');
          await page.keyboard.down('Space');
        }
        await expect.poll(() => main.evaluate((element, axis) => Number.parseFloat(getComputedStyle(element).getPropertyValue(axis === 'x' ? '--lt-pan-x' : '--lt-pan-y')), horizontal ? 'x' : 'y')).toBe(0);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await main.evaluate((element) => { element.scrollLeft = 0; });
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + 60, centre.y);
      await page.mouse.up();
      expect(await main.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue('--lt-pan-x')))).toBe(0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.keyboard.up('Space');
      await expect(main).not.toHaveClass(/lt-pan-ready/);
      const input = page.getByRole('textbox', { name: 'Graph zoom percentage' });
      await input.focus();
      await page.keyboard.down('Space');
      await expect(main).not.toHaveClass(/lt-pan-ready/);
      await page.keyboard.up('Space');
    });

    test('shows graph focus only after keyboard navigation', async () => {
      const page = harness.page;
      const main = page.locator('.lt-main');
      const box = await main.boundingBox();
      if (!box) throw new Error('graph viewport is missing');
      await page.mouse.click(box.x + 5, box.y + 5);
      await expect(main).toBeFocused();
      await expect(main).toHaveCSS('outline-style', 'none');
      await main.evaluate((element) => {
        const focusable = ([...document.querySelectorAll('button, input, [tabindex="0"]')] as HTMLElement[]).filter((candidate) => !candidate.hidden && candidate.getClientRects().length);
        focusable[focusable.indexOf(element as HTMLElement) - 1]?.focus();
      });
      await page.keyboard.press('Tab');
      await expect(main).toBeFocused();
      await expect(main).toHaveCSS('outline-style', 'solid');
    });

    test('zooms around the pointer and pans without activating a card', async () => {
      const page = harness.page;
      await loadGraphFixture(harness, 'large');
      const main = page.locator('.lt-main');
      const input = page.getByRole('textbox', { name: 'Graph zoom percentage' });
      await page.locator('[data-zoom-natural]').click();
      const box = await main.boundingBox();
      if (!box) throw new Error('graph viewport is missing');
      await main.evaluate((element) => { element.scrollLeft = 120; element.scrollTop = 80; });
      const before = await main.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
      const offset = { x: box.width * 0.35, y: box.height * 0.35 };
      const logicalBefore = { x: before.left + offset.x, y: before.top + offset.y };
      await page.mouse.move(box.x + offset.x, box.y + offset.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -180);
      await page.keyboard.up('Control');
      await expect.poll(() => input.inputValue()).not.toBe('100%');
      const zoomed = await main.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
      const scale = Number.parseFloat(await input.inputValue()) / 100;
      expect((zoomed.left + offset.x) / scale).toBeCloseTo(logicalBefore.x, -1);
      expect((zoomed.top + offset.y) / scale).toBeCloseTo(logicalBefore.y, -1);
      const selectedBefore = await page.locator('.lt-pixi-node-access[aria-pressed="true"]').count();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      expect(await page.locator('.lt-pixi-node-access[aria-pressed="true"]').count()).toBe(selectedBefore);
      const panned = await main.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
      expect(panned.left + panned.top).toBeGreaterThan(zoomed.left + zoomed.top);
      await main.focus();
      const arrowStart = await main.evaluate((element) => element.scrollLeft);
      await page.keyboard.press('ArrowRight');
      expect(await main.evaluate((element) => element.scrollLeft)).toBeGreaterThan(arrowStart);
      await page.keyboard.down('Space');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 30, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.up('Space');
      expect(await page.locator('.lt-pixi-node-access[aria-pressed="true"]').count()).toBe(selectedBefore);
      const beforeLegitimateClick = await input.inputValue();
      await page.locator('[data-zoom-in]').click();
      await expect(input).not.toHaveValue(beforeLegitimateClick);
      await main.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      const toolbarBox = await toolbarOf(page).boundingBox();
      const mainBox = await main.boundingBox();
      expect(toolbarBox && mainBox && toolbarBox.x >= mainBox.x && toolbarBox.x + toolbarBox.width <= mainBox.x + mainBox.width).toBeTruthy();
        const point = await page.locator('.lt-pixi-a11y').evaluate((accessibility) => {
          const main = accessibility.closest('.lt-main') as HTMLElement;
          const rect = main.getBoundingClientRect();
          const buttons = [...accessibility.querySelectorAll<HTMLElement>('.lt-pixi-node-access')];
          const button = buttons.find((candidate) => {
            const x = Number(candidate.dataset.graphX) - main.scrollLeft;
            const y = Number(candidate.dataset.graphY) - main.scrollTop;
            return x > 0 && y > 0 && x < main.clientWidth - Number(candidate.dataset.graphWidth) && y < main.clientHeight - Number(candidate.dataset.graphHeight);
          });
          if (!button) throw new Error('No visible Pixi node after zoom and pan');
          return {
            x: rect.left + Number(button.dataset.graphX) - main.scrollLeft + Number(button.dataset.graphWidth) / 2,
            y: rect.top + Number(button.dataset.graphY) - main.scrollTop + Number(button.dataset.graphHeight) / 2,
            key: button.getAttribute('aria-label') ?? '',
          };
        });
        await page.mouse.move(point.x, point.y);
        await expect.poll(() => page.locator('html').getAttribute('data-graph-hovered')).toBe(point.key);
        await page.mouse.click(point.x, point.y);
        await expect(page.getByRole('button', { name: point.key, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(toolbarOf(page)).toBeVisible();
    });

    test('right-drags to pan while preserving a plain right-click context menu', async () => {
      const page = harness.page;
      await loadGraphFixture(harness, 'large');
      await page.locator('[data-zoom-natural]').click();
      const main = page.locator('.lt-main');
      const box = await main.boundingBox();
      if (!box) throw new Error('graph viewport is missing');
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await main.evaluate((element) => { element.scrollLeft = 120; element.scrollTop = 80; });
      await page.evaluate(() => {
        document.documentElement.dataset.contextMenus = '0';
        document.addEventListener('contextmenu', (event) => {
          document.documentElement.dataset.contextMenus = String(Number(document.documentElement.dataset.contextMenus) + 1);
          document.documentElement.dataset.contextTarget = (event.target as Element).className;
          event.preventDefault();
        });
      });
      const expectedTarget = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as Element).className, point);

      await page.mouse.click(point.x, point.y, { button: 'right' });
      await expect(page.locator('html')).toHaveAttribute('data-context-menus', '1');
      await expect(page.locator('html')).toHaveAttribute('data-context-target', expectedTarget);

      await page.evaluate(() => { document.documentElement.dataset.contextMenus = '0'; });
      const before = await main.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'right' });
      await expect(page.locator('html')).toHaveAttribute('data-context-menus', '0');
      await page.mouse.move(point.x - 70, point.y - 45, { steps: 4 });
      await expect(main).toHaveClass(/lt-panning/);
      await page.mouse.up({ button: 'right' });
      await expect(main).not.toHaveClass(/lt-panning/);
      await expect(page.locator('html')).toHaveAttribute('data-context-menus', '0');
      const after = await main.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
      expect(after.left).toBeGreaterThan(before.left);
      expect(after.top).toBeGreaterThan(before.top);

      await main.dispatchEvent('contextmenu', { button: 0 });
      await expect(page.locator('html')).toHaveAttribute('data-context-menus', '1');

      await page.evaluate(() => { document.documentElement.dataset.contextMenus = '0'; });
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(point.x + 2, point.y);
      await page.mouse.up({ button: 'right' });
      await expect(page.locator('html')).toHaveAttribute('data-context-menus', '1');
      await expect(main).not.toHaveClass(/lt-panning/);

      await page.evaluate(() => { document.documentElement.dataset.contextMenus = '0'; });
      const edge = { x: box.x + 1, y: box.y + box.height / 2 };
      await page.mouse.move(edge.x, edge.y);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(edge.x - 2, edge.y);
      await page.mouse.up({ button: 'right' });
      await expect(page.locator('html')).toHaveAttribute('data-context-menus', '1');
      await expect(main).not.toHaveClass(/lt-panning/);
    });
});

test('does not swallow the next click after Space is released before the pointer in Pixi', async () => {
    await loadGraphFixture(harness, 'overview');
    const page = harness.page;
    const main = page.locator('.lt-main');
    const box = await main.boundingBox();
    if (!box) throw new Error('graph viewport is missing');
    await main.focus();
    await page.keyboard.down('Space');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 35, box.y + box.height / 2 - 25, { steps: 3 });
    await page.keyboard.up('Space');
    await page.mouse.move(box.x - 10, box.y - 10);
    await page.mouse.up();
    await expect.poll(() => main.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue('--lt-pan-x')) || 0)).toBe(0);
    await expect.poll(() => main.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue('--lt-pan-y')) || 0)).toBe(0);
    const target = page.locator('.lt-pixi-node-access').first();
    const point = await target.evaluate((button) => {
      const main = button.closest('.lt-main') as HTMLElement;
      const rect = main.getBoundingClientRect();
      return {
        x: rect.left + Number((button as HTMLElement).dataset.graphX) - main.scrollLeft + Number((button as HTMLElement).dataset.graphWidth) / 2,
        y: rect.top + Number((button as HTMLElement).dataset.graphY) - main.scrollTop + Number((button as HTMLElement).dataset.graphHeight) / 2,
      };
    });
    await page.mouse.click(point.x, point.y);
    await expect(target).toHaveAttribute('aria-pressed', 'true');
});

test('keeps manual zoom across real platform tabs in Pixi', async () => {
    await loadGraphFixture(harness, 'platformWidths');
    await expect(harness.page.locator('html')).toHaveAttribute('data-graph-renderer', 'webgl');
    const input = harness.page.getByRole('textbox', { name: 'Graph zoom percentage' });
    const zoomIn = harness.page.getByRole('button', { name: 'Zoom in' });
    for (let step = 0; step < 7; step += 1) await zoomIn.click();
    await expect(input).toHaveValue('170%');
    await expect(harness.page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    await harness.page.locator('.lt-plat').nth(1).click();
    await expect(input).toHaveValue('170%');
});

test('keeps the scaled Pixi canvas and semantic controls in relation view', async () => {
  await loadGraphFixture(harness, 'overview');
  const page = harness.page;
  await page.getByRole('textbox', { name: 'Graph zoom percentage' }).fill('175%');
  await page.getByRole('textbox', { name: 'Graph zoom percentage' }).press('Enter');
  await page.locator('.lt-pixi-node-access').first().evaluate((button: HTMLButtonElement) => button.click());
  await page.locator('.lt-rvbar [data-relview]').click();
  await expect(page.locator('.lt-pixi-host')).toBeVisible();
  await expect(page.locator('.lt-pixi-canvas')).toBeVisible();
  await expect(page.locator('.lt-pixi-node-access')).toHaveCount(3);
  const initialResolution = Number(await page.locator('html').getAttribute('data-graph-text-resolution'));
  const input = page.getByRole('textbox', { name: 'Graph zoom percentage' });
  await input.focus();
  await input.fill('250%');
  await input.press('Escape');
  await expect(page.locator('.lt-pixi-host')).toBeVisible();
  await expect(input).toHaveValue('175%');
  await input.fill('207%');
  await input.press('Enter');
  expect(Number(await page.locator('html').getAttribute('data-graph-text-resolution'))).toBe(initialResolution);
  await expect.poll(async () => Number(await page.locator('html').getAttribute('data-graph-text-resolution'))).toBe(await page.evaluate(() => devicePixelRatio * 2.25));
  await page.locator('.lt-main').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lt-rvbar [data-relview]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('textbox', { name: 'Graph zoom percentage' })).toHaveValue('207%');
});

test('keeps navigation available for an empty graph', async () => {
  await loadGraphFixture(harness, 'empty');
  await expect(harness.page.getByRole('group', { name: 'Graph zoom controls' })).toBeVisible();
  await harness.page.locator('[data-zoom-natural]').click();
  await expect(harness.page.getByRole('textbox', { name: 'Graph zoom percentage' })).toHaveValue('100%');
  await expect(harness.page.locator('.lt-none')).toBeVisible();
});

function toolbarOf(page: GraphHarness['page']) {
  return page.getByRole('group', { name: 'Graph zoom controls' });
}
