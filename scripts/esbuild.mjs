import esbuild from 'esbuild';
import { chmodSync, cpSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sourceAliases } from './aliases.cjs';
import { appManifest } from './app-manifest.mjs';
import { nodeBundle } from './node-bundle.mjs';
import { writeLicences } from './licenses.mjs';
import { buildLspRuntime } from './lsp-runtime.mjs';
import { generateFileIconAssets } from './material-file-icons.mjs';

const OUT = 'out';
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(OUT)) {
  if (entry !== 'lsp-runtime') rmSync(path.join(OUT, entry), { recursive: true, force: true });
}
mkdirSync(`${OUT}/preload`, { recursive: true });
buildLspRuntime();
generateFileIconAssets(`${OUT}/assets/file-icons`);

const base = nodeBundle;

await esbuild.build({ ...base, entryPoints: ['src/main/main.ts'], outfile: `${OUT}/main.js` });
await esbuild.build({ ...base, entryPoints: ['src/preload/workspace.ts'], outfile: `${OUT}/preload/workspace.js` });
await esbuild.build({ ...base, entryPoints: ['src/preload/overlay.ts'], outfile: `${OUT}/preload/overlay.js` });
await esbuild.build({ ...base, entryPoints: ['src/preload/tray-popover.ts'], outfile: `${OUT}/preload/tray-popover.js` });

const renderer = { bundle: true, platform: 'browser', target: 'es2022', format: 'iife', alias: sourceAliases(), loader: { '.svg': 'text' }, logLevel: 'info' };
await esbuild.build({ ...renderer, entryPoints: ['src/renderer/workspace.ts'], outfile: `${OUT}/renderer/workspace.js` });
await esbuild.build({ ...renderer, entryPoints: ['src/renderer/lib/syntax-worker.ts'], outfile: `${OUT}/renderer/syntax-worker.js` });
await esbuild.build({ ...renderer, entryPoints: ['src/renderer/overlay.ts'], outfile: `${OUT}/renderer/overlay.js` });
await esbuild.build({ ...renderer, entryPoints: ['src/renderer/tray-popover.ts'], outfile: `${OUT}/renderer/tray-popover.js` });

for (const f of ['theme.css', 'workspace.html', 'workspace.css', 'lantern.css', 'lantern-sections.css', 'lantern-prs.css', 'lantern-plans.css', 'lantern-review.css', 'lantern-flow.css', 'lantern-select.css', 'lantern-relation.css', 'lantern-macroview.css', 'lantern-setup.css', 'settings.css', 'command-palette.css', 'memory.css', 'integrations.css', 'overlay.html', 'overlay.css', 'tray-popover.html', 'tray-popover.css', 'floating.css']) {
  cpSync(`src/renderer/${f}`, `${OUT}/renderer/${f}`);
}
cpSync('src/renderer/fonts', `${OUT}/renderer/fonts`, { recursive: true });
cpSync('src/assets', `${OUT}/assets`, { recursive: true });
for (const entry of readdirSync('skills', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skipped = entry.name === 'lantern-setup' ? path.join('skills', entry.name, 'example-web') : null;
  cpSync(path.join('skills', entry.name), `${OUT}/skills/${entry.name}`, { recursive: true, filter: (src) => src !== skipped });
}
cpSync('src/notify-hooks', `${OUT}/notify-hooks`, { recursive: true });
cpSync('src/cli', `${OUT}/cli`, { recursive: true });
chmodSync(`${OUT}/cli/lantern`, 0o755);

const require = createRequire(import.meta.url);
const pkg = appManifest(require('electron/package.json').version, require('../package.json').version);
writeFileSync(`${OUT}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
writeLicences({ out: `${OUT}/licenses` });

console.log('esbuild: out/ ready');
