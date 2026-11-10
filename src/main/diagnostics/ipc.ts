import {
  DIAGNOSTICS_COPY_CHANNEL,
  DIAGNOSTICS_DISMISS_CHANNEL,
  DIAGNOSTICS_GITHUB_CHANNEL,
  DIAGNOSTICS_NOTICE_CHANNEL,
  DIAGNOSTICS_REPORT_CHANNEL,
  DIAGNOSTICS_UPDATE_CHANNEL,
  DIAGNOSTICS_WATCH_CHANNEL,
  parseRendererReport,
  parseReportRequest,
  type CopyOutcome,
  type CrashNotice,
  type DiagnosticEntry,
  type GithubOutcome,
  type ReportRequest,
} from '../../shared/diagnostics';
import { composeIssue, isIssueUrl, planIssue } from './github';
import { formatReport, recentEntries } from './report';
import type { DiagnosticsService } from './service';

type Handler = (event: any, ...args: any[]) => unknown;

export interface Viewer {
  isDestroyed(): boolean;
  send(channel: string, payload: DiagnosticEntry): void;
  once(event: string, listener: () => void): unknown;
}

export interface DiagnosticsIpcDeps {
  handle(channel: string, listener: Handler): void;
  fromWorkspace(fn: Handler): Handler;
  service: DiagnosticsService;
  writeClipboard(text: string): void;
  openExternal(url: string): Promise<unknown> | unknown;
}

const REJECTED = { ok: false } as const;
const MAX_NOTICE_ENTRIES = 30;

export function registerDiagnosticsIpc({ handle, fromWorkspace, service, writeClipboard, openExternal }: DiagnosticsIpcDeps) {
  const watching = new Map<Viewer, () => void>();

  function unwatch(viewer: Viewer) {
    watching.get(viewer)?.();
    watching.delete(viewer);
  }

  function watch(viewer: Viewer) {
    if (watching.has(viewer) || viewer.isDestroyed()) return;
    watching.set(
      viewer,
      service.subscribe((entry) => {
        if (viewer.isDestroyed()) unwatch(viewer);
        else viewer.send(DIAGNOSTICS_UPDATE_CHANNEL, entry);
      }),
    );
    viewer.once('destroyed', () => unwatch(viewer));
  }

  function entriesFor(request: ReportRequest): DiagnosticEntry[] | null {
    if (request.entryId) {
      const entry = service.find(request.entryId);
      return entry ? [entry] : null;
    }
    const notice: CrashNotice | null = request.crash ? service.pendingNotice() : null;
    const all = service.listing().entries;
    if (notice) return recentEntries(all.filter((entry) => entry.session === notice.session), MAX_NOTICE_ENTRIES);
    return recentEntries(all);
  }

  handle(
    DIAGNOSTICS_REPORT_CHANNEL,
    fromWorkspace((_e, payload: unknown) => {
      const report = parseRendererReport(payload);
      if (!report) return REJECTED;
      service.record({ source: 'renderer', severity: 'error', message: report.message, detail: report.stack });
      return { ok: true };
    }),
  );
  handle(
    DIAGNOSTICS_WATCH_CHANNEL,
    fromWorkspace((e, on: unknown) => {
      if (on === true) watch(e.sender);
      else if (on === false) unwatch(e.sender);
      return service.listing();
    }),
  );
  handle(
    DIAGNOSTICS_COPY_CHANNEL,
    fromWorkspace((_e, payload: unknown): CopyOutcome => {
      const request = parseReportRequest(payload);
      const entries = request && entriesFor(request);
      if (!entries) return { ok: false, count: 0 };
      writeClipboard(formatReport(entries, service.reportContext()));
      return { ok: true, count: entries.length };
    }),
  );
  handle(
    DIAGNOSTICS_GITHUB_CHANNEL,
    fromWorkspace(async (_e, payload: unknown): Promise<GithubOutcome> => {
      const request = parseReportRequest(payload);
      const entries = request && entriesFor(request);
      if (!request || !entries) return { ok: false, copied: false, truncated: false };
      const { draft, environment } = composeIssue(entries, service.reportContext(), request.crash === true);
      const plan = planIssue(draft, environment);
      if (!isIssueUrl(plan.url)) return { ok: false, copied: false, truncated: false };
      if (plan.clipboard) writeClipboard(plan.clipboard);
      await openExternal(plan.url);
      return { ok: true, copied: plan.clipboard !== null, truncated: plan.truncated };
    }),
  );
  handle(DIAGNOSTICS_NOTICE_CHANNEL, fromWorkspace(() => service.pendingNotice()));
  handle(
    DIAGNOSTICS_DISMISS_CHANNEL,
    fromWorkspace(() => {
      service.dismissNotice();
      return true;
    }),
  );

  return { watcherCount: () => watching.size };
}
