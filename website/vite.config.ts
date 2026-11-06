import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { checkLinksPlugin } from './plugins/check-links';
import { normalizeBase, normalizeSiteUrl, sitePlugin } from './plugins/site';

const base = normalizeBase(process.env.DOCS_BASE);
const siteUrl = normalizeSiteUrl(process.env.DOCS_SITE_URL);

export default defineConfig({
  base,
  plugins: [react(), sitePlugin(base, siteUrl), checkLinksPlugin()],
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1000 },
});
