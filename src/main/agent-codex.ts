import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, AgentKind } from './agent';
import { isSessionId } from './provider';

const MAX_BUFFER = 256 * 1024;
const MAX_DIAGNOSTIC = 16 * 1024;

// Map runs are pinned like Claude's LANTERN_MODEL, so the model gate never depends on the agent
// knowing its own id. Bump it here when a newer Sol model ships.
const LANTERN_CODEX_MODEL = 'gpt-6.1-sol';

function codexBinCandidates(env: NodeJS.ProcessEnv = process.env, home = os.homedir(), platform = process.platform, arch = process.arch) {
  const pathName = platform === 'win32' ? 'codex.exe' : 'codex';
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const fromPath = (env.PATH || '').split(delimiter).filter(Boolean).map((dir) => path.join(dir, pathName));
  if (platform === 'win32') {
    const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const platformPackage = arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
    const npmOpenAi = env.APPDATA && path.join(env.APPDATA, 'npm', 'node_modules', '@openai');
    const nestedVendor = npmOpenAi && path.join(npmOpenAi, 'codex', 'node_modules', '@openai', platformPackage, 'vendor', triple);
    const hoistedVendor = npmOpenAi && path.join(npmOpenAi, platformPackage, 'vendor', triple);
    return [...new Set([
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Codex', 'codex.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      nestedVendor && path.join(nestedVendor, 'bin', 'codex.exe'),
      nestedVendor && path.join(nestedVendor, 'codex', 'codex.exe'),
      hoistedVendor && path.join(hoistedVendor, 'bin', 'codex.exe'),
      hoistedVendor && path.join(hoistedVendor, 'codex', 'codex.exe'),
      npmOpenAi && path.join(npmOpenAi, 'codex', 'vendor', triple, 'codex', 'codex.exe'),
      ...fromPath,
    ].filter((candidate): candidate is string => !!candidate))];
  }
  return [...new Set([
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    path.join(home, '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    ...fromPath,
  ])];
}

function resolveCodexBin(candidates = codexBinCandidates(), platform = process.platform) {
  for (const candidate of candidates) {
    if (platform === 'win32' && path.extname(candidate).toLowerCase() !== '.exe') continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

function codexArgs(kind: AgentKind, sessionId?: string | null, cwd?: string) {
  if (sessionId && !isSessionId(sessionId)) throw new Error('Invalid Codex session id');
  const root = ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'];
  if (cwd) root.push('--cd', cwd);
  if (kind === 'lantern' || kind === 'lantern-refresh') root.push('--model', LANTERN_CODEX_MODEL);
  return sessionId
    ? [...root, 'exec', 'fork', '--json', sessionId, '-']
    : [...root, 'exec', '--json', '-'];
}

interface ParsedRecord {
  event?: AgentEvent;
  itemId?: string;
  threadId?: string;
}

function message(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'text', 'detail']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return '';
}

function toolEvent(item: Record<string, unknown>): AgentEvent | null {
  const type = typeof item.type === 'string' ? item.type : '';
  if (type === 'command_execution') {
    const detail = typeof item.command === 'string' ? item.command.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    return { kind: 'tool', tool: 'Bash', detail: detail || undefined };
  }
  if (type === 'file_change' || type === 'file_changes') return { kind: 'tool', tool: 'File change' };
  if (type === 'mcp_tool_call') {
    const server = typeof item.server === 'string' ? item.server : '';
    const tool = typeof item.tool === 'string' ? item.tool : typeof item.name === 'string' ? item.name : 'tool';
    return { kind: 'tool', tool: server ? `${server}: ${tool}` : tool };
  }
  if (type === 'web_search') return { kind: 'tool', tool: typeof item.query === 'string' ? `Web search: ${item.query}` : 'Web search' };
  if (type === 'collab_tool_call') return { kind: 'tool', tool: typeof item.tool === 'string' ? `Collaboration: ${item.tool}` : 'Collaboration' };
  return null;
}

function parseCodexRecord(line: string, durationMs: number): ParsedRecord {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return {};
  }
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'thread.started' || type === 'thread.start') {
    const thread = record.thread && typeof record.thread === 'object' ? record.thread as Record<string, unknown> : {};
    const threadId = typeof record.thread_id === 'string' ? record.thread_id : typeof thread.id === 'string' ? thread.id : '';
    return { event: { kind: 'start' }, threadId: threadId || undefined };
  }
  if (type === 'turn.completed' || type === 'done') return { event: { kind: 'done', ok: true, durationMs } };
  if (type === 'turn.failed' || type === 'error') {
    return { event: { kind: 'error', text: message(record.error) || message(record) || 'Codex run failed' } };
  }
  if (type !== 'item.started' && type !== 'item.completed') return {};
  const item = record.item && typeof record.item === 'object' ? record.item as Record<string, unknown> : {};
  const itemType = typeof item.type === 'string' ? item.type : '';
  if (itemType === 'agent_message' && type === 'item.completed' && typeof item.text === 'string' && item.text.trim()) {
    return { event: { kind: 'text', text: item.text }, itemId: typeof item.id === 'string' ? item.id : undefined };
  }
  const event = toolEvent(item);
  return event ? { event, itemId: typeof item.id === 'string' ? item.id : undefined } : {};
}

interface DecoderOptions {
  emit: (event: AgentEvent) => void;
  onThread: (id: string) => void;
  now?: () => number;
}

function createCodexDecoder({ emit, onThread, now = Date.now }: DecoderOptions) {
  const startedAt = now();
  const seenItems = new Set<string>();
  let buffer = '';
  let diagnostic = '';
  let terminal = false;

  const note = (text: string) => {
    diagnostic = `${diagnostic}${diagnostic ? '\n' : ''}${text}`.slice(-MAX_DIAGNOSTIC);
  };
  const consume = (line: string) => {
    if (!line.trim()) return;
    let valid = true;
    try {
      JSON.parse(line);
    } catch {
      valid = false;
      note(`Malformed Codex JSONL: ${line.slice(0, 300)}`);
    }
    if (!valid) return;
    const parsed = parseCodexRecord(line, Math.max(0, now() - startedAt));
    if (parsed.threadId) onThread(parsed.threadId);
    if (!parsed.event) return;
    if (terminal) return;
    if (parsed.event.kind === 'tool' && parsed.itemId) {
      if (seenItems.has(parsed.itemId)) return;
      seenItems.add(parsed.itemId);
    }
    if (parsed.event.kind === 'done' || parsed.event.kind === 'error') terminal = true;
    emit(parsed.event);
  };
  return {
    write(chunk: string) {
      buffer += chunk;
      if (buffer.length > MAX_BUFFER) {
        note('Codex JSONL record exceeded the stream buffer limit');
        buffer = buffer.slice(-MAX_BUFFER);
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    },
    flush() {
      if (buffer) consume(buffer);
      buffer = '';
    },
    diagnostic() {
      return diagnostic;
    },
  };
}

export { LANTERN_CODEX_MODEL, codexArgs, codexBinCandidates, createCodexDecoder, parseCodexRecord, resolveCodexBin };
