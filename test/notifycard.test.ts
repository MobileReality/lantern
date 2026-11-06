import { describe, expect, it } from 'vitest';
import { overlayCard } from '../src/main/notifycard';
import { resolveRoot } from '../src/main/projectroot';

const toRepo = (cwd: string) => resolveRoot(cwd, ['/work/repo']);

describe('overlayCard', () => {
  it('drops subagent notifications', () => {
    expect(overlayCard({ hookEvent: 'SubagentStop', kind: 'stop', cwd: '/repo' }, toRepo)).toBeNull();
    expect(overlayCard({ hookEvent: 'Notification', agentId: 'a1', cwd: '/repo' }, toRepo)).toBeNull();
    expect(overlayCard({ hookEvent: 'Stop', cwd: '/repo/.claude/worktrees/agent-x', repoName: 'agent-x' }, toRepo)).toBeNull();
  });

  it('keeps main-agent Stop and Notification, labelled with the resolved project', () => {
    expect(overlayCard({ hookEvent: 'Stop', cwd: '/work/repo/src', repoName: 'repo' }, toRepo)).toMatchObject({
      repoName: 'repo',
      cwd: '/work/repo/src',
    });
    expect(overlayCard({ hookEvent: 'Notification', kind: 'idle', cwd: '/work/repo' }, toRepo)).toMatchObject({
      kind: 'idle',
      repoName: 'repo',
    });
    expect(overlayCard({ hookEvent: 'Stop', cwd: '/work/repo/.claude/worktrees/feature', repoName: 'feature' }, toRepo)).toMatchObject({
      repoName: 'repo',
    });
  });

  it('passes through cards without a cwd and rejects non-objects', () => {
    expect(overlayCard({ kind: 'info', title: 'x' }, toRepo)).toEqual({ kind: 'info', title: 'x' });
    expect(overlayCard(null, toRepo)).toBeNull();
  });
});
