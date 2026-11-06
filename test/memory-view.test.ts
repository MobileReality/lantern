// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LARGE_PROCESS_BYTES, OLD_PROCESS_SECONDS, type MemoryProcess, type MemorySnapshot } from '../src/shared/memory';
import { renderMemory } from '../src/renderer/lib/memoryview';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

const proc = (pid: number, extra: Partial<MemoryProcess> = {}): MemoryProcess => ({
  pid,
  category: 'editor',
  kind: 'tsserver',
  name: 'TypeScript server',
  label: 'tsserver.js',
  project: 'webapp',
  ageSeconds: 3600,
  bytes: 800 * MB,
  history: [700 * MB, 750 * MB, 800 * MB],
  oldAndLarge: false,
  ...extra,
});

const snapshot = (extra: Partial<MemorySnapshot> = {}): MemorySnapshot => ({
  takenAt: 1,
  sampleMs: 770,
  totalBytes: 6 * GB,
  processCount: 45,
  installedBytes: 24 * GB,
  freePercent: 43,
  categories: [
    { category: 'app', bytes: 2 * GB, count: 11 },
    { category: 'editor', bytes: 3 * GB, count: 24 },
    { category: 'agents', bytes: 1 * GB, count: 10 },
    { category: 'other', bytes: 0, count: 0 },
  ],
  projects: [
    { project: 'webapp', hosts: 200 * MB, agents: 300 * MB, tsserver: 1500 * MB, total: 2 * GB, count: 6 },
    { project: null, hosts: 0, agents: 0, tsserver: 0, total: 2 * GB, count: 24 },
  ],
  processes: [
    proc(11, { oldAndLarge: true, bytes: LARGE_PROCESS_BYTES + 400 * MB, ageSeconds: OLD_PROCESS_SECONDS + 7200 }),
    proc(12),
    proc(13, { project: null, history: [] }),
  ],
  totalHistory: [5 * GB, 6 * GB],
  oldAndLargeCount: 1,
  ...extra,
});

const root = document.createElement('div');
beforeEach(() => root.replaceChildren());
const text = () => root.textContent ?? '';

describe('the memory view', () => {
  it('says it is measuring before the first reading arrives', () => {
    renderMemory(root, null);
    expect(text()).toContain('Measuring');
    renderMemory(root, { supported: true, snapshot: null });
    expect(text()).toContain('Measuring');
  });

  it('shows a clear not-supported state instead of failing', () => {
    renderMemory(root, { supported: false });
    expect(text()).toContain('Not supported yet');
    expect(root.querySelector('table')).toBeNull();
  });

  it('shows the Lantern total, its share of RAM and the free percentage', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    expect(root.querySelector('.mem-total-value')?.textContent).toBe('6.00 GB');
    expect(text()).toContain('25% of 24 GB');
    expect(text()).toContain('43%');
  });

  it('draws one bar per category with its size', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    const bars = [...root.querySelectorAll('.mem-bar')];
    expect(bars.map((bar) => bar.querySelector('.mem-bar-name')?.textContent)).toEqual(['Lantern app', 'Editor server', 'Agents', 'Other children']);
    expect(bars[1].querySelector('.mem-bar-value')?.textContent).toBe('3.00 GB');
    expect((bars[1].querySelector('.mem-bar-fill') as HTMLElement).style.width).toBe('50%');
  });

  it('lists projects with an honest unattributed row', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    const rows = [...root.querySelectorAll('.mem-projects tbody tr')];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(['webapp', 'Unattributed']);
    expect(rows[1].classList.contains('mem-unattributed')).toBe(true);
  });

  it('highlights only the old and large process and explains the rule', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    const rows = [...root.querySelectorAll('.mem-processes tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.classList.contains('mem-old-large'))).toEqual([true, false, false]);
    expect(rows[0].querySelector('.mem-badge')?.textContent).toBe('old and large');
    expect(root.querySelector('.mem-flag-banner')?.textContent).toContain('more than 24 h');
    expect(root.querySelector('.mem-flag-banner')?.textContent).toContain('1.00 GB');
  });

  it('shows no banner when nothing is old and large', () => {
    renderMemory(root, { supported: true, snapshot: snapshot({ oldAndLargeCount: 0, processes: [proc(12)] }) });
    expect(root.querySelector('.mem-flag-banner')).toBeNull();
    expect(root.querySelector('.mem-old-large')).toBeNull();
  });

  it('shows friendly name, label, pid, project, age and memory per process, and a sparkline when there is history', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    const row = root.querySelectorAll('.mem-processes tbody tr')[1];
    expect(row.querySelector('.mem-proc-name')?.textContent).toBe('TypeScript server');
    expect(row.querySelector('.mem-proc-detail')?.textContent).toBe('tsserver.js · pid 12');
    expect(row.textContent).toContain('webapp');
    expect(row.textContent).toContain('1h 0m');
    expect(row.textContent).toContain('800 MB');
    expect(row.querySelector('svg.mem-spark polyline')?.getAttribute('points')).toBeTruthy();
    const noHistory = root.querySelectorAll('.mem-processes tbody tr')[2];
    expect(noHistory.querySelector('svg')).toBeNull();
    expect(noHistory.textContent).toContain('Unattributed');
  });

  it('states the footprint meaning, the sampling and that it is read-only', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    const note = root.querySelector('.mem-footnote')?.textContent ?? '';
    expect(note).toContain('not resident size');
    expect(note).toContain('every 5 s');
    expect(note).toContain('770 ms');
    expect(note).toContain('Read-only');
    expect(root.querySelectorAll('button')).toHaveLength(0);
  });

  it('replaces the previous reading instead of stacking', () => {
    renderMemory(root, { supported: true, snapshot: snapshot() });
    renderMemory(root, { supported: true, snapshot: snapshot() });
    expect(root.querySelectorAll('.mem-headline')).toHaveLength(1);
  });

  it('writes text only, never markup, even for odd project names', () => {
    const odd = snapshot({ projects: [{ project: '<img src=x onerror=alert(1)>', hosts: 0, agents: 0, tsserver: 0, total: MB, count: 1 }] });
    renderMemory(root, { supported: true, snapshot: odd });
    expect(root.querySelector('img')).toBeNull();
    expect(text()).toContain('<img src=x onerror=alert(1)>');
  });
});
