const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WILDCARD = /\/\*$/;

function sourceAliases() {
  const { compilerOptions } = JSON.parse(readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
  return Object.fromEntries(
    Object.entries(compilerOptions.paths).map(([pattern, [target]]) => [pattern.replace(WILDCARD, ''), path.resolve(ROOT, target.replace(WILDCARD, ''))]),
  );
}

module.exports = { sourceAliases };
