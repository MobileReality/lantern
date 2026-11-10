import { clip, MAX_DETAIL_CHARS, MAX_MESSAGE_CHARS, type DiagnosticEntry, type DiagnosticInput } from '../../shared/diagnostics';
import { redactText, type RedactionContext } from './redact';

export interface RecordContext extends RedactionContext {
  platform: string;
  arch: string;
  version: string;
  session: string;
  now: () => number;
  newId: () => string;
}

export function createEntry(input: DiagnosticInput, context: RecordContext): DiagnosticEntry {
  const clean = (text: string, limit: number) => clip(redactText(text, context), limit);
  const detail = input.detail ? clean(input.detail, MAX_DETAIL_CHARS) : undefined;
  return {
    id: context.newId(),
    time: new Date(context.now()).toISOString(),
    session: context.session,
    source: input.source,
    severity: input.severity,
    message: clean(input.message, MAX_MESSAGE_CHARS),
    platform: context.platform,
    arch: context.arch,
    version: context.version,
    ...(detail ? { detail } : {}),
    ...(typeof input.exitCode === 'number' ? { exitCode: input.exitCode } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export function describeFailure(error: unknown): Pick<DiagnosticInput, 'message' | 'detail'> {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, detail: error.stack };
  return { message: typeof error === 'string' ? error : safeStringify(error) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
