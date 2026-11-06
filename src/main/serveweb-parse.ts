export type ServerPage = 'workbench' | 'downloading' | 'other';

export interface ProgressLine {
  text: string;
  phase: string;
  percent: number | null;
}

const HTTP_OK = 200;
export const MAX_PERCENT = 100;

// serve-web answers every request with this placeholder (and a 1.5s self-reload)
// while it fetches the server build for a new VS Code version.
const DOWNLOAD_PAGE = /Code Server is downloading/i;

export function classifyServerPage(statusCode: number | undefined, body: string): ServerPage {
  if (DOWNLOAD_PAGE.test(body)) return 'downloading';
  if (statusCode === HTTP_OK && /workbench/i.test(body)) return 'workbench';
  return 'other';
}

// The exact wording varies by `code` CLI version, so match keywords and any "NN%".
export function classifyProgressLine(line: string): ProgressLine | null {
  const t = line.trim();
  if (!t || t.startsWith('*')) return null;
  const m = t.match(/(\d{1,3})\s*%/);
  const pct = m ? Math.min(MAX_PERCENT, Number(m[1])) : null;
  if (/download/i.test(t)) return { text: 'Downloading the VS Code server…', phase: 'download', percent: pct };
  if (/unpack|extract|install/i.test(t)) return { text: 'Installing the VS Code server…', phase: 'install', percent: pct };
  if (/web ui available|available at|server bound|listening/i.test(t)) return { text: 'Server up — loading the editor…', phase: 'starting', percent: MAX_PERCENT };
  return null;
}
