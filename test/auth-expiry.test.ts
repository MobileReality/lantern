import { describe, expect, it } from 'vitest';
import { DAY_MS, EXPIRY_WARNING_DAYS, expiryState, formatExpiryDate, parseExpiryDate } from '@shared/auth-expiry';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

describe('expiry warning', () => {
  it('says nothing for an account with no expiry', () => {
    expect(expiryState(null, NOW)).toEqual({ level: 'none', days: 0 });
  });

  it('is ok while the expiry is more than 14 days away', () => {
    expect(expiryState(NOW + 15 * DAY_MS, NOW)).toEqual({ level: 'ok', days: 15 });
    expect(expiryState(NOW + 90 * DAY_MS, NOW).level).toBe('ok');
  });

  it('warns from exactly 14 days and counts a started day as a day', () => {
    expect(EXPIRY_WARNING_DAYS).toBe(14);
    expect(expiryState(NOW + 14 * DAY_MS, NOW)).toEqual({ level: 'soon', days: 14 });
    expect(expiryState(NOW + 14 * DAY_MS + 1, NOW)).toEqual({ level: 'ok', days: 15 });
    expect(expiryState(NOW + 3 * DAY_MS + 5, NOW)).toEqual({ level: 'soon', days: 4 });
    expect(expiryState(NOW + 1, NOW)).toEqual({ level: 'soon', days: 1 });
  });

  it('is expired at the instant of the expiry and after it, counting whole days since', () => {
    expect(expiryState(NOW, NOW)).toEqual({ level: 'expired', days: 0 });
    expect(expiryState(NOW - 2 * DAY_MS - 5, NOW)).toEqual({ level: 'expired', days: 2 });
  });

  it('follows a fake clock moving forward', () => {
    const expiresAt = NOW + 20 * DAY_MS;
    let clock = NOW;
    expect(expiryState(expiresAt, clock).level).toBe('ok');
    clock += 7 * DAY_MS;
    expect(expiryState(expiresAt, clock).level).toBe('soon');
    clock += 14 * DAY_MS;
    expect(expiryState(expiresAt, clock).level).toBe('expired');
  });
});

describe('manual expiry dates', () => {
  it('round-trips a date through the end of that day', () => {
    const at = parseExpiryDate('2026-11-30');
    expect(at).toBe(Date.UTC(2026, 10, 30, 23, 59, 59, 999));
    expect(formatExpiryDate(at as number)).toBe('2026-11-30');
  });

  it('refuses malformed and impossible dates', () => {
    for (const value of ['', '2026-1-1', '2026-02-29', '2026-04-31', 'soon']) expect(parseExpiryDate(value)).toBeNull();
    expect(parseExpiryDate('2028-02-29')).not.toBeNull();
  });
});
