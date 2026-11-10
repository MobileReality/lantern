import type { DiagnosticInput } from '../../shared/diagnostics';
import { installMainCapture, type Emitter } from './capture';
import { createDiagnosticsService, type DiagnosticsService, type ServiceDeps } from './service';

let current: DiagnosticsService | null = null;

export function reportDiagnostic(input: DiagnosticInput): void {
  current?.record(input);
}

export function currentDiagnostics(): DiagnosticsService | null {
  return current;
}

export function startDiagnostics(deps: ServiceDeps & { proc: Emitter; app: Emitter }): DiagnosticsService {
  const { proc, app, ...serviceDeps } = deps;
  current = createDiagnosticsService({ ...serviceDeps, onError: serviceDeps.onError ?? ((error) => console.error('Diagnostics log failed:', error.message)) });
  current.begin();
  installMainCapture({ proc, app, report: reportDiagnostic });
  return current;
}
