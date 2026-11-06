// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemorySnapshot, MemoryViewState } from '../src/shared/memory';

const HTML = fs.readFileSync(path.join(__dirname, '../src/renderer/workspace.html'), 'utf8');
const GB = 1024 ** 3;

const snapshot = (): MemorySnapshot => ({
  takenAt: 1,
  sampleMs: 700,
  totalBytes: 3 * GB,
  processCount: 4,
  installedBytes: 24 * GB,
  freePercent: 40,
  categories: [
    { category: 'app', bytes: GB, count: 2 },
    { category: 'editor', bytes: GB, count: 1 },
    { category: 'agents', bytes: GB, count: 1 },
    { category: 'other', bytes: 0, count: 0 },
  ],
  projects: [],
  processes: [],
  totalHistory: [],
  oldAndLargeCount: 0,
});

let pushUpdate: (snapshot: MemorySnapshot) => void;
let memoryWatch: ReturnType<typeof vi.fn>;
let onMemoryUpdate: ReturnType<typeof vi.fn>;

async function boot(state: MemoryViewState = { supported: true, snapshot: null }) {
  vi.resetModules();
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  doc.querySelectorAll('script').forEach((s) => { s.remove(); });
  document.body.innerHTML = doc.body.innerHTML;
  memoryWatch = vi.fn().mockResolvedValue(state);
  onMemoryUpdate = vi.fn((cb) => (pushUpdate = cb));
  window.ccmws = { memoryWatch, onMemoryUpdate } as unknown as Window['ccmws'];
  const { openMemory } = await import('../src/renderer/features/memory');
  const open = document.createElement('button');
  open.id = 'memory-open';
  open.addEventListener('click', () => void openMemory());
  document.body.append(open);
}

const modal = () => document.getElementById('memory-modal')!;
const body = () => document.getElementById('memory-body')!;
const openButton = () => document.getElementById('memory-open')!;
const isOpen = () => !modal().classList.contains('hidden');

beforeEach(() => boot());

describe('the Memory view in the workspace', () => {
  it('stays closed and does not sample until it is opened', () => {
    expect(isOpen()).toBe(false);
    expect(memoryWatch).not.toHaveBeenCalled();
    expect(onMemoryUpdate).not.toHaveBeenCalled();
  });

  it('opens from a button, starts sampling and shows a measuring state first', async () => {
    openButton().click();
    expect(isOpen()).toBe(true);
    expect(memoryWatch).toHaveBeenCalledWith(true);
    expect(body().textContent).toContain('Measuring');
    await vi.waitFor(() => expect(memoryWatch).toHaveReturned());
  });

  it('renders each reading the main process pushes while open', async () => {
    openButton().click();
    await vi.waitFor(() => expect(memoryWatch).toHaveReturned());
    pushUpdate(snapshot());
    expect(body().querySelector('.mem-total-value')?.textContent).toBe('3.00 GB');
  });

  it('stops sampling and clears the view when closed with the button', async () => {
    openButton().click();
    pushUpdate(snapshot());
    document.getElementById('memory-close')!.click();
    expect(isOpen()).toBe(false);
    expect(memoryWatch).toHaveBeenLastCalledWith(false);
    expect(body().childElementCount).toBe(0);
    pushUpdate(snapshot());
    expect(body().childElementCount).toBe(0);
  });

  it('stops sampling on Escape and on a click on the backdrop', () => {
    openButton().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isOpen()).toBe(false);
    expect(memoryWatch).toHaveBeenLastCalledWith(false);
    openButton().click();
    modal().click();
    expect(isOpen()).toBe(false);
    expect(memoryWatch).toHaveBeenLastCalledWith(false);
  });

  it('ignores Escape while closed', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(memoryWatch).not.toHaveBeenCalled();
  });

  it('does not draw a late answer after the view was closed', async () => {
    let answer: (state: MemoryViewState) => void = () => {};
    memoryWatch.mockImplementationOnce(() => new Promise<MemoryViewState>((resolve) => (answer = resolve)));
    openButton().click();
    document.getElementById('memory-close')!.click();
    answer({ supported: true, snapshot: snapshot() });
    await Promise.resolve();
    expect(body().childElementCount).toBe(0);
  });

  it('listens for pushes once however often it is reopened', () => {
    for (let i = 0; i < 3; i++) {
      openButton().click();
      document.getElementById('memory-close')!.click();
    }
    expect(onMemoryUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows the not-supported state on a platform without it', async () => {
    await boot({ supported: false });
    openButton().click();
    await vi.waitFor(() => expect(body().textContent).toContain('Not supported yet'));
  });

  it('is an accessible dialog with a focusable close button', () => {
    expect(modal().getAttribute('role')).toBe('dialog');
    expect(modal().getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById('memory-close')!.getAttribute('aria-label')).toBeTruthy();
  });
});
