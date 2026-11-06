import { msg } from '@shared/lang/messages';

const REDACTED = '[redacted]';
const SECRET_KEYS =
  'access_token|refresh_token|id_token|token|code|code_verifier|client_secret|device_code|user_code|password|accessToken|refreshToken|idToken|codeVerifier|clientSecret|deviceCode|userCode';

const FORM_PAIR = new RegExp(`\\b(${SECRET_KEYS})=[^&\\s"'#]+`, 'gi');
const JSON_PAIR = new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*)"[^"]*"`, 'gi');
const SINGLE_QUOTED_PAIR = new RegExp(`(\\b(?:${SECRET_KEYS})\\s*:\\s*)'[^']*'`, 'gi');
const AUTH_HEADER = /\b(authorization\s*[:=]\s*)(?:bearer|basic|token)?\s*[^\s,;"']+/gi;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g;

function redact(text: string): string {
  return text
    .replace(FORM_PAIR, (_all, key: string) => `${key}=${REDACTED}`)
    .replace(JSON_PAIR, (_all, head: string) => `${head}"${REDACTED}"`)
    .replace(SINGLE_QUOTED_PAIR, (_all, head: string) => `${head}'${REDACTED}'`)
    .replace(AUTH_HEADER, (_all, header: string) => `${header}${REDACTED}`)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(JWT, REDACTED);
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

type LogSink = (line: string) => void;

function createLog(sink: LogSink): (message: string, err?: unknown) => void {
  return (message, err) => sink(redact(`${msg('logs.prefix')} ${message}${err === undefined ? '' : ` ${describeError(err)}`}`));
}

export { redact, createLog };
export type { LogSink };
