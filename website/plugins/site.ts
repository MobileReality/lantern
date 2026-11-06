import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HtmlTagDescriptor, Plugin } from 'vite';

const LOGO_SOURCE = fileURLToPath(new URL('../../docs/assets/logo.png', import.meta.url));
const LOGO_FILE = 'logo.png';

export function normalizeBase(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

export function normalizeSiteUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  if (!/^https?:\/\//i.test(trimmed)) throw new Error(`DOCS_SITE_URL must start with http:// or https://, got "${raw}"`);
  return `${trimmed}/`;
}

function headTags(base: string, siteUrl: string | null): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [
    { tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: `${base}${LOGO_FILE}` }, injectTo: 'head' },
  ];
  if (siteUrl === null) return tags;
  const image = `${siteUrl}${LOGO_FILE}`;
  tags.push(
    { tag: 'link', attrs: { rel: 'canonical', href: siteUrl }, injectTo: 'head' },
    { tag: 'meta', attrs: { property: 'og:url', content: siteUrl }, injectTo: 'head' },
    { tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' },
  );
  return tags;
}

export function sitePlugin(base: string, siteUrl: string | null): Plugin {
  return {
    name: 'lantern-docs-site',
    configureServer(server) {
      server.middlewares.use(`${base}${LOGO_FILE}`, (_request, response) => {
        response.setHeader('Content-Type', 'image/png');
        response.end(readFileSync(LOGO_SOURCE));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LOGO_FILE, source: readFileSync(LOGO_SOURCE) });
    },
    transformIndexHtml() {
      return headTags(base, siteUrl);
    },
  };
}
