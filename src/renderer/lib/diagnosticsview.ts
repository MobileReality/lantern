import {
  DIAGNOSTIC_SEVERITIES,
  DIAGNOSTIC_SEVERITY_LABEL,
  DIAGNOSTIC_SOURCES,
  DIAGNOSTIC_SOURCE_LABEL,
  type CopyOutcome,
  type DiagnosticEntry,
  type DiagnosticsListing,
  type GithubOutcome,
} from '../../shared/diagnostics';
import { ANY, NO_FILTER, applyFilter, mergeEntry, previousRun, severityCounts, type DiagnosticsFilter } from './diagnostics-model';
import { el, exactTime, timeAgo } from './util';

export interface DiagnosticsActions {
  copy(entryId?: string): Promise<CopyOutcome>;
  github(entryId?: string): Promise<GithubOutcome>;
}

export const GITHUB_OPENED = 'GitHub is open in your browser. Read the report there: nothing is sent until you submit the issue.';
export const GITHUB_CLIPBOARD = 'The report is too long for a link, so the full text is on your clipboard. Paste it into the issue before you submit.';
export const REPORT_FAILED = 'The report could not be built.';
export const EMPTY_LOG = 'Nothing has been recorded yet.';
export const NOTHING_MATCHES = 'No entries match these filters.';
export const PICK_ENTRY = 'Select an entry to see its details.';

export const copiedMessage = (count: number) => `Copied a report of ${count} ${count === 1 ? 'entry' : 'entries'}. Home folders, project folders and tokens are removed.`;

function select(label: string, options: [string, string][], onChange: (value: string) => void) {
  const wrap = el('label', 'dg-field');
  wrap.append(el('span', 'dg-field-label', label));
  const input = el('select', 'dg-select');
  for (const [value, text] of options) {
    const option = el('option', '', text);
    option.value = value;
    input.append(option);
  }
  input.addEventListener('change', () => onChange(input.value));
  wrap.append(input);
  return wrap;
}

function button(label: string, onClick: () => void, primary = false) {
  const node = el('button', primary ? 'dg-button dg-primary' : 'dg-button', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function createDiagnosticsView(root: HTMLElement, actions: DiagnosticsActions) {
  let entries: DiagnosticEntry[] = [];
  let session = '';
  let filter: DiagnosticsFilter = NO_FILTER;
  let selectedId: string | null = null;

  const severitySelect = select('Severity', [[ANY, 'All'], ...DIAGNOSTIC_SEVERITIES.map((s): [string, string] => [s, DIAGNOSTIC_SEVERITY_LABEL[s]])], (value) => {
    filter = { ...filter, severity: value as DiagnosticsFilter['severity'] };
    render();
  });
  const sourceSelect = select('Source', [[ANY, 'All'], ...DIAGNOSTIC_SOURCES.map((s): [string, string] => [s, DIAGNOSTIC_SOURCE_LABEL[s]])], (value) => {
    filter = { ...filter, source: value as DiagnosticsFilter['source'] };
    render();
  });
  const counts = el('span', 'dg-counts');
  const copyAll = button('Copy report', () => void run(actions.copy().then((r) => (r.ok ? copiedMessage(r.count) : REPORT_FAILED))));
  const githubAll = button('Report on GitHub', () => void run(openGithub()), true);
  const toolbar = el('div', 'dg-toolbar');
  toolbar.append(severitySelect, sourceSelect, counts, el('span', 'dg-spacer'), copyAll, githubAll);

  const status = el('p', 'dg-status');
  status.setAttribute('role', 'status');
  const list = el('ul', 'dg-list');
  list.setAttribute('aria-label', 'Recorded events, newest first');
  const detail = el('section', 'dg-detail');
  detail.setAttribute('aria-live', 'polite');
  const split = el('div', 'dg-split');
  split.append(list, detail);
  root.replaceChildren(toolbar, status, split);

  async function run(done: Promise<string>) {
    try {
      status.textContent = await done;
    } catch {
      status.textContent = REPORT_FAILED;
    }
  }

  async function openGithub(entryId?: string) {
    const outcome = await actions.github(entryId);
    if (!outcome.ok) return REPORT_FAILED;
    return outcome.copied ? GITHUB_CLIPBOARD : GITHUB_OPENED;
  }

  function row(entry: DiagnosticEntry) {
    const item = el('li', 'dg-item');
    const open = el('button', `dg-row dg-sev-${entry.severity}${entry.id === selectedId ? ' selected' : ''}`);
    open.type = 'button';
    open.setAttribute('aria-pressed', String(entry.id === selectedId));
    const when = el('span', 'dg-when', timeAgo(entry.time, Date.now()));
    when.dataset.tip = exactTime(entry.time);
    open.append(el('span', 'dg-badge', DIAGNOSTIC_SEVERITY_LABEL[entry.severity]), when, el('span', 'dg-source', DIAGNOSTIC_SOURCE_LABEL[entry.source]), el('span', 'dg-message', entry.message));
    if (previousRun(entry, session)) open.append(el('span', 'dg-earlier', 'earlier run'));
    open.addEventListener('click', () => {
      selectedId = entry.id;
      render();
    });
    item.append(open);
    return item;
  }

  function fact(label: string, value: string) {
    const group = el('div', 'dg-fact');
    group.append(el('dt', '', label), el('dd', '', value));
    return group;
  }

  function renderDetail(entry: DiagnosticEntry | undefined) {
    if (!entry) return detail.replaceChildren(el('p', 'dg-hint', PICK_ENTRY));
    const facts = el('dl', 'dg-facts');
    facts.append(
      fact('When', exactTime(entry.time)),
      fact('Severity', DIAGNOSTIC_SEVERITY_LABEL[entry.severity]),
      fact('Source', DIAGNOSTIC_SOURCE_LABEL[entry.source]),
      fact('Run', previousRun(entry, session) ? 'An earlier run' : 'This run'),
      fact('Lantern', `${entry.version} on ${entry.platform} ${entry.arch}`),
    );
    if (typeof entry.exitCode === 'number') facts.append(fact('Exit code', String(entry.exitCode)));
    if (entry.signal) facts.append(fact('Signal', entry.signal));
    const actionsRow = el('div', 'dg-actions');
    actionsRow.append(
      button('Copy this entry', () => void run(actions.copy(entry.id).then((r) => (r.ok ? copiedMessage(r.count) : REPORT_FAILED)))),
      button('Report this on GitHub', () => void run(openGithub(entry.id)), true),
    );
    const text = el('pre', 'dg-text', entry.detail ?? 'No further details were recorded.');
    text.tabIndex = 0;
    detail.replaceChildren(el('h3', 'dg-detail-title', entry.message), facts, actionsRow, text);
  }

  function render() {
    const visible = applyFilter(entries, filter);
    const totals = severityCounts(entries);
    counts.textContent = `${totals.fatal} crashes · ${totals.error} errors · ${totals.warning} warnings`;
    const empty = entries.length ? NOTHING_MATCHES : EMPTY_LOG;
    list.replaceChildren(...(visible.length ? visible.map(row) : [el('li', 'dg-empty', empty)]));
    renderDetail(entries.find((entry) => entry.id === selectedId));
  }

  render();
  return {
    setListing(listing: DiagnosticsListing) {
      entries = listing.entries;
      session = listing.session;
      render();
    },
    addEntry(entry: DiagnosticEntry) {
      entries = mergeEntry(entries, entry);
      render();
    },
    setStatus(text: string) {
      status.textContent = text;
    },
  };
}
