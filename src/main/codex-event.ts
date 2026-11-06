import crypto from 'node:crypto';
import path from 'node:path';
import { isSessionId } from './provider';

const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'] as const;
const CHILD_EVENTS = new Set(['SubagentStart', 'SubagentStop']);

type CodexHookEventName = (typeof CODEX_EVENTS)[number];

interface CodexHookEvent {
  session_id: string;
  cwd: string;
  hook_event_name: CodexHookEventName;
  turn_id?: string;
  last_assistant_message?: string | null;
  stop_hook_active?: boolean;
}

type ParsedCodexEvent = { kind: 'event'; event: CodexHookEvent } | { kind: 'ignored' } | { kind: 'invalid'; error: string };

function authorizeCodexHook(configured: string, presented: unknown) {
  if (!configured || typeof presented !== 'string') return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCodexEvent(value: unknown): ParsedCodexEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid', error: 'bad payload' };
  const raw = value as Record<string, unknown>;
  if (!isSessionId(raw.session_id)) return { kind: 'invalid', error: 'bad session id' };
  if (typeof raw.cwd !== 'string' || raw.cwd.length > 4096 || !path.isAbsolute(raw.cwd)) return { kind: 'invalid', error: 'bad cwd' };
  if (typeof raw.hook_event_name !== 'string') return { kind: 'invalid', error: 'bad event' };
  if (raw.agent_id !== undefined && raw.agent_id !== null && typeof raw.agent_id !== 'string') return { kind: 'invalid', error: 'bad agent id' };
  if (CHILD_EVENTS.has(raw.hook_event_name) || (typeof raw.agent_id === 'string' && raw.agent_id.length > 0)) return { kind: 'ignored' };
  if (!CODEX_EVENTS.includes(raw.hook_event_name as CodexHookEventName)) return { kind: 'invalid', error: 'bad event' };
  if (raw.turn_id !== undefined && (typeof raw.turn_id !== 'string' || !raw.turn_id || raw.turn_id.length > 200)) {
    return { kind: 'invalid', error: 'bad turn id' };
  }
  if (raw.last_assistant_message !== undefined && raw.last_assistant_message !== null && typeof raw.last_assistant_message !== 'string') {
    return { kind: 'invalid', error: 'bad assistant message' };
  }
  if (raw.stop_hook_active !== undefined && typeof raw.stop_hook_active !== 'boolean') return { kind: 'invalid', error: 'bad stop state' };
  return {
    kind: 'event',
    event: {
      session_id: raw.session_id,
      cwd: raw.cwd,
      hook_event_name: raw.hook_event_name as CodexHookEventName,
      ...(typeof raw.turn_id === 'string' ? { turn_id: raw.turn_id } : {}),
      ...(raw.last_assistant_message === null
        ? { last_assistant_message: null }
        : typeof raw.last_assistant_message === 'string'
          ? { last_assistant_message: raw.last_assistant_message.slice(0, 280) }
          : {}),
      ...(typeof raw.stop_hook_active === 'boolean' ? { stop_hook_active: raw.stop_hook_active } : {}),
    },
  };
}

export { CODEX_EVENTS, authorizeCodexHook, parseCodexEvent };
export type { CodexHookEvent, CodexHookEventName, ParsedCodexEvent };
