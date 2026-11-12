import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const overview = (page: Page): Locator => page.locator('.lt-overview');
const toggle = (page: Page): Locator => page.locator('.lt-viewbar .lt-overview-toggle');

async function openOverview(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
  await expect(overview(page)).toBeVisible();
}

async function closeOverview(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) === 'true') await toggle(page).click();
  await expect(overview(page)).toBeHidden();
}

export { closeOverview, openOverview, overview };
