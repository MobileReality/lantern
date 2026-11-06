import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'migrate-model.mjs');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => { fs.rmSync(root, { recursive: true, force: true }); }));

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-migrate-model-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const run = (root: string) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('migrate-model.mjs', () => {
  it('strips #model lines and "model" fields and leaves everything else as it was', () => {
    const root = project({
      '.lantern/map/src.lantern': 'lantern 1\r\n# src\r\n#model claude-sonnet-5-5\r\n\r\nsrc/a.ts . util abc\r\n  > src/b.ts#model\r\n#model gpt-6.1-sol\r\nsrc/b.ts . util def',
      '.lantern/sections/rbac.section': 'lantern-section 1\n# rbac\n#model claude-sonnet-5-5\n\nrole admin @ src/a.ts\n',
      '.lantern/lang/en/src.lantern.json': '{\r\n  "model": ["claude-sonnet-5-5", "gpt-6.1-sol"],\r\n  "text": {\r\n    "a.ts": "A.",\r\n    "a.ts > src/b.ts#model": "#model in a label",\r\n    "model": "a key named model"\r\n  }\r\n}\r\n',
      '.lantern/lang/en/platforms.json': '{\n "model": "claude-sonnet-5-5",\n "text": {\n  "watch": "Smartwatch"\n }\n}\n',
      '.lantern/lang/en/features.json': '{\n "text": {}\n}\n',
    });
    expect(run(root).stdout).toMatch(/from 4 file/);
    expect(read(root, '.lantern/map/src.lantern')).toBe('lantern 1\r\n# src\r\n\r\nsrc/a.ts . util abc\r\n  > src/b.ts#model\r\nsrc/b.ts . util def');
    expect(read(root, '.lantern/sections/rbac.section')).toBe('lantern-section 1\n# rbac\n\nrole admin @ src/a.ts\n');
    expect(read(root, '.lantern/lang/en/src.lantern.json')).toBe('{\r\n  "text": {\r\n    "a.ts": "A.",\r\n    "a.ts > src/b.ts#model": "#model in a label",\r\n    "model": "a key named model"\r\n  }\r\n}\r\n');
    expect(read(root, '.lantern/lang/en/platforms.json')).toBe('{\n "text": {\n  "watch": "Smartwatch"\n }\n}\n');
    expect(read(root, '.lantern/lang/en/features.json')).toBe('{\n "text": {}\n}\n');
    expect(run(root).stdout).toMatch(/nothing to migrate/);
  });

  it('refuses a root without a .lantern directory', () => {
    expect(run(project({ 'src/a.ts': '' })).status).toBe(2);
  });
});
