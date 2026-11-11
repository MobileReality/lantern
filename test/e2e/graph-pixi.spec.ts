import { expect, test } from '@playwright/test';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';

test('repaints retained cards when platform tabs change their column width', async ({}, testInfo) => {
  const harness = await launchGraphHarness('platformWidths');
  try {
    const page = harness.page;
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const narrow = page.getByRole('tab', { name: /^Narrow/ });
    const wide = page.getByRole('tab', { name: /^Wide/ });

    await wide.click();
    await expect(page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    await narrow.click();
    await expect(page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    await wide.click();
    await expect(page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    await narrow.click();
    await expect(page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Pixi canvas is not visible');
    const comparisonClip = { x: canvasBox.x, y: canvasBox.y, width: 450, height: 160 };
    const navigated = await page.screenshot({ path: testInfo.outputPath('navigated.png'), clip: comparisonClip });

    const aws = page.getByRole('button', { name: 'aws', exact: true });
    const position = await aws.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }));
    await page.mouse.move(canvasBox.x + position.x + position.width - 2, canvasBox.y + position.y + position.height / 2);
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', 'ext:aws');
    const source = page.getByRole('button', { name: 'src/narrow.ts', exact: true });
    const sourcePosition = await source.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }));
    await page.mouse.click(canvasBox.x + sourcePosition.x + sourcePosition.width - 2, canvasBox.y + sourcePosition.y + sourcePosition.height / 2);
    await expect(page.locator('.lt-detail')).toContainText('src/narrow.ts');
    await page.mouse.move(0, 0);

    await loadGraphFixture(harness, 'platformWidths', undefined, 'narrow');
    const freshCanvasBox = await page.locator('canvas.lt-pixi-canvas').boundingBox();
    if (!freshCanvasBox) throw new Error('Pixi canvas is not visible');
    const fresh = await page.screenshot({ path: testInfo.outputPath('fresh.png'), clip: { ...comparisonClip, x: freshCanvasBox.x, y: freshCanvasBox.y } });
    const difference = await harness.app.evaluate(({ nativeImage }, images) => {
      const navigatedBitmap = nativeImage.createFromBuffer(Buffer.from(images.navigated, 'base64')).getBitmap();
      const freshBitmap = nativeImage.createFromBuffer(Buffer.from(images.fresh, 'base64')).getBitmap();
      let channelDelta = 0;
      for (let index = 0; index < freshBitmap.length; index += 1) channelDelta += Math.abs(navigatedBitmap[index] - freshBitmap[index]);
      return channelDelta / freshBitmap.length / 255;
    }, {
      navigated: navigated.toString('base64'),
      fresh: fresh.toString('base64'),
    });

    // WebGL rasterization can vary slightly between otherwise identical retained frames.
    expect(difference).toBeLessThan(0.01);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('renders the representative graph through a real WebGL canvas with viewport culling', async ({}, testInfo) => {
  const harness = await launchGraphHarness('overview');
  try {
    const page = harness.page;
    await expect(page.locator('html')).toHaveAttribute('data-graph-renderer', 'webgl');
    await expect(page.locator('canvas.lt-pixi-canvas')).toBeVisible();
    await expect(page.locator('.lt-graph')).toBeHidden();
    expect(await page.locator('.lt-pixi-node-access').count()).toBeGreaterThanOrEqual(8);
    const visible = Number(await page.locator('html').getAttribute('data-graph-visible-nodes'));
    expect(visible).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('pixi-overview.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('shows a clear error and stops the canvas after WebGL context loss', async ({}, testInfo) => {
  const harness = await launchGraphHarness('overview');
  try {
    const page = harness.page;
    const canvas = page.locator('canvas.lt-pixi-canvas');
    await expect(canvas).toBeVisible();
    await page.locator('.lt-pixi-node-access').first().evaluate((button: HTMLButtonElement) => button.click());
    await canvas.evaluate((element) => {
      const gl = (element as HTMLCanvasElement).getContext('webgl2') ?? (element as HTMLCanvasElement).getContext('webgl');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await expect(page.getByRole('status')).toHaveText('The visual graph could not start because WebGL is unavailable.');
    await expect(canvas).toBeHidden();
    await expect(page.locator('.lt-pixi-a11y')).toBeHidden();
    await expect(page.locator('.lt-graph')).toHaveCount(0);
    await expect(page.locator('.lt-pixi-node-access').first()).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-graph-renderer', 'unavailable');
    await page.screenshot({ path: testInfo.outputPath('pixi-webgl-error.png') });
    await page.mouse.move(20, 20);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new PointerEvent('pointerout'));
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await page.locator('.lt-detail [data-go]').first().click();
    expect(harness.errors).toEqual([]);
    await page.getByRole('textbox', { name: 'Graph zoom percentage' }).fill('180%');
    await page.getByRole('textbox', { name: 'Graph zoom percentage' }).press('Enter');
    await expect(canvas).toBeHidden();
  } finally {
    await closeGraphHarness(harness);
  }
});

test('refreshes text quality after zoom settles without changing interaction geometry', async () => {
  const harness = await launchGraphHarness('overview');
  try {
    const page = harness.page;
    const root = page.locator('html');
    const input = page.getByRole('textbox', { name: 'Graph zoom percentage' });
    const target = page.getByRole('button', { name: 'src/pages/dashboard.tsx', exact: true });
    const initialResolution = Number(await root.getAttribute('data-graph-text-resolution'));

    await input.fill('207%');
    await input.press('Enter');
    const immediate = await target.evaluate((element) => ({
      x: element.dataset.graphX,
      y: element.dataset.graphY,
      width: element.dataset.graphWidth,
      height: element.dataset.graphHeight,
    }));
    expect(Number(immediate.width)).toBeGreaterThan(200);
    expect(Number(await root.getAttribute('data-graph-text-resolution'))).toBe(initialResolution);

    const expectedResolution = await page.evaluate(() => devicePixelRatio * 2.25);
    await expect.poll(async () => Number(await root.getAttribute('data-graph-text-resolution'))).toBe(expectedResolution);
    expect(await target.evaluate((element) => ({
      x: element.dataset.graphX,
      y: element.dataset.graphY,
      width: element.dataset.graphWidth,
      height: element.dataset.graphHeight,
    }))).toEqual(immediate);

    await target.focus();
    await page.keyboard.press('Enter');
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lt-detail')).toContainText('src/pages/dashboard.tsx');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('animates ordinary lifts and relation recentering, then honors reduced motion', async () => {
  const harness = await launchGraphHarness('overview');
  try {
    const page = harness.page;
    const root = page.locator('html');
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const service = page.getByRole('button', { name: 'src/services/project-service.ts', exact: true });
    await service.evaluate((button: HTMLButtonElement) => button.click());
    await expect(root).toHaveAttribute('data-graph-transition', 'running');
    const liftFrame = await canvas.screenshot();
    await expect(root).toHaveAttribute('data-graph-transition', 'settled', { timeout: 500 });
    const lifted = await canvas.screenshot();
    expect(liftFrame.equals(lifted)).toBe(false);

    await harness.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1000));
    await loadGraphFixture(harness, 'relationAreas');
    const centre = page.getByRole('button', { name: 'src/centre.ts', exact: true });
    await centre.evaluate((button: HTMLButtonElement) => button.click());
    await expect(root).toHaveAttribute('data-graph-transition', 'settled', { timeout: 500 });
    await page.locator('.lt-rvbar [data-relview]').click();
    const member = page.getByRole('button', { name: 'src/shared/member-0.ts', exact: true });
    await member.evaluate((button: HTMLButtonElement) => button.click());
    await expect(root).toHaveAttribute('data-graph-transition', 'running');
    await page.getByRole('button', { name: 'src/centre.ts', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(root).toHaveAttribute('data-graph-transition', 'settled', { timeout: 500 });
    await expect(page.getByRole('button', { name: 'src/centre.ts', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'src/shared/member-1.ts', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(root).toHaveAttribute('data-graph-transition', 'settled');
  } finally {
    await closeGraphHarness(harness);
  }
});

test('clears canvas selection and inspection without letting card clicks bubble', async () => {
  const harness = await launchGraphHarness('overview');
  try {
    const page = harness.page;
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Pixi canvas is not visible');
    const service = page.getByRole('button', { name: 'src/services/project-service.ts', exact: true });
    const dashboard = page.getByRole('button', { name: 'src/pages/dashboard.tsx', exact: true });
    await service.evaluate((button: HTMLButtonElement) => button.click());
    await expect(service).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(box.x + 5, box.y + 5);
    await expect(service).toHaveAttribute('aria-pressed', 'false');

    await service.evaluate((button: HTMLButtonElement) => button.click());
    await page.locator('.lt-lock').click();
    await dashboard.evaluate((button: HTMLButtonElement) => button.click());
    await expect(dashboard).toHaveAttribute('aria-description', /inspected/);
    await page.mouse.click(box.x + 5, box.y + 5);
    await expect(dashboard).not.toHaveAttribute('aria-description', /inspected/);
    await expect(service).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.lt-lock')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(box.x + 5, box.y + 5);
    await expect(service).toHaveAttribute('aria-pressed', 'true');

    const position = await dashboard.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }));
    const scroll = await page.locator('.lt-main').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    await page.mouse.click(box.x + position.x - scroll.left + position.width / 2, box.y + position.y - scroll.top + position.height / 2);
    await expect(dashboard).toHaveAttribute('aria-description', /inspected/);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('highlights and pins relation areas through pointer and keyboard controls', async ({}, testInfo) => {
  const harness = await launchGraphHarness('relationAreas');
  try {
    const page = harness.page;
    const centre = page.getByRole('button', { name: 'src/centre.ts', exact: true });
    await centre.evaluate((button: HTMLButtonElement) => button.click());
    await page.locator('.lt-rvbar [data-relview]').click();
    const area = page.locator('.lt-pixi-area-access');
    await expect(area).toHaveCount(1);
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Pixi canvas is not visible');
    const position = await area.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }));
    const scroll = await page.locator('.lt-main').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    const plain = await canvas.screenshot();
    await page.mouse.move(canvasBox.x + position.x - scroll.left + 5, canvasBox.y + position.y - scroll.top + 5);
    const hovered = await canvas.screenshot();
    expect(hovered.equals(plain)).toBe(false);
    await page.mouse.move(canvasBox.x + 2, canvasBox.y + 2);
    expect((await canvas.screenshot()).equals(plain)).toBe(true);

    await area.focus();
    expect((await canvas.screenshot()).equals(plain)).toBe(false);
    await area.evaluate((button: HTMLButtonElement) => button.click());
    await expect(area).toHaveAttribute('aria-pressed', 'true');
    await centre.focus();
    await page.screenshot({ path: testInfo.outputPath('pixi-relation-area-pinned.png') });
    expect((await canvas.screenshot()).equals(plain)).toBe(false);
    await area.evaluate((button: HTMLButtonElement) => button.click());
    await expect(area).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.lt-main').focus();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect((await canvas.screenshot()).equals(plain)).toBe(true);

    const member = page.getByRole('button', { name: 'src/shared/member-0.ts', exact: true });
    await member.evaluate((button: HTMLButtonElement) => button.click());
    await expect(member).toHaveAttribute('aria-pressed', 'true');
    await expect(member).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('.lt-pixi-area-access[aria-pressed="true"]')).toHaveCount(0);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('uses canvas hit testing and DOM keyboard semantics for the same selection state', async () => {
  const harness = await launchGraphHarness('overview');
  try {
    const page = harness.page;
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const targetPath = 'src/pages/dashboard.tsx';
    const target = page.getByRole('button', { name: targetPath, exact: true });
    const position = await target.evaluate((element) => ({
      x: Number((element as HTMLElement).dataset.graphX),
      y: Number((element as HTMLElement).dataset.graphY),
      width: Number((element as HTMLElement).dataset.graphWidth),
      height: Number((element as HTMLElement).dataset.graphHeight),
    }));
    const scroll = await page.locator('.lt-main').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    await canvas.click({ position: { x: position.x - scroll.left + position.width / 2, y: position.y - scroll.top + position.height / 2 } });
    await expect(page.locator('.lt-detail')).toContainText(targetPath);
    const service = page.getByRole('button', { name: 'src/services/project-service.ts' });
    await service.focus();
    await page.keyboard.press('Enter');
    await expect(service).toHaveAttribute('aria-pressed', 'true');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('keeps a viewport-sized canvas while scrolling a large logical graph', async () => {
  const harness = await launchGraphHarness('large');
  try {
    const page = harness.page;
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const before = Number(await page.locator('html').getAttribute('data-graph-visible-nodes'));
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox?.height).toBeLessThanOrEqual(760);
    expect(before).toBeLessThan(1200);
    const first = page.getByRole('button', { name: /file-0000\.ts/ });
    const firstPosition = await first.evaluate((element) => ({
      x: Number((element as HTMLElement).dataset.graphX),
      y: Number((element as HTMLElement).dataset.graphY),
      width: Number((element as HTMLElement).dataset.graphWidth),
      height: Number((element as HTMLElement).dataset.graphHeight),
    }));
    if (!canvasBox) throw new Error('Pixi canvas is not visible');
    await page.mouse.move(canvasBox.x + firstPosition.x + firstPosition.width / 2, canvasBox.y + firstPosition.y + firstPosition.height / 2);
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', /file-0000\.ts/);
    await page.locator('.lt-main').evaluate((element) => { element.scrollTop += 4; });
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', /file-0000\.ts/);
    await page.locator('.lt-main').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-graph-visible-nodes'))).toBeGreaterThan(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-graph-hovered', /file-0000\.ts/);
    expect(Number(await page.locator('html').getAttribute('data-graph-visible-nodes'))).toBeLessThan(1200);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('collapses directories into counted tiles when zoomed out and expands them on click and zoom', async ({}, testInfo) => {
  const harness = await launchGraphHarness('dense');
  try {
    const page = harness.page;
    const tiles = page.locator('.lt-pixi-node-access');
    await expect.poll(() => tiles.count()).toBeLessThan(2927 * 0.2);
    const collapsed = await tiles.count();
    const first = page.getByRole('button', { name: /^backend\/src\/modules\/auth\/part-00 · \d+$/ });
    await expect(first).toHaveCount(1);
    const size = Number(/· (\d+)$/.exec((await first.textContent()) ?? '')?.[1]);
    await page.screenshot({ path: testInfo.outputPath('pixi-dense-collapsed.png') });
    await first.evaluate((element) => (element as HTMLElement).click());
    await expect.poll(() => tiles.count()).toBe(collapsed - 1 + size);
    await page.screenshot({ path: testInfo.outputPath('pixi-dense-one-expanded.png') });
    const box = await page.locator('.lt-main').boundingBox();
    if (!box) throw new Error('Graph area is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.keyboard.down('Control');
    for (let step = 0; step < 4; step += 1) await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect.poll(() => tiles.count()).toBe(2927);
    await page.screenshot({ path: testInfo.outputPath('pixi-dense-zoomed-in.png') });
    await page.keyboard.down('Control');
    for (let step = 0; step < 4; step += 1) await page.mouse.wheel(0, 120);
    await page.keyboard.up('Control');
    await expect.poll(() => tiles.count()).toBe(collapsed);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('resizes the viewport canvas and preserves physical card hit testing', async () => {
  const harness = await launchGraphHarness('overview');
  try {
    const canvas = harness.page.locator('.lt-pixi-canvas');
    const before = await canvas.boundingBox();
    await harness.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(820, 620));
    await expect.poll(async () => (await canvas.boundingBox())?.width).not.toBe(before?.width);
    const after = await canvas.boundingBox();
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      const rendererWidth = await canvas.evaluate((element) => (element as HTMLCanvasElement).width / devicePixelRatio);
      return Math.abs(rendererWidth - (box?.width ?? 0));
    }).toBeLessThan(1);
    const button = harness.page.getByRole('button', { name: 'src/pages/dashboard.tsx', exact: true });
    const position = await button.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }));
    const scroll = await harness.page.locator('.lt-main').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    if (!after) throw new Error('Pixi canvas is not visible after resize');
    await harness.page.mouse.click(after.x + position.x - scroll.left + position.width / 2, after.y + position.y - scroll.top + position.height / 2);
    await expect(harness.page.locator('.lt-detail')).toContainText('src/pages/dashboard.tsx');
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('matches all four relation edge styles and highlights the canvas node under the pointer', async ({}, testInfo) => {
  const harness = await launchGraphHarness('edgeStyles');
  try {
    const page = harness.page;
    const selected = page.getByRole('button', { name: 'src/selected-service.ts', exact: true });
    await selected.focus();
    await page.keyboard.press('Enter');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    await page.screenshot({ path: testInfo.outputPath('pixi-edge-styles.png') });

    const hovered = page.getByRole('button', { name: 'src/widget.tsx', exact: true });
    const position = await hovered.evaluate((element) => ({
      x: Number((element as HTMLElement).dataset.graphX),
      y: Number((element as HTMLElement).dataset.graphY),
      width: Number((element as HTMLElement).dataset.graphWidth),
      height: Number((element as HTMLElement).dataset.graphHeight),
    }));
    const canvas = page.locator('canvas.lt-pixi-canvas');
    const canvasBox = await canvas.boundingBox();
    const scroll = await page.locator('.lt-main').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    if (!canvasBox) throw new Error('Pixi canvas is not visible');
    await page.mouse.move(canvasBox.x + position.x - scroll.left + position.width / 2, canvasBox.y + position.y - scroll.top + position.height / 2);
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', 'src/widget.tsx');
    await expect(canvas).toHaveAttribute('data-tip', /src\/widget\.tsx/);
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => resolve());
    }));
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', 'src/widget.tsx');
    await selected.focus();
    await page.keyboard.press('Enter');
    await expect(selected).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-graph-transition', 'settled');
    const expectedHovered = await page.locator('.lt-pixi-node-access').evaluateAll((elements, pointer) => {
      const canvasRect = document.querySelector('canvas.lt-pixi-canvas')!.getBoundingClientRect();
      const main = document.querySelector('.lt-main') as HTMLElement;
      return elements.find((element) => {
        const item = element as HTMLElement;
        const left = canvasRect.left + Number(item.dataset.graphX) - main.scrollLeft;
        const top = canvasRect.top + Number(item.dataset.graphY) - main.scrollTop;
        return pointer.x >= left && pointer.x <= left + Number(item.dataset.graphWidth)
          && pointer.y >= top && pointer.y <= top + Number(item.dataset.graphHeight);
      })?.getAttribute('aria-label') ?? '';
    }, { x: canvasBox.x + position.x - scroll.left + position.width / 2, y: canvasBox.y + position.y - scroll.top + position.height / 2 });
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', expectedHovered);
    const currentPosition = await hovered.evaluate((element) => ({
      x: Number((element as HTMLElement).dataset.graphX),
      y: Number((element as HTMLElement).dataset.graphY),
      width: Number((element as HTMLElement).dataset.graphWidth),
      height: Number((element as HTMLElement).dataset.graphHeight),
    }));
    await page.mouse.move(canvasBox.x + currentPosition.x - scroll.left + currentPosition.width / 2, canvasBox.y + currentPosition.y - scroll.top + currentPosition.height / 2);
    await expect(page.locator('html')).toHaveAttribute('data-graph-hovered', 'src/widget.tsx');
    const highlighted = await canvas.screenshot({ path: testInfo.outputPath('pixi-node-hovered.png') });
    await page.mouse.move(canvasBox.x + 2, canvasBox.y + 2);
    const cleared = await canvas.screenshot({ path: testInfo.outputPath('pixi-node-unhovered.png') });
    await page.mouse.move(canvasBox.x + 4, canvasBox.y + 4);
    const stable = await canvas.screenshot();
    const pixels = await harness.app.evaluate(({ nativeImage }, images) => {
      const bitmap = (image: string) => nativeImage.createFromBuffer(Buffer.from(image, 'base64')).getBitmap();
      return {
        highlighted: bitmap(images.highlighted).equals(bitmap(images.cleared)),
        stable: bitmap(images.stable).equals(bitmap(images.cleared)),
      };
    }, { highlighted: highlighted.toString('base64'), cleared: cleared.toString('base64'), stable: stable.toString('base64') });
    expect(pixels).toEqual({ highlighted: false, stable: true });

    await selected.evaluate((button: HTMLButtonElement) => button.click());
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const target = page.getByRole('button', { name: 'src/page.tsx', exact: true });
    const edgePoint = await Promise.all([selected, target].map((locator) => locator.evaluate((element) => ({ x: Number((element as HTMLElement).dataset.graphX), y: Number((element as HTMLElement).dataset.graphY), width: Number((element as HTMLElement).dataset.graphWidth), height: Number((element as HTMLElement).dataset.graphHeight) }))));
    const [from, to] = edgePoint;
    const fromPoint = { x: from.x, y: from.y + from.height / 2 };
    const toPoint = { x: to.x + to.width, y: to.y + to.height / 2 };
    const distance = (toPoint.x - fromPoint.x) / 2;
    const control1 = { x: fromPoint.x + distance, y: fromPoint.y };
    const control2 = { x: toPoint.x - distance, y: toPoint.y };
    const midpoint = {
      x: 0.125 * fromPoint.x + 0.375 * control1.x + 0.375 * control2.x + 0.125 * toPoint.x,
      y: 0.125 * fromPoint.y + 0.375 * control1.y + 0.375 * control2.y + 0.125 * toPoint.y,
    };
    await page.mouse.move(canvasBox.x + midpoint.x - scroll.left, canvasBox.y + midpoint.y - scroll.top);
    await expect(canvas).toHaveAttribute('data-tip', /src\/selected-service\.ts > src\/page\.tsx#loadPage/);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('renders pull request and lock states in the real canvas', async ({}, testInfo) => {
  const harness = await launchGraphHarness('overview', '42');
  try {
    const page = harness.page;
    const service = page.locator('.lt-pixi-node-access[aria-label="src/services/project-service.ts"]');
    const changed = page.locator('.lt-pixi-node-access[aria-label="src/components/naïve-über-long-component-name.tsx"]');
    const gone = page.locator('.lt-pixi-node-access[aria-label="src/lib/format-project.ts"]');
    await expect(service).toHaveClass(/pr-hit/);
    await expect(changed).toHaveClass(/pr-new/);
    await expect(gone).toHaveClass(/pr-hit/);
    await service.evaluate((button: HTMLButtonElement) => button.click());
    await page.locator('.lt-lock').click();
    await changed.evaluate((button: HTMLButtonElement) => button.click());
    await expect(service).toHaveAttribute('aria-description', /locked/);
    await expect(changed).toHaveAttribute('aria-description', /inspected/);
    await page.screenshot({ path: testInfo.outputPath('pixi-pr-lock.png') });
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});

test('keeps cached tile text consistent with freshly rendered tiles after zooming', async ({}, testInfo) => {
  const harness = await launchGraphHarness('dense');
  try {
    const page = harness.page;
    const canvas = page.locator('.lt-pixi-canvas');
    const host = page.locator('.lt-pixi-host');
    const zoom = page.getByRole('textbox', { name: 'Graph zoom percentage' });
    await zoom.fill('60%');
    await zoom.press('Enter');
    await page.mouse.move(0, 0);
    const zoomed = await canvas.screenshot({ path: testInfo.outputPath('zoomed.png') });
    const zoomedWidth = await host.getAttribute('style');
    await zoom.fill('100%');
    await zoom.press('Enter');
    await expect(host).not.toHaveAttribute('style', zoomedWidth!);
    await zoom.fill('60%');
    await zoom.press('Enter');
    await expect(host).toHaveAttribute('style', zoomedWidth!);
    const fresh = await canvas.screenshot({ path: testInfo.outputPath('fresh.png') });
    const difference = await harness.app.evaluate(({ nativeImage }, images) => {
      const before = nativeImage.createFromBuffer(Buffer.from(images.before, 'base64')).getBitmap();
      const after = nativeImage.createFromBuffer(Buffer.from(images.after, 'base64')).getBitmap();
      if (before.length !== after.length) return 1;
      let changed = 0;
      for (let index = 0; index < before.length; index += 1) if (before[index] !== after[index]) changed += 1;
      return changed / before.length;
    }, { before: zoomed.toString('base64'), after: fresh.toString('base64') });
    expect(difference).toBeLessThan(0.005);
    expect(harness.errors).toEqual([]);
  } finally {
    await closeGraphHarness(harness);
  }
});
