import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionBody, ipcHandler, occurrences, within } from './helpers/source-blocks';

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
const WINDOWS = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'windows.ts'), 'utf8');

const REQUEST = 'editorDemand.request(';
const KEEP_WARM = 'editorDemand.keepWarm(';
const ON_DEMAND_CHANNELS = ['ws:need-editor', 'ws:restart-editor'];

describe('main.ts starts the editor server only on demand', () => {
  it('does not start or ask in init(), openWorkspace() or a project window', () => {
    const bodies = [functionBody(MAIN, 'init'), functionBody(MAIN, 'openWorkspace'), functionBody(WINDOWS, 'openProjectWindow')];
    for (const body of bodies) expect(body.text).not.toMatch(/editorDemand\.|launchEditor\(|startEditor|warmEditor|serveweb\.start/);
  });

  it('asks for the server only inside the need-editor and restart handlers, and each of them asks', () => {
    const handlers = ON_DEMAND_CHANNELS.map((channel) => ipcHandler(MAIN, channel));
    for (const handler of handlers) expect(handler.text, 'handler asks').toContain(REQUEST);
    const stray = occurrences(MAIN, REQUEST).filter((index) => !handlers.some((handler) => within(index, handler)));
    expect(stray, 'request() outside the on-demand handlers').toEqual([]);
  });

  it('hands launchEditor to the demand gate and calls it nowhere else', () => {
    expect(MAIN).toMatch(/createEditorDemand\(\s*launchEditor\s*\)/);
    const withoutGate = MAIN.replace(/function launchEditor\(/, '').replace(/createEditorDemand\(\s*launchEditor\s*\)/, '');
    expect(withoutGate).not.toContain('launchEditor');
  });

  it('only keeps the server warm from the scan, which waits for a first request', () => {
    const scan = functionBody(MAIN, 'runScan');
    const warm = occurrences(MAIN, KEEP_WARM);
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.filter((index) => !within(index, scan))).toEqual([]);
  });
});
