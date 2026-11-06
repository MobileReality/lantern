import { chromium, expect, test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const RIGHT_PANE_MIN = 300;
const STYLES = ['workspace.css', 'lantern.css', 'lantern-prs.css', 'lantern-review.css', 'lantern-flow.css'];
let browser: Browser | null = null;
let dir = '';

test.beforeAll(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.LANTERN_FLOW_CHROMIUM || undefined });
  } catch {
    browser = null;
  }
  dir = await mkdtemp(path.join(tmpdir(), 'lantern-flow-layout-'));
  const bundle = await build({
    stdin: {
      contents: `import { flowHtml, syncPick, syncReading } from './src/renderer/lib/lanternflow';
import { prReviewDemo } from './test/fixtures/graph/pr-review-demo';
const host = document.getElementById('host')!;
const params = new URLSearchParams(location.search);
host.innerHTML = flowHtml(prReviewDemo.prs[0], 'e2e');
if (params.has('pick')) syncPick(host, host.querySelector('[data-flow-step]')!.getAttribute('data-flow-step'));
if (params.has('read')) syncReading(host, document.body, prReviewDemo.prs[0], params.get('read'));`,
      resolveDir: root,
      sourcefile: 'flow-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  });
  const links = STYLES.map((name) => `<link rel="stylesheet" href="file://${path.join(root, 'src/renderer', name)}">`).join('');
  const page = `<!doctype html><html><head>${links}</head><body style="margin:0"><div class="lt-panel"><div class="lt-root"><div class="lt-main lt-flow-on" id="pane" style="overflow:auto"><div class="lt-flow" id="host"></div></div></div></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  await writeFile(path.join(dir, 'flow.html'), page);
});

test.afterAll(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

async function measure(width: number) {
  const page = await (browser as Browser).newPage({ viewport: { width, height: 900 } });
  try {
    await page.goto(`file://${path.join(dir, 'flow.html')}`);
    return await page.evaluate(() => {
      const pane = document.getElementById('pane') as HTMLElement;
      const bounds = pane.getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.lt-flow-block, .lt-flow-file')].map((block) => block.getBoundingClientRect());
      const lines = [...document.querySelectorAll('.lt-flow-row')].map((row) => new Set([...row.querySelectorAll(':scope > .lt-flow-step')].map((step) => Math.round(step.getBoundingClientRect().top))).size);
      return { scrolls: pane.scrollWidth > pane.clientWidth, outside: blocks.filter((block) => block.left < bounds.left - 0.5 || block.right > bounds.right + 0.5).length, lines };
    });
  } finally {
    await page.close();
  }
}

test('the flow wraps its rows inside the right pane at its minimum width', async () => {
  test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
  const narrow = await measure(RIGHT_PANE_MIN);
  expect(narrow.scrolls).toBe(false);
  expect(narrow.outside).toBe(0);
  expect(Math.max(...narrow.lines)).toBeGreaterThan(1);
});

test('the same rows sit on one line when the pane is wide', async () => {
  test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
  const wide = await measure(900);
  expect(wide.scrolls).toBe(false);
  expect(wide.lines[0]).toBe(1);
});

async function styleOf(query: string, hoverPicked: boolean) {
  const page = await (browser as Browser).newPage({ viewport: { width: 900, height: 900 } });
  try {
    await page.goto(`file://${path.join(dir, 'flow.html')}${query}`);
    const block = page.locator(hoverPicked ? '.lt-flow-picked .lt-flow-block' : '.lt-flow-block[data-flow-step]').first();
    await block.hover();
    return await block.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.cssText = 'border:1px solid var(--lt-glow);background:var(--lt-glow-soft)';
      el.closest('.lt-root')!.append(probe);
      const want = getComputedStyle(probe);
      const got = getComputedStyle(el);
      const result = { border: got.borderTopColor, wantBorder: want.borderTopColor, background: got.backgroundColor, wantBackground: want.backgroundColor, shadow: got.boxShadow };
      probe.remove();
      return result;
    });
  } finally {
    await page.close();
  }
}

test('the picked step keeps its amber border, soft background and glow while the pointer is over it', async () => {
  test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
  const picked = await styleOf('?pick', true);
  expect(picked.wantBorder).toBe('rgb(255, 180, 34)');
  expect(picked.border).toBe(picked.wantBorder);
  expect(picked.background).toBe(picked.wantBackground);
  expect(picked.shadow).not.toBe('none');
});

test('a step that is only hovered gets the grey hover border, not the picked glow', async () => {
  test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
  const hovered = await styleOf('', false);
  expect(hovered.border).not.toBe(hovered.wantBorder);
});

test('a reading step and the rest of the flow are told apart by a badge and by lower contrast', async () => {
  test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
  const page = await (browser as Browser).newPage({ viewport: { width: 900, height: 900 } });
  try {
    await page.goto(`file://${path.join(dir, 'flow.html')}?read=src/checkout/order-summary.tsx`);
    const reading = page.locator('.lt-flow-reading .lt-flow-cell');
    const calm = page.locator('.lt-flow-step:not(.lt-flow-reading) .lt-flow-cell').first();
    expect(await reading.count()).toBe(2);
    expect(await page.locator('.lt-flow-reading-badge').count()).toBe(2);
    expect(await reading.first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(Number(await calm.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
    expect(Number(await calm.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.4);
  } finally {
    await page.close();
  }
});
