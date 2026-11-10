import { redact } from '../auth/redact';

export interface RedactionContext {
  home: string;
  projects: () => string[];
}

const HOME_MARK = '~';
const PROJECT_MARK = '<project>';
const REDACTED = '[redacted]';
const USER_DIR = /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"'`)<>]+/g;
const CONNECTION_TOKEN_FLAG = /(--connection-token(?:=|\s+))\S+/gi;
const QUERY_TOKEN = /\b(tkn|connection-token|token)=[^&\s"'#]+/gi;
const SEPARATORS = /[\\/]+/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pathPattern(dir: string): RegExp | null {
  const trimmed = dir.replace(/[\\/]+$/, '');
  if (trimmed.length < 2) return null;
  const parts = trimmed.split(SEPARATORS).map(escapeRegExp);
  return new RegExp(`${parts.join('[\\\\/]+')}(?![\\w-])`, 'gi');
}

function replaceDirs(text: string, dirs: string[], mark: string): string {
  const ordered = [...new Set(dirs)].sort((a, b) => b.length - a.length);
  return ordered.reduce((out, dir) => {
    const pattern = pathPattern(dir);
    return pattern ? out.replace(pattern, mark) : out;
  }, text);
}

export function redactText(text: string, context: RedactionContext): string {
  const withoutProjects = replaceDirs(text, context.projects(), PROJECT_MARK);
  const withoutHome = replaceDirs(withoutProjects, context.home ? [context.home] : [], HOME_MARK);
  return redact(
    withoutHome
      .replace(USER_DIR, HOME_MARK)
      .replace(CONNECTION_TOKEN_FLAG, (_all, flag: string) => `${flag}${REDACTED}`)
      .replace(QUERY_TOKEN, (_all, key: string) => `${key}=${REDACTED}`),
  );
}
