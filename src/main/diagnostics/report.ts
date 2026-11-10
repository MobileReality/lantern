import { DIAGNOSTIC_SEVERITY_LABEL, DIAGNOSTIC_SOURCE_LABEL, severityRank, type DiagnosticEntry } from '../../shared/diagnostics';
import { redactText, type RedactionContext } from './redact';

export interface ReportContext extends RedactionContext {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  node: string;
  packaged: boolean;
  now: () => number;
}

export const RECENT_ENTRY_COUNT = 30;
const SUMMARY_ENTRY_COUNT = 3;
const SUMMARY_LINE_CHARS = 200;
const INDENT = '    ';
const SERIOUS = severityRank('error');

function describeEntry(entry: DiagnosticEntry): string[] {
  const head = `[${entry.time}] ${DIAGNOSTIC_SEVERITY_LABEL[entry.severity]} · ${DIAGNOSTIC_SOURCE_LABEL[entry.source]}: ${entry.message}`;
  const facts = [
    typeof entry.exitCode === 'number' ? `exit code ${entry.exitCode}` : '',
    entry.signal ? `signal ${entry.signal}` : '',
    `Lantern ${entry.version}`,
  ].filter(Boolean);
  const detail = entry.detail ? entry.detail.split('\n').map((line) => `${INDENT}${line}`) : [];
  return [head, `${INDENT}${facts.join(' · ')}`, ...detail];
}

export function environmentLines(context: ReportContext): string[] {
  return [
    `Lantern version: ${context.version}${context.packaged ? '' : ' (run from source)'}`,
    `OS: ${context.platform} ${context.arch}`,
    `Electron: ${context.electron}`,
    `Node: ${context.node}`,
  ];
}

export const recentEntries = (all: DiagnosticEntry[], count = RECENT_ENTRY_COUNT) => all.slice(-count);

export function formatReport(entries: DiagnosticEntry[], context: ReportContext): string {
  const text = [
    'Lantern diagnostics report',
    `Generated: ${new Date(context.now()).toISOString()}`,
    ...environmentLines(context),
    `Entries: ${entries.length}`,
    '',
    ...(entries.length ? entries.flatMap((entry) => [...describeEntry(entry), '']) : ['No entries recorded.', '']),
    'Home folders, project folders and tokens are removed before a report is written.',
  ].join('\n');
  return redactText(text, context);
}

export function summarizeEntries(entries: DiagnosticEntry[], context: ReportContext): string {
  const serious = entries.filter((entry) => severityRank(entry.severity) >= SERIOUS);
  const picked = (serious.length ? serious : entries).slice(-SUMMARY_ENTRY_COUNT);
  const lines = picked.map((entry) => {
    const line = `- ${DIAGNOSTIC_SEVERITY_LABEL[entry.severity]} · ${DIAGNOSTIC_SOURCE_LABEL[entry.source]}: ${entry.message}`.replace(/\s+/g, ' ');
    return line.length > SUMMARY_LINE_CHARS ? `${line.slice(0, SUMMARY_LINE_CHARS - 1)}…` : line;
  });
  return redactText(lines.length ? lines.join('\n') : 'No entries recorded.', context);
}
