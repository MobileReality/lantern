import type { DiagnosticInput } from '../../shared/diagnostics';
import type { ServerPage } from '../serveweb-parse';

const SERIOUS_LINE = /\b(error|fatal|exception|failed|cannot|can't|EADDRINUSE|ENOENT|EACCES|EPERM|ENOTFOUND|ECONNREFUSED)\b|is not recognized/i;
const MAX_STDERR_ENTRIES = 40;
const MAX_LINE_CHARS = 600;
const SUPPRESSED = 'More editor server output was left out of the log.';
const WINDOWS_HINT = 'On Windows this usually means the VS Code command line tool is missing, blocked, or not the one Lantern expects.';

export type ServerReport = (input: DiagnosticInput) => void;

export function classifyServerLine(line: string): DiagnosticInput | null {
  const text = line.trim();
  if (!text) return null;
  const shown = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text;
  return { source: 'editor-server', severity: SERIOUS_LINE.test(text) ? 'error' : 'warning', message: `Editor server output: ${shown}` };
}

export function createServerOutputReporter(report: ServerReport, limit = MAX_STDERR_ENTRIES) {
  let reported = 0;
  return {
    push(line: string) {
      const input = classifyServerLine(line);
      if (!input) return;
      reported++;
      if (reported <= limit) report(input);
      else if (reported === limit + 1) report({ source: 'editor-server', severity: 'warning', message: SUPPRESSED });
    },
    reset() {
      reported = 0;
    },
  };
}

export function describeProbe(page: ServerPage | null, port: number): string {
  if (page === 'workbench') return `the editor answered on port ${port}`;
  if (page === 'downloading') return `the server was still downloading its build on port ${port}`;
  if (page === 'other') return `something answered on port ${port}, but it was not the VS Code editor`;
  return `nothing answered on port ${port}`;
}

export const commandText = (bin: string, args: string[]) => [bin, ...args].join(' ');

export interface ServerStop {
  code: number | null;
  signal: string | null;
  wasReady: boolean;
  platform: string;
  command: string;
  tail: string[];
}

export function describeServerStop(stop: ServerStop): DiagnosticInput | null {
  const clean = stop.code === 0 && !stop.signal;
  if (clean && stop.wasReady) return null;
  const how = stop.signal ? `was stopped by ${stop.signal}` : `exited with code ${stop.code}`;
  const when = stop.wasReady ? 'after it was ready' : 'before the editor was ready';
  const detail = [`Command: ${stop.command}`, stop.tail.length ? `Last output:\n${stop.tail.join('\n')}` : 'No output was printed.', stop.platform === 'win32' ? WINDOWS_HINT : '']
    .filter(Boolean)
    .join('\n');
  return {
    source: 'editor-server',
    severity: 'error',
    message: `The VS Code server ${how} ${when}`,
    detail,
    ...(typeof stop.code === 'number' ? { exitCode: stop.code } : {}),
    ...(stop.signal ? { signal: stop.signal } : {}),
  };
}

export function describeLaunchError(error: NodeJS.ErrnoException, command: string, platform: string): DiagnosticInput {
  const detail = [`Command: ${command}`, error.stack ?? error.message, platform === 'win32' ? WINDOWS_HINT : ''].filter(Boolean).join('\n');
  return { source: 'editor-server', severity: 'error', message: `The VS Code server could not be launched${error.code ? ` (${error.code})` : ''}: ${error.message}`, detail };
}
