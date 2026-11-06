export type TrayAction = { type: 'workspace' } | { type: 'clear' } | { type: 'quit' } | { type: 'test'; kind: string };

const TEST_PREFIX = 'test:';

export function trayActionId(action: TrayAction): string {
  return action.type === 'test' ? `${TEST_PREFIX}${action.kind}` : action.type;
}

export function parseTrayAction(id: unknown, testKinds: readonly string[]): TrayAction | null {
  if (id === 'workspace' || id === 'clear' || id === 'quit') return { type: id };
  if (typeof id !== 'string' || !id.startsWith(TEST_PREFIX)) return null;
  const kind = id.slice(TEST_PREFIX.length);
  return testKinds.includes(kind) ? { type: 'test', kind } : null;
}
