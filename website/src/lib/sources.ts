const MARKDOWN_BY_KEY = import.meta.glob(
  [
    '../../../docs/index.md',
    '../../../docs/installation.md',
    '../../../docs/getting-started.md',
    '../../../docs/architecture.md',
    '../../../TROUBLESHOOTING.md',
    '../../../CONTRIBUTING.md',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const IMAGE_URL_BY_KEY = import.meta.glob('../../../docs/assets/*.{png,jpg,jpeg,gif,svg,webp}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function repoPathOf(key: string): string {
  return key.replace(/^(?:\.\.\/)+/, '');
}

function indexByRepoPath(byKey: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(byKey).map(([key, value]) => [repoPathOf(key), value]));
}

const MARKDOWN = indexByRepoPath(MARKDOWN_BY_KEY);
const IMAGE_URLS = indexByRepoPath(IMAGE_URL_BY_KEY);

export function markdownFor(file: string): string | undefined {
  return MARKDOWN.get(file);
}

export function imageUrlFor(path: string): string | undefined {
  return IMAGE_URLS.get(path);
}
