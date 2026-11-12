import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const DOCS_DOMAIN = 'docs.thelantern.dev\n';

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('docs domain', () => {
  it('publishes the docs site on docs.thelantern.dev through website/public/CNAME', () => {
    expect(fs.existsSync(path.join(ROOT, 'website/public/CNAME'))).toBe(true);
    expect(read('website/public/CNAME')).toBe(DOCS_DOMAIN);
  });
});
