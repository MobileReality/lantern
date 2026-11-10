import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiagnosticsService, type DiagnosticsService, type ServiceDeps } from '../../src/main/diagnostics/service';
import type { ReportContext } from '../../src/main/diagnostics/report';
import type { DiagnosticEntry } from '../../src/shared/diagnostics';

export const HOME = '/Users/jane';
export const PROJECT = '/Users/jane/work/secret-client';
const START = Date.parse('2026-11-10T10:00:00.000Z');

export function makeClock(start = START) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

export function makeLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-diagnostics-'));
}

export function startService(dir: string, clock = makeClock(), overrides: Partial<ServiceDeps> = {}): DiagnosticsService {
  const service = createDiagnosticsService({
    file: path.join(dir, 'diagnostics', 'events.jsonl'),
    platform: 'win32',
    arch: 'x64',
    version: '0.2.2',
    electron: '45.2.2',
    node: '24.0.0',
    packaged: true,
    home: HOME,
    projects: () => [PROJECT],
    now: clock.now,
    ...overrides,
  });
  service.begin();
  return service;
}

export function reportContext(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    version: '0.2.2',
    platform: 'win32',
    arch: 'x64',
    electron: '45.2.2',
    node: '24.0.0',
    packaged: true,
    home: HOME,
    projects: () => [PROJECT],
    now: () => START,
    ...overrides,
  };
}

export function entry(overrides: Partial<DiagnosticEntry> = {}): DiagnosticEntry {
  return {
    id: 'a1',
    time: new Date(START).toISOString(),
    session: 's1',
    source: 'main',
    severity: 'error',
    message: 'Something failed',
    platform: 'win32',
    arch: 'x64',
    version: '0.2.2',
    ...overrides,
  };
}
