import { clip, type DiagnosticInput } from '../../shared/diagnostics';
import { createThrottle, type Throttle } from './throttle';

type Report = (input: DiagnosticInput) => void;
type Listener = (...args: any[]) => void;

export interface GuestEmitter {
  on(event: string, listener: Listener): unknown;
}

export const EDITOR_MESSAGE_CHARS = 400;
const EDITOR_SOURCE_CHARS = 300;
const REPEAT_WINDOW_MS = 60_000;
const ABORTED_CODE = -3;
const ABORTED_NAME = 'ERR_ABORTED';
const REDACTED = '[redacted]';
const TOKEN_PARAMS = ['tkn', 'connection-token', 'token'];
const TOKEN_IN_TEXT = /\b(tkn|connection-token|token)=[^&\s"'#)]+/gi;
const ENCODED_SLASH = /%2F|%5C/gi;
const TOKEN_FLAG = /(--connection-token(?:=|\s+))\S+/gi;

const BENIGN_MESSAGES = [
  /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i,
  /(?:^|\W)Canceled(?:: Canceled)?\s*$/,
  /favicon\.ico/i,
  /net::ERR_ABORTED/i,
];

export function stripConnectionToken(text: string): string {
  return text
    .replace(ENCODED_SLASH, (slash) => (slash.toUpperCase() === '%2F' ? '/' : '\\'))
    .replace(TOKEN_FLAG, (_all, flag: string) => `${flag}${REDACTED}`).replace(TOKEN_IN_TEXT, (_all, key: string) => `${key}=${REDACTED}`);
}

export function redactEditorUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of TOKEN_PARAMS) if (parsed.searchParams.has(name)) parsed.searchParams.set(name, REDACTED);
    return stripConnectionToken(decodeURIComponent(parsed.toString()));
  } catch {
    return stripConnectionToken(url);
  }
}

export const isBenignEditorMessage = (message: string) => BENIGN_MESSAGES.some((pattern) => pattern.test(message.trim()));

const isErrorLevel = (level: unknown) => level === 'error' || level === 3;

export interface ConsoleMessage {
  level: unknown;
  message?: unknown;
  sourceId?: unknown;
  lineNumber?: unknown;
  line?: unknown;
}

export function editorConsoleInput(details: ConsoleMessage): DiagnosticInput | null {
  if (!isErrorLevel(details.level) || typeof details.message !== 'string') return null;
  const message = stripConnectionToken(details.message).trim();
  if (!message || isBenignEditorMessage(message)) return null;
  const line = details.lineNumber ?? details.line;
  const where = typeof details.sourceId === 'string' && details.sourceId ? `Logged by ${clip(redactEditorUrl(details.sourceId), EDITOR_SOURCE_CHARS)}${typeof line === 'number' && line > 0 ? `:${line}` : ''}` : undefined;
  return { source: 'editor', severity: 'warning', message: clip(message, EDITOR_MESSAGE_CHARS), ...(where ? { detail: where } : {}) };
}

export function editorLoadFailureInput(errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean): DiagnosticInput | null {
  if (!isMainFrame || errorCode === ABORTED_CODE || errorDescription === ABORTED_NAME) return null;
  return {
    source: 'editor',
    severity: 'error',
    message: `The editor failed to load: ${errorDescription || 'unknown error'} (${errorCode})`,
    detail: `Address: ${clip(redactEditorUrl(validatedUrl), EDITOR_SOURCE_CHARS)}`,
  };
}

export const EDITOR_UNRESPONSIVE: DiagnosticInput = { source: 'editor', severity: 'error', message: 'The editor stopped responding' };
export const EDITOR_RESPONSIVE: DiagnosticInput = { source: 'editor', severity: 'info', message: 'The editor responds again' };

export function installEditorCapture({ guest, report, throttle }: { guest: GuestEmitter; report: Report; throttle?: Throttle }) {
  const repeats = throttle ?? createThrottle({ limit: 1, windowMs: REPEAT_WINDOW_MS });
  const send = (input: DiagnosticInput | null) => {
    if (input && repeats.allow(`${input.severity}|${input.message}`)) report(input);
  };
  guest.on('console-message', (event: ConsoleMessage | undefined, level?: unknown, message?: unknown, line?: unknown, sourceId?: unknown) => {
    send(event && typeof event === 'object' && 'level' in event ? editorConsoleInput(event) : editorConsoleInput({ level, message, line, sourceId }));
  });
  guest.on('did-fail-load', (_event: unknown, errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean) => {
    send(editorLoadFailureInput(errorCode, errorDescription, validatedUrl, isMainFrame));
  });
  guest.on('unresponsive', () => report(EDITOR_UNRESPONSIVE));
  guest.on('responsive', () => report(EDITOR_RESPONSIVE));
}
