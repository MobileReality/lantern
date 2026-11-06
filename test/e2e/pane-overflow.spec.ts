import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness, loadGraphFixture } from './support/graph-harness';
import { VISIBLE_BODY, commentOnSelection, selectAddedLines } from './support/comments';
import { findClippedText } from './support/overflow';

const VIEWPORTS = ['1280x800', '1600x1000'];
const SETTLE_MS = 400;
const FIT_SLACK_PX = 2;
const LONG_WORD = 'calculateOrderTotalWithRegionalTaxRoundingAndCurrencyConversion';
const EXTREMES = [
  { name: 'both dividers at the start', left: 'Home', middle: 'Home' },
  { name: 'left column widest', left: 'End', middle: 'Home' },
  { name: 'file viewer widest', left: 'Home', middle: 'End' },
  { name: 'both dividers at the end', left: 'End', middle: 'End' },
];

interface Scenario {
  name: string;
  open: (harness: GraphHarness) => Promise<void>;
  fit?: string;
}

const ZOOM_FIT = '[data-zoom="fit"]';

const pickFirstNode = async (page: Page) => {
  await page.locator('.lt-pixi-node-access').first().dispatchEvent('click');
  await page.waitForTimeout(SETTLE_MS);
};

async function openAreasMacro(h: GraphHarness) {
  await loadGraphFixture(h, 'areas-pr', undefined, '', { macro: 'areas', project: '/e2e/pane-overflow' });
  await h.page.locator('.lt-review').waitFor();
  await h.page.getByRole('button', { name: /^Macro/ }).click();
  await h.page.locator('.lt-macroview').waitFor();
  await h.page.waitForTimeout(SETTLE_MS);
}

const SCENARIOS: Scenario[] = [
  { name: 'pull request in the three-pane review layout', open: async () => undefined },
  { name: 'pull request with the Explain sections', open: async (h) => loadGraphFixture(h, 'pr-review', undefined, '', { explain: '1' }) },
  {
    name: 'pull request with a saved comment card, a file comment and an open comment box',
    open: async (h) => {
      await loadGraphFixture(h, 'pr-review');
      await h.page.locator(`${VISIBLE_BODY} .cl.add`).nth(2).waitFor();
      await selectAddedLines(h.page, 2);
      await commentOnSelection(h.page, `Cover the tax rounding for every currency, including ${LONG_WORD}, and the zero-total path.`);
      await h.page.locator('.lt-review-head').getByRole('button', { name: 'Comment on this file' }).click();
      await h.page.locator('.lt-cm-file .lt-cm-box textarea').fill(`Rename the module. ${LONG_WORD}`);
      await h.page.keyboard.press('Control+Enter');
      await selectAddedLines(h.page, 3);
      await h.page.locator('.lt-cm-float').click();
      await h.page.locator('.lt-cm-box').getByRole('button', { name: 'Explain why this is needed.' }).click();
      await expect(h.page.locator('.lt-cm-box textarea')).toBeFocused();
    },
  },
  {
    name: 'areas macro with a system picked from the outside systems list and the side panel open',
    fit: ZOOM_FIT,
    open: async (h) => {
      await openAreasMacro(h);
      await h.page.locator('.mv-dock .mv-system').first().click();
      await h.page.locator('.lt-side .lt-detail .lt-sys-uses').first().waitFor();
      await h.page.waitForTimeout(SETTLE_MS);
    },
  },
  {
    name: 'areas macro with an area picked, so the outside systems list is filtered',
    fit: ZOOM_FIT,
    open: async (h) => {
      await openAreasMacro(h);
      await h.page.locator('.lt-macroview .mv-area > .mv-shape').first().click();
      await h.page.locator('.mv-dock-toggle:not([hidden])').waitFor();
      await h.page.waitForTimeout(SETTLE_MS);
    },
  },
  {
    name: 'file graph with a file selected in the side panel',
    open: async (h) => {
      await loadGraphFixture(h, 'large');
      await pickFirstNode(h.page);
    },
  },
];

async function moveDividers(page: Page, left: string, middle: string) {
  if ((await page.locator('.lt-split').count()) < 2) return;
  for (const [index, key] of [[0, left], [1, middle]] as const) {
    await page.locator('.lt-split').nth(index).focus();
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function graphOverflow(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('.lt-main') as HTMLElement;
    return main.scrollWidth - main.clientWidth;
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport}`, () => {
    let harness: GraphHarness;

    test.beforeAll(async () => {
      process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = viewport;
      harness = await launchGraphHarness('pr-review');
    });

    test.afterAll(async () => {
      delete process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT;
      const errors = harness.errors;
      try {
        await closeGraphHarness(harness);
      } finally {
        expect(errors).toEqual([]);
      }
    });

    for (const scenario of SCENARIOS) {
      test(`${scenario.name}: no text is cut off and the graph refits at both pane extremes`, async ({}, testInfo) => {
        const { page } = harness;
        await scenario.open(harness);
        await page.waitForTimeout(SETTLE_MS);
        for (const extreme of EXTREMES) {
          await moveDividers(page, extreme.left, extreme.middle);
          await page.screenshot({ path: testInfo.outputPath(`${extreme.name.replaceAll(' ', '-')}.png`) });
          expect(await findClippedText(page), extreme.name).toEqual([]);
          await page.locator(scenario.fit ?? '[data-zoom-fit]').click();
          expect(await graphOverflow(page), `${extreme.name}: Fit leaves content past the pane`).toBeLessThanOrEqual(FIT_SLACK_PX);
          await moveDividers(page, extreme.middle, extreme.left);
          expect(await graphOverflow(page), `${extreme.name}: the fitted graph did not follow the resize`).toBeLessThanOrEqual(FIT_SLACK_PX);
        }
      });
    }
  });
}
