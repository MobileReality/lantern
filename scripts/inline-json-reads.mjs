import { readFileSync } from 'node:fs';
import path from 'node:path';

const JSON_READ = /(?:\w+\.)?readFileSync\(\s*new URL\('([^']+\.json)',\s*import\.meta\.url\),\s*'utf8'\s*\)/g;

export const inlineJsonReads = {
  name: 'inline-json-reads',
  setup(build) {
    build.onLoad({ filter: /\.mjs$/ }, ({ path: file }) => {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('import.meta.url')) return undefined;
      const contents = source.replace(JSON_READ, (_match, relative) => JSON.stringify(readFileSync(path.resolve(path.dirname(file), relative), 'utf8')));
      return { contents, loader: 'js' };
    });
  },
};
