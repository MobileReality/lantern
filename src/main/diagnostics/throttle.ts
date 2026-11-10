const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 10_000;
const MAX_KEYS = 500;

export interface Throttle {
  allow(key: string): boolean;
}

export function createThrottle({ limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS, now = Date.now }: { limit?: number; windowMs?: number; now?: () => number } = {}): Throttle {
  const seen = new Map<string, number[]>();
  return {
    allow(key) {
      const at = now();
      const recent = (seen.get(key) ?? []).filter((time) => at - time < windowMs);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return false;
      }
      recent.push(at);
      seen.delete(key);
      seen.set(key, recent);
      if (seen.size > MAX_KEYS) seen.delete(seen.keys().next().value as string);
      return true;
    },
  };
}
