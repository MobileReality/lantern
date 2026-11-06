const USAGE_KEY = 'lantern.commandUsage';

export function readUsage(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
}

export function bumpUsage(id: string): void {
  const usage = readUsage();
  usage[id] = (usage[id] ?? 0) + 1;
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {}
}
