import { describe, expect, it } from 'vitest';
import { isSubagentCwd, isSubagentEvent } from '../src/main/subagent';

describe('isSubagentEvent', () => {
  it('flags SubagentStop in hook and notify-payload shape', () => {
    expect(isSubagentEvent({ hook_event_name: 'SubagentStop', cwd: '/repo' })).toBe(true);
    expect(isSubagentEvent({ hookEvent: 'SubagentStop', cwd: '/repo' })).toBe(true);
  });

  it('flags any event carrying an agent id', () => {
    expect(isSubagentEvent({ hook_event_name: 'Notification', agent_id: 'a1' })).toBe(true);
    expect(isSubagentEvent({ hookEvent: 'Stop', agentId: 'a1' })).toBe(true);
  });

  it('flags events from a subagent worktree', () => {
    expect(isSubagentEvent({ hookEvent: 'Stop', cwd: '/repo/.claude/worktrees/agent-x' })).toBe(true);
  });

  it('keeps main-agent Stop and Notification', () => {
    expect(isSubagentEvent({ hook_event_name: 'Stop', cwd: '/repo' })).toBe(false);
    expect(isSubagentEvent({ hookEvent: 'Notification', cwd: '/repo/src' })).toBe(false);
    expect(isSubagentEvent(null)).toBe(false);
  });
});

describe('isSubagentCwd', () => {
  it('matches the worktree and anything under it, either separator', () => {
    expect(isSubagentCwd('/repo/.claude/worktrees/agent-abc')).toBe(true);
    expect(isSubagentCwd('/repo/.claude/worktrees/agent-abc/src')).toBe(true);
    expect(isSubagentCwd('C:\\repo\\.claude\\worktrees\\agent-abc')).toBe(true);
  });

  it('ignores user-named worktrees and plain paths', () => {
    expect(isSubagentCwd('/repo/.claude/worktrees/feature')).toBe(false);
    expect(isSubagentCwd('/repo/agent-abc')).toBe(false);
    expect(isSubagentCwd(undefined)).toBe(false);
  });
});
