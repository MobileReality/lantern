import type { DiagnosticInput, DiagnosticSeverity } from '../../shared/diagnostics';
import { installEditorCapture } from './editor';
import { describeFailure } from './record';

type Report = (input: DiagnosticInput) => void;
type Listener = (...args: any[]) => void;

export interface Emitter {
  on(event: string, listener: Listener): unknown;
}

export interface ProcessGoneDetails {
  reason: string;
  exitCode?: number;
  type?: string;
  name?: string;
  serviceName?: string;
}

const CLEAN_EXIT = 'clean-exit';
const CRASH_REASONS = ['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit'];

const goneSeverity = (reason: string): DiagnosticSeverity => (CRASH_REASONS.includes(reason) ? 'fatal' : 'warning');

function goneInput(label: string, details: ProcessGoneDetails): DiagnosticInput | null {
  if (details.reason === CLEAN_EXIT) return null;
  return {
    source: label === 'window' ? 'render-process' : 'child-process',
    severity: goneSeverity(details.reason),
    message: `A ${label} process is gone: ${details.reason}`,
    ...(typeof details.exitCode === 'number' ? { exitCode: details.exitCode } : {}),
  };
}

export function installMainCapture({ proc, app, report }: { proc: Emitter; app: Emitter; report: Report }) {
  proc.on('uncaughtExceptionMonitor', (error: unknown, origin: string) => {
    const failure = describeFailure(error);
    report({ source: 'main', severity: 'fatal', message: failure.message, detail: `Origin: ${origin}\n${failure.detail ?? ''}`.trim() });
  });
  proc.on('unhandledRejection', (reason: unknown) => {
    const failure = describeFailure(reason);
    report({ source: 'main', severity: 'error', message: `Unhandled promise rejection: ${failure.message}`, detail: failure.detail });
    console.error('Unhandled promise rejection:', reason);
  });
  app.on('render-process-gone', (_event: unknown, _contents: unknown, details: ProcessGoneDetails) => {
    const input = goneInput('window', details);
    if (input) report(input);
  });
  app.on('child-process-gone', (_event: unknown, details: ProcessGoneDetails) => {
    const input = goneInput(`${details.type ?? details.name ?? details.serviceName ?? 'helper'}`, details);
    if (input) report({ ...input, source: 'child-process' });
  });
  const editorGuests = new WeakSet<object>();
  app.on('web-contents-created', (_event: unknown, contents: Emitter) => {
    contents.on('did-attach-webview', (_attached: unknown, guest: Emitter) => {
      if (editorGuests.has(guest)) return;
      editorGuests.add(guest);
      installEditorCapture({ guest, report });
    });
    contents.on('unresponsive', () => {
      if (!editorGuests.has(contents)) report({ source: 'render-process', severity: 'warning', message: 'A window stopped responding' });
    });
    contents.on('responsive', () => {
      if (!editorGuests.has(contents)) report({ source: 'render-process', severity: 'info', message: 'A window responds again' });
    });
  });
}
