import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
const WINDOWS = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'windows.ts'), 'utf8');

function bodyOf(source: string, header: string) {
  const start = source.indexOf(header);
  expect(start, `${header} exists`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end);
}

function handlerOf(channel: string) {
  const start = MAIN.indexOf(`ipcMain.handle('${channel}'`);
  expect(start, `${channel} handler exists`).toBeGreaterThan(-1);
  return MAIN.slice(start, MAIN.indexOf('}));', start));
}

describe('main.ts starts the editor server only on demand', () => {
  it('does not start or ask in init(), openWorkspace() or a project window', () => {
    for (const body of [bodyOf(MAIN, 'async function init() {'), bodyOf(MAIN, 'function openWorkspace() {'), bodyOf(WINDOWS, 'function openProjectWindow(')]) {
      expect(body).not.toMatch(/editorDemand\.|launchEditor\(|startEditor|warmEditor|serveweb\.start/);
    }
  });

  it('reaches the server start from the need-editor and restart channels alone', () => {
    expect(handlerOf('ws:need-editor')).toContain('editorDemand.request()');
    expect(handlerOf('ws:restart-editor')).toContain('editorDemand.request()');
    expect([...MAIN.matchAll(/editorDemand\.request\(\)/g)]).toHaveLength(2);
    expect([...MAIN.matchAll(/launchEditor\(/g)]).toHaveLength(1);
    expect(MAIN).toContain('createEditorDemand(launchEditor)');
  });

  it('only keeps the server warm from the scan, which waits for a first request', () => {
    expect([...MAIN.matchAll(/editorDemand\.keepWarm\(\)/g)]).toHaveLength(1);
    expect(bodyOf(MAIN, 'function runScan() {')).toContain('editorDemand.keepWarm()');
  });
});
