import type { DiagnosticInput } from '../../shared/diagnostics';
import { describeFailure } from './record';

type Handler = (...args: any[]) => unknown;

interface GuardedIpc {
  handle(channel: string, listener: Handler): unknown;
  on(channel: string, listener: Handler): unknown;
}

const isPromise = (value: unknown): value is Promise<unknown> => typeof (value as { then?: unknown } | null)?.then === 'function';

export function guardIpc(ipc: GuardedIpc, report: (input: DiagnosticInput) => void) {
  const fail = (channel: string, error: unknown) => {
    const failure = describeFailure(error);
    report({ source: 'ipc', severity: 'error', message: `A request on ${channel} failed: ${failure.message}`, detail: failure.detail });
  };
  const guard =
    (channel: string, listener: Handler): Handler =>
    (...args) => {
      try {
        const result = listener(...args);
        if (!isPromise(result)) return result;
        return result.catch((error) => {
          fail(channel, error);
          throw error;
        });
      } catch (error) {
        fail(channel, error);
        throw error;
      }
    };
  const handle = ipc.handle.bind(ipc);
  const on = ipc.on.bind(ipc);
  ipc.handle = (channel, listener) => handle(channel, guard(channel, listener));
  ipc.on = (channel, listener) => on(channel, guard(channel, listener));
}
