import type { ProcRow } from './proctree';

export interface AgedProcRow extends ProcRow {
  ageSeconds: number;
}

const PS_AGED_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+-\d+:\d+:\d+|\d+:\d+:\d+|\d+:\d+)\s+(\S+)\s+(.+)$/;
const ETIME = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/;
const TOP_ROW = /^\s*(\d+)\s+(\d+(?:\.\d+)?)([BKMGT]?)([+-]?)\s*$/;
const TOP_HEADER = /^\s*PID\b/;
const PRESSURE_TOTAL = /The system has (\d+)/;
const PRESSURE_FREE = /free percentage:\s*(\d+)%/i;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const UNIT_POWER: Record<string, number> = { '': 0, B: 0, K: 1, M: 2, G: 3, T: 4 };

export function parseEtime(etime: string) {
  const m = ETIME.exec(etime);
  if (!m) return 0;
  const [, days, hours, minutes, seconds] = m;
  return Number(days ?? 0) * SECONDS_PER_DAY + Number(hours ?? 0) * SECONDS_PER_HOUR + Number(minutes) * SECONDS_PER_MINUTE + Number(seconds);
}

export function parsePsAged(text: string): AgedProcRow[] {
  const rows: AgedProcRow[] = [];
  for (const line of text.split('\n')) {
    const m = PS_AGED_LINE.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), ageSeconds: parseEtime(m[3]), stat: m[4], command: m[5].trim() });
  }
  return rows;
}

export function parseTopFootprint(text: string) {
  const bytes = new Map<number, number>();
  let inRows = false;
  for (const line of text.split('\n')) {
    if (TOP_HEADER.test(line)) {
      inRows = true;
      continue;
    }
    const m = inRows ? TOP_ROW.exec(line) : null;
    if (m) bytes.set(Number(m[1]), Math.round(Number(m[2]) * 1024 ** UNIT_POWER[m[3]]));
  }
  return bytes;
}

export function parseLsofCwd(text: string) {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || 0;
    else if (line.startsWith('n') && pid && !cwds.has(pid)) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

export function parseMemoryPressure(text: string) {
  const total = PRESSURE_TOTAL.exec(text);
  const free = PRESSURE_FREE.exec(text);
  return {
    installedBytes: total ? Number(total[1]) : null,
    freePercent: free ? Number(free[1]) : null,
  };
}
