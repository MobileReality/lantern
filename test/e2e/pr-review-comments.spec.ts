import { expect, test } from '@playwright/test';
import type { GraphHarness } from './support/graph-harness';
import { closeGraphHarness, launchGraphHarness } from './support/graph-harness';
import { VISIBLE_BODY, commentOnSelection, recordClipboard, selectAddedLines } from './support/comments';

const LAPTOP_VIEWPORT = '1280x800';
const FILE = 'src/checkout/order-summary.tsx';
let harness: GraphHarness;

test.beforeAll(async () => {
  process.env.LANTERN_GRAPH_PERFORMANCE_VIEWPORT = LAPTOP_VIEWPORT;
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

async function geometry(page: import('@playwright/test').Page) {
  return page.evaluate((body) => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const review = rect('.lt-review');
    const card = rect(`${body} .lt-cm-card`);
    const row = [...document.querySelectorAll(`${body} .cl.add`)].find((each) => each.nextElementSibling?.classList.contains('lt-cm-card'))?.getBoundingClientRect();
    return {
      pageWidth: document.documentElement.scrollWidth,
      windowWidth: document.documentElement.clientWidth,
      reviewRight: review?.right ?? 0,
      reviewBottom: review?.bottom ?? 0,
      cardRight: card?.right ?? 0,
      cardLeft: card?.left ?? 0,
      cardTop: card?.top ?? 0,
      rowBottom: row?.bottom ?? 0,
    };
  }, VISIBLE_BODY);
}

test('comments on diff lines and on the whole file, shows them in the code, copies them and keeps them over a reload', async ({}, testInfo) => {
  const page = harness.page;
  await expect(page.locator('.lt-review .lt-code-path')).toContainText('order-summary.tsx');
  await expect(page.locator('.lt-fixes')).toHaveCount(0);
  await expect(page.locator('.lt-cm-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Copy all' })).toBeDisabled();

  await expect(page.locator(`${VISIBLE_BODY} .cl.add`).nth(1)).toBeVisible();
  const lines = await selectAddedLines(page, 2);
  await expect(page.locator('.lt-cm-float')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('1-selection-button.png') });
  await page.locator('.lt-cm-float').click();
  const box = page.locator('.lt-cm-box');
  await expect(box.locator('textarea')).toBeFocused();
  await expect(box.locator('.lt-cm-box-title')).toHaveText(`Comment on lines ${lines[0]}–${lines[1]}`);
  await expect(page.locator(`${VISIBLE_BODY} .cl.lt-cm-live`)).toHaveCount(2);
  await box.getByRole('button', { name: 'Add a test for this.' }).click();
  await box.locator('textarea').pressSequentially(' Cover the tax rounding.');
  await page.screenshot({ path: testInfo.outputPath('2-comment-box.png') });
  await box.locator('textarea').press('Control+Enter');

  const card = page.locator(`${VISIBLE_BODY} .lt-cm-card`);
  await expect(card).toHaveCount(1);
  await expect(card.locator('.lt-cm-card-text')).toHaveText('Add a test for this. Cover the tax rounding.');
  const under = await page.evaluate((body) => (document.querySelector(`${body} .lt-cm-card`)?.previousElementSibling?.querySelectorAll('.ln')[1]?.textContent ?? ''), VISIBLE_BODY);
  expect(under).toBe(lines[1]);
  const size = await geometry(page);
  expect(size.cardTop).toBeGreaterThanOrEqual(size.rowBottom - 1);
  expect(size.cardLeft).toBeGreaterThanOrEqual(0);
  expect(size.cardRight).toBeLessThanOrEqual(size.reviewRight);
  expect(size.pageWidth).toBeLessThanOrEqual(size.windowWidth);
  await expect(page.locator('.lt-cm-count')).toHaveText('1');
  await page.screenshot({ path: testInfo.outputPath('3-card-under-line.png') });

  await page.locator('.lt-review-head').getByRole('button', { name: 'Comment on this file' }).click();
  await expect(page.locator('.lt-cm-file .lt-cm-box textarea')).toBeFocused();
  await page.locator('.lt-cm-file .lt-cm-box textarea').fill('Rename the module.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.lt-cm-file .lt-cm-card .lt-cm-card-text')).toHaveText('Rename the module.');
  await expect(page.locator('.lt-cm-count')).toHaveText('2');
  await page.screenshot({ path: testInfo.outputPath('4-file-comment.png') });

  await page.getByRole('button', { name: /^Comments, 2 comments$/ }).click();
  await expect(page.locator('.lt-cm-pop .lt-cm-pop-item')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('5-comment-list.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.lt-cm-pop')).toBeHidden();

  await recordClipboard(page);
  await page.getByRole('button', { name: 'Copy all' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied).toHaveLength(1);
  expect(copied[0].split('\n')[0]).toMatch(/^Review comments for PR #\S+: .+ \(.+\)$/);
  expect(copied[0].split('\n')[1]).toBe('Work within this pull request only: stay on its branch and inside the code it changes.');
  expect(copied[0]).toContain(`${FILE}\nComment: Rename the module.\nIntent: Fix.`);
  expect(copied[0]).toContain(`${FILE}:${lines[0]}-${lines[1]}\n\`\`\`\n`);
  expect(copied[0]).toContain('\n```\nComment: Add a test for this. Cover the tax rounding.\nIntent: Fix.');

  await page.reload();
  await page.locator('html[data-graph-settled="true"]').waitFor();
  await expect(page.locator('.lt-cm-count')).toHaveText('2');
  await expect(page.locator('.lt-cm-file .lt-cm-card .lt-cm-card-text')).toHaveText('Rename the module.');
  await expect(page.locator(`${VISIBLE_BODY} .lt-cm-card .lt-cm-card-text`)).toHaveText('Add a test for this. Cover the tax rounding.');
  const after = await page.evaluate((body) => document.querySelector(`${body} .lt-cm-card`)?.previousElementSibling?.querySelectorAll('.ln')[1]?.textContent ?? '', VISIBLE_BODY);
  expect(after).toBe(lines[1]);
  await page.screenshot({ path: testInfo.outputPath('6-after-reload.png') });
});

test('shows the same card in the File view and the Diff view, and the gutter plus comments on a line', async ({}, testInfo) => {
  const page = harness.page;
  await page.locator('.lt-review-mode[data-review-mode="file"]').click();
  await expect(page.locator('.lt-review-body > .rv-code:not([hidden]) .lt-cm-card')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('7-file-view.png') });

  const row = page.locator(`${VISIBLE_BODY} .cl`).nth(2);
  await row.hover();
  const plus = page.locator(`${VISIBLE_BODY} .lt-cm-add`);
  await expect(plus).toBeVisible();
  await plus.click();
  await expect(page.locator('.lt-cm-box textarea')).toBeFocused();
  await expect(page.locator('.lt-cm-box .lt-cm-box-title')).toHaveText('Comment on line 3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lt-cm-box')).toBeHidden();
  await expect(plus).toBeFocused();

  const rows = page.locator(`${VISIBLE_BODY} .cl`);
  await rows.nth(1).hover();
  const start = await plus.boundingBox();
  const end = await rows.nth(3).boundingBox();
  if (!start || !end) throw new Error('rows are not laid out');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 4 });
  await expect(page.locator(`${VISIBLE_BODY} .cl.lt-cm-live`)).toHaveCount(3);
  await page.mouse.up();
  await expect(page.locator('.lt-cm-box .lt-cm-box-title')).toHaveText('Comment on lines 2–4');
  await page.screenshot({ path: testInfo.outputPath('8-gutter-drag.png') });
  await page.keyboard.press('Escape');
});

test('edits and deletes a card with the keyboard and folds it', async () => {
  const page = harness.page;
  await page.locator('.lt-review-mode[data-review-mode="diff"]').click();
  const card = page.locator(`${VISIBLE_BODY} .lt-cm-card`);
  await card.getByRole('button', { name: /^Edit the comment on lines/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.lt-cm-box textarea')).toBeFocused();
  await page.locator('.lt-cm-box textarea').fill('Cover rounding and zero tax.');
  await page.keyboard.press('Control+Enter');
  await expect(card.locator('.lt-cm-card-text')).toHaveText('Cover rounding and zero tax.');
  await expect(card.getByRole('button', { name: /^Edit the comment on lines/ })).toBeFocused();

  await card.getByRole('button', { name: /^Collapse the comment/ }).click();
  await expect(card).toHaveClass(/lt-cm-collapsed/);
  await card.getByRole('button', { name: /^Expand the comment/ }).click();

  await card.getByRole('button', { name: /^Delete the comment on lines/ }).click();
  await expect(page.locator('.lt-cm-count')).toHaveText('1');
  await expect(card).toHaveCount(0);
});

test('marks a comment as a question and copies a mixed set, then all as questions with a default', async ({}, testInfo) => {
  const page = harness.page;
  const path = await page.locator('.lt-review .lt-code-path').textContent();
  await page.locator('.lt-review-mode[data-review-mode="diff"]').click();
  await expect(page.locator(`${VISIBLE_BODY} .cl.add`).nth(1)).toBeVisible();
  await selectAddedLines(page, 1);
  await page.locator('.lt-cm-float').click();

  const box = page.locator('.lt-cm-box');
  const choice = box.getByRole('radiogroup', { name: 'Intent' });
  await expect(choice.getByRole('radio')).toHaveCount(3);
  await expect(choice.getByRole('radio', { name: 'Fix' })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('9-intent-choice.png') });
  await choice.getByRole('radio', { name: 'Fix' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(choice.getByRole('radio', { name: 'Explain' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(choice.getByRole('radio', { name: 'Question' })).toBeChecked();
  await expect(page.locator('.lt-review .lt-code-path')).toHaveText(path ?? '');
  await box.locator('textarea').fill('We have this flow and I do not know what it is for.');
  await box.locator('textarea').press('Control+Enter');

  const card = page.locator(`${VISIBLE_BODY} .lt-cm-card`);
  await expect(card.locator('.lt-cm-tag')).toHaveText('Question');
  await expect(page.locator('.lt-cm-file .lt-cm-card .lt-cm-tag')).toHaveCount(0);
  await expect(page.locator('.lt-cm-count')).toHaveText('2');
  expect((await geometry(page)).pageWidth).toBeLessThanOrEqual((await geometry(page)).windowWidth);
  await page.screenshot({ path: testInfo.outputPath('10-question-card.png') });

  await recordClipboard(page);
  await page.getByRole('button', { name: 'Copy all' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const mixed = await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
  expect(mixed).toContain('Work within this pull request only');
  expect(mixed).toContain('These comments differ. Follow the instruction on each one:\n- Fix: ');
  expect(mixed).toContain('- Question: Answer this question without changing any code.');
  expect(mixed).not.toContain('- Explain: ');
  expect(mixed).toContain('Comment: We have this flow and I do not know what it is for.\nIntent: Question. Answer this question without changing any code.');
  expect(mixed).toContain(`${FILE}\nComment: Rename the module.\nIntent: Fix.`);

  const copyAs = page.getByRole('combobox', { name: 'Copy all, default intent' });
  await expect(copyAs).toHaveValue('per-comment');
  await copyAs.selectOption('question');
  await page.screenshot({ path: testInfo.outputPath('11-copy-default.png') });
  await recordClipboard(page);
  await page.getByRole('button', { name: 'Copy all' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const questions = await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
  expect(questions).toContain(`${FILE}\nComment: Rename the module.\nIntent: Question.`);
  expect(questions).not.toContain('These comments differ');
  expect(questions).not.toMatch(/\bfix\b/i);

  await page.reload();
  await page.locator('html[data-graph-settled="true"]').waitFor();
  await expect(page.getByRole('combobox', { name: 'Copy all, default intent' })).toHaveValue('question');
  await expect(page.locator('.lt-cm-tag')).toHaveText('Question');
  await page.getByRole('combobox', { name: 'Copy all, default intent' }).selectOption('per-comment');
});
