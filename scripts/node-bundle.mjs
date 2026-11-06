import { sourceAliases } from './aliases.cjs';
import { inlineJsonReads } from './inline-json-reads.mjs';

export const nodeBundle = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['electron'],
  // jsonc-parser's UMD `main` requires its modules dynamically, which esbuild cannot follow.
  alias: { ...sourceAliases(), 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' },
  plugins: [inlineJsonReads],
  logLevel: 'info',
};
