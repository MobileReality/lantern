export const DIAGNOSTICS_REPORT_CHANNEL = 'diagnostics:report';
export const DIAGNOSTICS_LIST_CHANNEL = 'diagnostics:list';
export const DIAGNOSTICS_WATCH_CHANNEL = 'diagnostics:watch';
export const DIAGNOSTICS_UPDATE_CHANNEL = 'diagnostics:update';
export const DIAGNOSTICS_COPY_CHANNEL = 'diagnostics:copy';
export const DIAGNOSTICS_GITHUB_CHANNEL = 'diagnostics:github';
export const DIAGNOSTICS_NOTICE_CHANNEL = 'diagnostics:notice';
export const DIAGNOSTICS_DISMISS_CHANNEL = 'diagnostics:dismiss';

export const DIAGNOSTIC_SEVERITIES = ['info', 'warning', 'error', 'fatal'] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export const DIAGNOSTIC_SOURCES = ['app', 'main', 'renderer', 'render-process', 'child-process', 'ipc', 'editor-server'] as const;
export type DiagnosticSource = (typeof DIAGNOSTIC_SOURCES)[number];

export const DIAGNOSTIC_SOURCE_LABEL: Record<DiagnosticSource, string> = {
  app: 'Lantern',
  main: 'Main process',
  renderer: 'Window',
  'render-process': 'Window process',
  'child-process': 'Helper process',
  ipc: 'Window request',
  'editor-server': 'Editor server',
};

export const DIAGNOSTIC_SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  fatal: 'Crash',
};

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_DETAIL_CHARS = 8000;
export const MAX_ID_CHARS = 64;
export const LIST_LIMIT = 1000;

export const RENDERER_REPORT_KINDS = ['error', 'unhandledrejection'] as const;
export type RendererReportKind = (typeof RENDERER_REPORT_KINDS)[number];

export interface DiagnosticInput {
  source: DiagnosticSource;
  severity: DiagnosticSeverity;
  message: string;
  detail?: string;
  exitCode?: number;
  signal?: string;
}

export interface DiagnosticEntry extends DiagnosticInput {
  id: string;
  time: string;
  session: string;
  platform: string;
  arch: string;
  version: string;
}

export interface RendererReport {
  kind: RendererReportKind;
  message: string;
  stack?: string;
}

export interface ReportRequest {
  entryId?: string;
  crash?: boolean;
}

export interface CrashNotice {
  session: string;
  time: string;
  reason: 'fatal' | 'unclean-exit';
}

export interface DiagnosticsListing {
  entries: DiagnosticEntry[];
  session: string;
}

export interface GithubOutcome {
  ok: boolean;
  copied: boolean;
  truncated: boolean;
}

export interface CopyOutcome {
  ok: boolean;
  count: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

export const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

export function parseRendererReport(value: unknown): RendererReport | null {
  if (!isRecord(value)) return null;
  const { kind, message, stack } = value;
  if (!isOneOf(RENDERER_REPORT_KINDS, kind)) return null;
  if (typeof message !== 'string' || !message.trim()) return null;
  if (stack !== undefined && typeof stack !== 'string') return null;
  return { kind, message: clip(message, MAX_MESSAGE_CHARS), ...(stack ? { stack: clip(stack, MAX_DETAIL_CHARS) } : {}) };
}

export function parseReportRequest(value: unknown): ReportRequest | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  const { entryId, crash } = value;
  if (entryId !== undefined && (typeof entryId !== 'string' || !entryId || entryId.length > MAX_ID_CHARS)) return null;
  if (crash !== undefined && typeof crash !== 'boolean') return null;
  return { ...(entryId !== undefined ? { entryId } : {}), ...(crash ? { crash } : {}) };
}

export function parseEntry(value: unknown): DiagnosticEntry | null {
  if (!isRecord(value)) return null;
  const { id, time, session, source, severity, message, detail, exitCode, signal, platform, arch, version } = value;
  if (typeof id !== 'string' || typeof time !== 'string' || typeof session !== 'string' || typeof message !== 'string') return null;
  if (typeof platform !== 'string' || typeof arch !== 'string' || typeof version !== 'string') return null;
  if (!isOneOf(DIAGNOSTIC_SOURCES, source) || !isOneOf(DIAGNOSTIC_SEVERITIES, severity)) return null;
  if (Number.isNaN(Date.parse(time))) return null;
  return {
    id,
    time,
    session,
    source,
    severity,
    message,
    platform,
    arch,
    version,
    ...(typeof detail === 'string' ? { detail } : {}),
    ...(typeof exitCode === 'number' ? { exitCode } : {}),
    ...(typeof signal === 'string' ? { signal } : {}),
  };
}

export const severityRank = (severity: DiagnosticSeverity) => DIAGNOSTIC_SEVERITIES.indexOf(severity);
