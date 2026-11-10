import { chromium, expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const STYLES = ['workspace.css', 'lantern.css', 'lantern-sections.css', 'lantern-prs.css', 'lantern-review.css', 'lantern-flow.css', 'lantern-select.css', 'lantern-relation.css'];
let browser: Browser | null = null;
let dir = '';

const READABLE: Record<string, string[]> = {
  files: [
    '.lt-side .pr-title',
    '.lt-side .pr-meta',
    '.lt-side .pr-summary',
    '.lt-side .pr-file .pr-path',
    '.lt-side .pr-file .pr-reason',
    '.lt-review .lt-modal-reason .lt-reason-text',
    '.lt-review .rv-code .cl .code',
  ],
  flow: ['.lt-flow-title', '.lt-flow-text', '.lt-flow-old del', '.lt-flow-new strong', '.lt-flow-file', '.lt-viewbar .lt-flow-note'],
  macro: ['.lt-side .lt-prsum p', '.lt-side .lt-detail .lt-purpose', '.lt-side .lt-detail .lt-sentence'],
};

const CHROME: Record<string, string[]> = {
  files: ['.lt-viewbar button', '.lt-review-mode', '.lt-split', '.lt-prs .pr-chip', '.lt-side .pr-back', '.lt-review .cl .ln', '.lt-side .chip', '.lt-main canvas'],
  flow: ['.lt-flow-kind', '.lt-flow-tag', '.lt-viewbar [data-view="flow"]'],
  macro: ['.lt-side .chip', '.lt-viewbar [data-view="macro"]', '.lt-main canvas'],
};

test.beforeAll(async () => {
  try {
    browser = await chromium.launch({ executablePath: process.env.LANTERN_FLOW_CHROMIUM || undefined });
  } catch {
    browser = null;
  }
  dir = await mkdtemp(path.join(tmpdir(), 'lantern-text-select-'));
  const bundle = await build({
    stdin: {
      contents: `import { mountLanternView } from './src/renderer/lib/lanternview';
import { PR_ID, prReviewDemo, readDemoFile, readDemoPrDiff, readDemoPrFile, readDemoPrOverlay } from './test/fixtures/graph/pr-review-demo';
import macroView from './test/fixtures/lantern-macro-own-view.json';
import featureTexts from './.lantern/lang/en/features.json';
const filler = Array.from({ length: 130 }, (_, i) => ({ ...prReviewDemo.nodes[0], path: 'src/filler/f' + i + '.ts', dir: 'src/filler' }));
const map = { ...prReviewDemo, nodes: [...prReviewDemo.nodes, ...filler] };
const minStrongEdge = Math.min(...macroView.edges.filter((edge) => edge.strong).map((edge) => edge.count));
mountLanternView(document.getElementById('host'), map, {
  pr: PR_ID,
  readFile: readDemoFile,
  readPrFile: readDemoPrFile,
  readPrDiff: readDemoPrDiff,
  readPrOverlay: readDemoPrOverlay,
  readMacro: async () => ({ ok: true, view: macroView, texts: featureTexts.text, blockByPath: {}, minStrongEdge }),
});
document.querySelector('[data-pr-go="src/checkout/order-summary.tsx"]').click();
document.querySelector('.lt-review [data-review-mode="diff"]').click();`,
      resolveDir: root,
      sourcefile: 'select-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    loader: { '.json': 'json', '.svg': 'text' },
  });
  const links = STYLES.map((name) => `<link rel="stylesheet" href="file://${path.join(root, 'src/renderer', name)}">`).join('');
  const page = `<!doctype html><html><head>${links}</head><body style="margin:0"><main class="lt-panel" id="host"></main><script>${bundle.outputFiles[0].text}</script></body></html>`;
  await writeFile(path.join(dir, 'select.html'), page);
});

test.afterAll(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

async function open(view: 'files' | 'flow' | 'macro'): Promise<Page> {
  const page = await (browser as Browser).newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`file://${path.join(dir, 'select.html')}`);
  await page.locator('.lt-review .rv-code .cl .code').first().waitFor();
  if (view !== 'files') await page.locator(`.lt-viewbar [data-view="${view}"]`).click();
  if (view === 'macro') {
    await page.locator('.lt-side [data-macro-go]').first().waitFor();
    await page.locator('.lt-side [data-macro-go]').first().click();
    await page.locator('.lt-side .lt-detail .lt-purpose').waitFor();
  }
  return page;
}

function userSelects(page: Page, selectors: string[]) {
  return page.evaluate((list) => list.map((selector) => {
    const found = [...document.querySelectorAll(selector)];
    return { selector, count: found.length, values: [...new Set(found.map((el) => getComputedStyle(el).userSelect))] };
  }), selectors);
}

for (const view of ['files', 'flow', 'macro'] as const) {
  test(`the ${view} view lets its readable text be selected`, async () => {
    test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
    const page = await open(view);
    try {
      for (const found of await userSelects(page, READABLE[view])) {
        expect(found.count, `${found.selector} is on the page`).toBeGreaterThan(0);
        expect(found.values, found.selector).toEqual(['text']);
      }
    } finally {
      await page.close();
    }
  });

  test(`the ${view} view keeps its chrome unselectable`, async () => {
    test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
    const page = await open(view);
    try {
      for (const found of await userSelects(page, CHROME[view])) {
        if (found.count === 0) continue;
        expect(found.values, found.selector).toEqual(['none']);
      }
    } finally {
      await page.close();
    }
  });
}

test('the page itself stays unselectable and a drag over text selects it without clicking through', async () => {
  test.skip(!browser, 'no Chromium to launch: set LANTERN_FLOW_CHROMIUM to a Chromium binary');
  const page = await open('flow');
  try {
    expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).toBe('none');
    const block = page.locator('.lt-flow-block[data-flow-step]').first();
    const text = block.locator('.lt-flow-text');
    const box = (await text.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => String(getSelection()))).not.toBe('');
    await expect(block).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(block).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await page.close();
  }
});
