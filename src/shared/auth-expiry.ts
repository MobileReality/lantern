import { EXPIRY_LEVEL } from './auth-kinds';
import type { ExpiryLevel } from './auth-kinds';

const DAY_MS = 86_400_000;
const EXPIRY_WARNING_DAYS = 14;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ExpiryState {
  level: ExpiryLevel;
  days: number;
}

function expiryState(expiresAt: number | null, now: number): ExpiryState {
  if (expiresAt === null) return { level: EXPIRY_LEVEL.none, days: 0 };
  const remaining = expiresAt - now;
  if (remaining <= 0) return { level: EXPIRY_LEVEL.expired, days: Math.floor(Math.abs(remaining) / DAY_MS) };
  const days = Math.ceil(remaining / DAY_MS);
  return { level: days <= EXPIRY_WARNING_DAYS ? EXPIRY_LEVEL.soon : EXPIRY_LEVEL.ok, days };
}

function parseExpiryDate(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  const real = at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return real ? at.getTime() : null;
}

function formatExpiryDate(expiresAt: number): string {
  return new Date(expiresAt).toISOString().slice(0, 10);
}

export { DAY_MS, EXPIRY_WARNING_DAYS, expiryState, parseExpiryDate, formatExpiryDate };
export type { ExpiryLevel, ExpiryState };
