import {
  LARGE_PROCESS_BYTES,
  MEMORY_CATEGORY_LABEL,
  MEMORY_SAMPLE_INTERVAL_MS,
  OLD_PROCESS_SECONDS,
  type MemoryCategoryRow,
  type MemoryProcess,
  type MemoryProjectRow,
  type MemorySnapshot,
  type MemoryViewState,
} from '../../shared/memory';
import { el } from './util';
import { formatAge, formatBytes, formatInstalled, formatShare, sparklinePoints } from './memoryformat';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SECONDS_PER_HOUR = 3600;
const MIN_BAR_PERCENT = 1.5;
const SPARK_WIDTH = 64;
const SPARK_HEIGHT = 18;
const UNATTRIBUTED = 'Unattributed';
const NO_VALUE = '—';

const th = (text: string, className = '') => {
  const cell = el('th', className, text);
  cell.scope = 'col';
  return cell;
};
const td = (text: string, className = '') => el('td', className, text);

function sparkline(series: number[], className: string) {
  const points = sparklinePoints(series, SPARK_WIDTH, SPARK_HEIGHT);
  if (!points) return el('span', 'mem-spark-empty', NO_VALUE);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `mem-spark ${className}`.trim());
  svg.setAttribute('viewBox', `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`);
  svg.setAttribute('width', String(SPARK_WIDTH));
  svg.setAttribute('height', String(SPARK_HEIGHT));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Memory over the last ${series.length} readings: from ${formatBytes(series[0])} to ${formatBytes(series[series.length - 1])}`);
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  svg.append(line);
  return svg;
}

function notice(title: string, text: string) {
  const box = el('div', 'mem-notice');
  box.append(el('h3', '', title), el('p', '', text));
  return box;
}

function headline(snapshot: MemorySnapshot) {
  const box = el('section', 'mem-headline');
  const total = el('div', 'mem-total');
  total.append(el('span', 'mem-total-value', formatBytes(snapshot.totalBytes)), el('span', 'mem-total-label', `Lantern and ${snapshot.processCount} processes it started`));
  const facts = el('dl', 'mem-facts');
  const fact = (label: string, value: string) => {
    const item = el('div', 'mem-fact');
    item.append(el('dt', '', label), el('dd', '', value));
    facts.append(item);
  };
  const installed = snapshot.installedBytes;
  fact('Share of RAM', installed ? `${formatShare(snapshot.totalBytes, installed)} of ${formatInstalled(installed)}` : NO_VALUE);
  fact('System free', snapshot.freePercent === null ? NO_VALUE : `${snapshot.freePercent}%`);
  box.append(total, facts, sparkline(snapshot.totalHistory, 'mem-spark-total'));
  return box;
}

function flagBanner(count: number) {
  const hours = OLD_PROCESS_SECONDS / SECONDS_PER_HOUR;
  const banner = el('p', 'mem-flag-banner', `${count} process${count === 1 ? ' is' : 'es are'} both old and large: running more than ${hours} h and using more than ${formatBytes(LARGE_PROCESS_BYTES)}.`);
  banner.setAttribute('role', 'status');
  return banner;
}

function barPercent(bytes: number, total: number) {
  if (total <= 0 || bytes <= 0) return 0;
  return Math.max(MIN_BAR_PERCENT, (bytes / total) * 100);
}

function categoryBars(rows: MemoryCategoryRow[], total: number) {
  const list = el('ul', 'mem-bars');
  list.setAttribute('aria-label', 'Memory by category');
  for (const row of rows) {
    const item = el('li', `mem-bar mem-cat-${row.category}`);
    const track = el('span', 'mem-bar-track');
    const fill = el('span', 'mem-bar-fill');
    fill.style.width = `${barPercent(row.bytes, total)}%`;
    track.append(fill);
    const count = `${row.count} process${row.count === 1 ? '' : 'es'}`;
    item.append(el('span', 'mem-bar-name', MEMORY_CATEGORY_LABEL[row.category]), track, el('span', 'mem-bar-value', formatBytes(row.bytes)), el('span', 'mem-bar-count', count));
    list.append(item);
  }
  return list;
}

function projectRow(row: MemoryProjectRow) {
  const tr = el('tr', row.project === null ? 'mem-unattributed' : '');
  const value = (bytes: number) => (bytes > 0 ? formatBytes(bytes) : NO_VALUE);
  tr.append(
    td(row.project ?? UNATTRIBUTED, 'mem-col-name'),
    td(value(row.hosts), 'mem-num mem-col-hosts'),
    td(value(row.agents), 'mem-num'),
    td(value(row.tsserver), 'mem-num mem-col-ts'),
    td(formatBytes(row.total), 'mem-num mem-col-sum'),
  );
  return tr;
}

function projectTable(rows: MemoryProjectRow[]) {
  const table = el('table', 'mem-table mem-projects');
  const head = el('tr', '');
  head.append(th('Project', 'mem-col-name'), th('Hosts', 'mem-num mem-col-hosts'), th('Agents', 'mem-num'), th('tsserver', 'mem-num mem-col-ts'), th('Total', 'mem-num mem-col-sum'));
  const thead = el('thead', '');
  thead.append(head);
  const tbody = el('tbody', '');
  tbody.append(...rows.map(projectRow));
  table.append(thead, tbody);
  return table;
}

function processRow(process: MemoryProcess) {
  const tr = el('tr', process.oldAndLarge ? 'mem-old-large' : '');
  const name = el('td', 'mem-col-name');
  name.append(el('span', 'mem-proc-name', process.name));
  const detail = process.label && process.label !== process.name ? `${process.label} · pid ${process.pid}` : `pid ${process.pid}`;
  name.append(el('span', 'mem-proc-detail', detail));
  if (process.oldAndLarge) name.append(el('span', 'mem-badge', 'old and large'));
  const spark = el('td', 'mem-col-trend');
  spark.append(sparkline(process.history, process.oldAndLarge ? 'mem-spark-hot' : ''));
  tr.append(name, td(process.project ?? UNATTRIBUTED, `mem-col-project${process.project === null ? ' mem-muted' : ''}`), td(formatAge(process.ageSeconds), 'mem-num mem-col-age'), td(formatBytes(process.bytes), 'mem-num mem-col-sum'), spark);
  return tr;
}

function processTable(rows: MemoryProcess[]) {
  const table = el('table', 'mem-table mem-processes');
  const head = el('tr', '');
  head.append(th('Process', 'mem-col-name'), th('Project', 'mem-col-project'), th('Age', 'mem-num mem-col-age'), th('Memory', 'mem-num mem-col-sum'), th('Trend', 'mem-col-trend'));
  const thead = el('thead', '');
  thead.append(head);
  const tbody = el('tbody', '');
  tbody.append(...rows.map(processRow));
  table.append(thead, tbody);
  return table;
}

function section(title: string, content: HTMLElement) {
  const box = el('section', 'mem-section');
  box.append(el('h3', 'mem-section-title', title), content);
  return box;
}

function footnote(snapshot: MemorySnapshot) {
  const seconds = MEMORY_SAMPLE_INTERVAL_MS / 1000;
  return el(
    'p',
    'mem-footnote',
    `Footprint as macOS reports it (the memory column of top), not resident size, so compressed memory is counted. Read every ${seconds} s only while this window is open; the last reading took ${Math.round(snapshot.sampleMs)} ms. Read-only: nothing here stops or restarts a process.`,
  );
}

function snapshotView(snapshot: MemorySnapshot) {
  const fragment = document.createDocumentFragment();
  fragment.append(headline(snapshot));
  if (snapshot.oldAndLargeCount > 0) fragment.append(flagBanner(snapshot.oldAndLargeCount));
  fragment.append(section('By category', categoryBars(snapshot.categories, snapshot.totalBytes)));
  fragment.append(section('By project', projectTable(snapshot.projects)));
  fragment.append(section('Largest processes', processTable(snapshot.processes)), footnote(snapshot));
  return fragment;
}

export function renderMemory(root: HTMLElement, state: MemoryViewState | null) {
  root.replaceChildren();
  if (state === null) return root.append(notice('Measuring…', 'The first reading takes about a second.'));
  if (!state.supported) return root.append(notice('Not supported yet', 'The memory view reads the footprint macOS reports for each process, so it is not available on Windows or Linux yet.'));
  if (!state.snapshot) return root.append(notice('Measuring…', 'The first reading takes about a second.'));
  root.append(snapshotView(state.snapshot));
}
