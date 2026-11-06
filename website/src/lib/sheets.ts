import { PAGES, type Page } from './pages';

export function sheetNumber(page: Page): number {
  return PAGES.indexOf(page) + 1;
}

export function sheetLabel(value: number): string {
  return String(value).padStart(2, '0');
}

export function neighbours(page: Page): { previous: Page | undefined; next: Page | undefined } {
  const index = PAGES.indexOf(page);
  return { previous: PAGES[index - 1], next: PAGES[index + 1] };
}
