import type { RendererReportKind } from '../../shared/diagnostics';

export type RendererReporter = (report: { kind: RendererReportKind; message: string; stack?: string }) => unknown;

const BENIGN = /^ResizeObserver loop/;

interface ErrorLike {
  message?: unknown;
  stack?: unknown;
}

const describe = (value: unknown): { message: string; stack?: string } => {
  const error = (typeof value === 'object' && value !== null ? value : {}) as ErrorLike;
  const message = typeof error.message === 'string' && error.message ? error.message : typeof value === 'string' ? value : 'Unknown error';
  return { message, ...(typeof error.stack === 'string' ? { stack: error.stack } : {}) };
};

export function installRendererCapture(target: Pick<Window, 'addEventListener'>, report: RendererReporter) {
  const send = (input: Parameters<RendererReporter>[0]) => {
    try {
      Promise.resolve(report(input)).catch(() => {});
    } catch {
      // Reporting must never raise a second error.
    }
  };
  target.addEventListener('error', (event) => {
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '';
    const error = describe(event.error ?? event.message);
    if (BENIGN.test(error.message)) return;
    send({ kind: 'error', message: error.message, stack: error.stack ?? where });
  });
  target.addEventListener('unhandledrejection', (event) => {
    const error = describe(event.reason);
    send({ kind: 'unhandledrejection', message: error.message, stack: error.stack });
  });
}
