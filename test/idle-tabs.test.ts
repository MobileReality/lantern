import { describe, expect, it } from 'vitest';
import { hasLiveSession, idleTabKeys, isIdleTab, type IdleTabCandidate, type IdleTabRule } from '../src/renderer/lib/idle-tabs';

const MINUTE = 60_000;
const LIMIT = 10;
const NOW = 1_000_000_000;

type Sessions = Record<string, { state: string }[] | undefined>;

function rule(sessions: Sessions = {}, extra: Partial<IdleTabRule> = {}): IdleTabRule {
  return { activeKey: '/p/active', now: NOW, idleMinutes: LIMIT, sessionsOf: (path) => (path in sessions ? sessions[path] : []), ...extra };
}

function tab(extra: Partial<IdleTabCandidate> = {}): IdleTabCandidate {
  return { key: '/p/a', path: '/p/a', lastSelectedAt: NOW - LIMIT * MINUTE, ...extra };
}

describe('isIdleTab', () => {
  it('closes a tab that has been unselected for exactly the limit', () => {
    expect(isIdleTab(tab(), rule())).toBe(true);
  });

  it('keeps a tab one millisecond short of the limit', () => {
    expect(isIdleTab(tab({ lastSelectedAt: NOW - LIMIT * MINUTE + 1 }), rule())).toBe(false);
  });

  it('never closes the selected tab, however long ago it was stamped', () => {
    expect(isIdleTab(tab({ key: '/p/active', path: '/p/active', lastSelectedAt: 0 }), rule())).toBe(false);
  });

  it('never closes a blank tab', () => {
    expect(isIdleTab(tab({ key: 'blank:1', path: null, lastSelectedAt: 0 }), rule())).toBe(false);
    expect(isIdleTab(tab({ key: 'blank:2', path: '/p/a', lastSelectedAt: 0 }), rule())).toBe(false);
  });

  it('keeps a tab whose project has a running agent', () => {
    expect(isIdleTab(tab(), rule({ '/p/a': [{ state: 'running' }] }))).toBe(false);
  });

  it.each(['permission', 'idle'])('keeps a tab whose project has a waiting agent (%s)', (state) => {
    expect(isIdleTab(tab(), rule({ '/p/a': [{ state }] }))).toBe(false);
  });

  it('keeps a tab when any one of several sessions is live', () => {
    expect(isIdleTab(tab(), rule({ '/p/a': [{ state: 'done' }, { state: 'running' }] }))).toBe(false);
  });

  it.each(['unknown', 'unavailable'])('keeps a tab when the agent state is %s, because closing could end an agent', (state) => {
    expect(isIdleTab(tab(), rule({ '/p/a': [{ state }] }))).toBe(false);
  });

  it.each(['done', 'failed', 'stopped', 'ended'])('closes a tab whose only sessions are %s', (state) => {
    expect(isIdleTab(tab(), rule({ '/p/a': [{ state }] }))).toBe(true);
  });

  it('keeps a tab whose project is not in the list, since its sessions are unknown', () => {
    expect(isIdleTab(tab(), rule({ '/p/a': undefined }))).toBe(false);
  });

  it('keeps a tab that was never stamped', () => {
    expect(isIdleTab(tab({ lastSelectedAt: undefined }), rule())).toBe(false);
  });

  it('follows the configured minutes', () => {
    const stamped = tab({ lastSelectedAt: NOW - 3 * MINUTE });
    expect(isIdleTab(stamped, rule({}, { idleMinutes: 3 }))).toBe(true);
    expect(isIdleTab(stamped, rule({}, { idleMinutes: 4 }))).toBe(false);
  });

  it('starts the clock again when the tab is selected and left', () => {
    const longIdle = tab({ lastSelectedAt: NOW - 30 * MINUTE });
    expect(isIdleTab(longIdle, rule())).toBe(true);
    const reselected = { ...longIdle, lastSelectedAt: NOW - 2 * MINUTE };
    expect(isIdleTab(reselected, rule())).toBe(false);
    expect(isIdleTab(reselected, rule({}, { now: NOW + 8 * MINUTE }))).toBe(true);
  });
});

describe('idleTabKeys', () => {
  it('returns only the tabs that are idle', () => {
    const tabs = [
      tab({ key: '/p/idle', path: '/p/idle' }),
      tab({ key: '/p/fresh', path: '/p/fresh', lastSelectedAt: NOW }),
      tab({ key: '/p/active', path: '/p/active' }),
      tab({ key: '/p/busy', path: '/p/busy' }),
      tab({ key: 'blank:1', path: null }),
    ];
    expect(idleTabKeys(tabs, rule({ '/p/busy': [{ state: 'running' }] }))).toEqual(['/p/idle']);
  });
});

describe('hasLiveSession', () => {
  it('is false without sessions', () => {
    expect(hasLiveSession([])).toBe(false);
  });

  it('keeps a session with a background task running live', () => {
    expect(hasLiveSession([{ state: 'shell' }])).toBe(true);
  });
});
