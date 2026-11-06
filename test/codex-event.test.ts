import { describe, expect, it } from 'vitest';
import { CODEX_EVENTS, authorizeCodexHook, parseCodexEvent } from '../src/main/codex-event';

const base = {
  session_id: 'thr_12345678',
  cwd: '/tmp/project',
  hook_event_name: 'SessionStart',
};

describe('authorizeCodexHook', () => {
  it('fails closed and accepts only the exact configured token', () => {
    expect(authorizeCodexHook('', '')).toBe(false);
    expect(authorizeCodexHook('secret', undefined)).toBe(false);
    expect(authorizeCodexHook('secret', 'secreu')).toBe(false);
    expect(authorizeCodexHook('secret', 'secret')).toBe(true);
  });
});

describe('parseCodexEvent', () => {
  it.each(CODEX_EVENTS)('accepts and normalizes %s', (hook_event_name) => {
    const parsed = parseCodexEvent({
      ...base,
      hook_event_name,
      turn_id: 'turn-1',
      last_assistant_message: 'done',
      stop_hook_active: false,
      prompt: 'private prompt',
      tool_input: { command: 'private command' },
      transcript_path: '/private/transcript',
    });
    expect(parsed).toEqual({
      kind: 'event',
      event: {
        session_id: 'thr_12345678',
        cwd: '/tmp/project',
        hook_event_name,
        turn_id: 'turn-1',
        last_assistant_message: 'done',
        stop_hook_active: false,
      },
    });
  });

  it('accepts a null assistant message and truncates a text message', () => {
    expect(parseCodexEvent({ ...base, last_assistant_message: null })).toMatchObject({
      kind: 'event',
      event: { last_assistant_message: null },
    });
    const parsed = parseCodexEvent({ ...base, last_assistant_message: 'x'.repeat(500) });
    expect(parsed.kind).toBe('event');
    if (parsed.kind === 'event') expect(parsed.event.last_assistant_message).toHaveLength(280);
  });

  it('ignores documented child events and events carrying an agent id', () => {
    expect(parseCodexEvent({ ...base, hook_event_name: 'SubagentStart' })).toEqual({ kind: 'ignored' });
    expect(parseCodexEvent({ ...base, hook_event_name: 'SubagentStop' })).toEqual({ kind: 'ignored' });
    expect(parseCodexEvent({ ...base, agent_id: 'agent-1' })).toEqual({ kind: 'ignored' });
  });

  it.each([
    null,
    { ...base, session_id: '--option' },
    { ...base, cwd: 'relative' },
    { ...base, hook_event_name: 'PreToolUse' },
    { ...base, turn_id: 4 },
    { ...base, turn_id: '' },
    { ...base, last_assistant_message: 4 },
    { ...base, stop_hook_active: 'false' },
    { ...base, agent_id: 4 },
  ])('rejects malformed lifecycle input %#', (value) => {
    expect(parseCodexEvent(value).kind).toBe('invalid');
  });
});
