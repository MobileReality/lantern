export type Page = {
  route: string;
  file: string;
  label: string;
};

export const SITE_NAME = 'Lantern';
export const SITE_TITLE = 'Lantern documentation';

export const PAGES: readonly Page[] = [
  { route: '/', file: 'docs/index.md', label: 'Introduction' },
  { route: '/installation', file: 'docs/installation.md', label: 'Installation and command line' },
  { route: '/getting-started', file: 'docs/getting-started.md', label: 'Getting started' },
  { route: '/architecture', file: 'docs/architecture.md', label: 'Architecture' },
  { route: '/troubleshooting', file: 'TROUBLESHOOTING.md', label: 'Troubleshooting' },
  { route: '/contributing', file: 'CONTRIBUTING.md', label: 'Contributing' },
];

export const HOME_ROUTE = '/';

export function findPageByRoute(route: string): Page | undefined {
  return PAGES.find((page) => page.route === route);
}

export function findPageByFile(file: string): Page | undefined {
  return PAGES.find((page) => page.file === file);
}

export function pageTitle(page: Page): string {
  return page.route === HOME_ROUTE ? SITE_TITLE : `${page.label} · ${SITE_TITLE}`;
}
