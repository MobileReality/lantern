import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionBody } from './helpers/source-blocks';

const main = readFileSync(join(__dirname, '../src/main/main.ts'), 'utf8');

describe('editor file-drop guard wiring', () => {
  it('attaches the guard to webview guests when a web contents is created', () => {
    const body = functionBody(main, 'hardenWebContents').text;
    expect(body).toMatch(/getType\(\)\s*===\s*'webview'\)\s*hardenGuestContents\(\s*contents\s*,/);
  });

  it('shows the notice through msg()', () => {
    const body = functionBody(main, 'hardenWebContents').text;
    expect(body).toContain("msg('editorDrop.title')");
    expect(body).toContain("msg('editorDrop.body')");
  });
});
