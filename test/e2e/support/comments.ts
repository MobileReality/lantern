import type { Page } from '@playwright/test';

const VISIBLE_BODY = '.lt-review-body > .rv-code:not([hidden])';

async function selectAddedLines(page: Page, count: number) {
  return page.evaluate(
    ({ wanted, body }) => {
      const rows = [...document.querySelectorAll<HTMLElement>(`${body} .cl.add`)].slice(0, wanted);
      const first = rows[0].querySelector('.code') as HTMLElement;
      const last = rows[rows.length - 1].querySelector('.code') as HTMLElement;
      document.getSelection()?.setBaseAndExtent(first, 0, last, last.childNodes.length);
      document.querySelector('.lt-review-body')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return rows.map((row) => row.querySelectorAll('.ln')[1]?.textContent ?? '');
    },
    { wanted: count, body: VISIBLE_BODY },
  );
}

async function commentOnSelection(page: Page, text: string) {
  await page.locator('.lt-cm-float').click();
  const box = page.locator('.lt-cm-box');
  await box.locator('textarea').fill(text);
  await box.locator('textarea').press('Control+Enter');
}

async function recordClipboard(page: Page) {
  await page.evaluate(() => {
    const record = window as unknown as { copied: string[] };
    record.copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void record.copied.push(text) } });
  });
}

export { VISIBLE_BODY, commentOnSelection, recordClipboard, selectAddedLines };
