import { hasLiveSession } from '../../shared/session-liveness';

export const IDLE_SWEEP_MS = 30_000;

const MS_PER_MINUTE = 60_000;
const BLANK_KEY_PREFIX = 'blank:';

export { hasLiveSession };

export interface IdleTabCandidate {
  key: string;
  path: string | null;
  lastSelectedAt: number | undefined;
}

export interface IdleTabRule {
  activeKey: string | null;
  now: number;
  idleMinutes: number;
  sessionsOf(path: string): readonly { state: string }[] | undefined;
}

export function isIdleTab(tab: IdleTabCandidate, rule: IdleTabRule): boolean {
  if (tab.key === rule.activeKey) return false;
  if (tab.path === null || tab.key.startsWith(BLANK_KEY_PREFIX)) return false;
  if (tab.lastSelectedAt === undefined) return false;
  if (rule.now - tab.lastSelectedAt < rule.idleMinutes * MS_PER_MINUTE) return false;
  const sessions = rule.sessionsOf(tab.path);
  return sessions !== undefined && !hasLiveSession(sessions);
}

export function idleTabKeys(tabs: readonly IdleTabCandidate[], rule: IdleTabRule): string[] {
  return tabs.filter((tab) => isIdleTab(tab, rule)).map((tab) => tab.key);
}
