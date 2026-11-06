const MODIFIERS = ['mod', 'alt', 'shift'];

export function normalizeKey(key: string): string | undefined {
  const mods = new Set<string>();
  const rest: string[] = [];
  for (const part of key.toLowerCase().split('+').map((p) => p.trim())) {
    if (MODIFIERS.includes(part)) mods.add(part);
    else rest.push(part);
  }
  if (rest.length !== 1 || !/^(\S|f([1-9]|1[0-2]))$/.test(rest[0])) return undefined;
  return [...MODIFIERS.filter((m) => mods.has(m)), rest[0]].join('+');
}

export function isDispatchableKey(keys: string): boolean {
  const parts = keys.split('+');
  return parts.includes('mod') || /^f([1-9]|1[0-2])$/.test(parts[parts.length - 1]);
}
