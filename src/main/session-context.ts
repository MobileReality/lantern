import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NoticeKind } from './state';

const TAIL_BYTES = 512 * 1024;
const MAX_CONTEXT = 180;

interface Block {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface Entry {
  type?: string;
  message?: { role?: string; content?: unknown };
}

interface Description {
  title?: string;
  context?: string;
}

function transcriptPath(cwd: string, sessionId: string, home = os.homedir()): string {
  return path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
}

function readTranscript(file: string): Entry[] {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift();
    const entries: Entry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }
    return entries;
  } catch {
    return [];
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function blocks(entry: Entry): Block[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

function pendingTool(entries: Entry[]): Block | null {
  const answered = new Set<string>();
  for (const entry of entries) for (const block of blocks(entry)) if (block.type === 'tool_result' && block.tool_use_id) answered.add(block.tool_use_id);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].message?.role !== 'assistant') continue;
    const tools = blocks(entries[i]).filter((block) => block.type === 'tool_use');
    const open = tools.reverse().find((block) => block.id && !answered.has(block.id));
    if (open) return open;
    if (tools.length || blocks(entries[i]).some((block) => block.type === 'text')) return null;
  }
  return null;
}

function lastText(entries: Entry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].message?.role !== 'assistant') continue;
    const text = blocks(entries[i])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n');
    if (text.trim()) return text;
  }
  return '';
}

function plain(text: string): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_CONTEXT ? `${flat.slice(0, MAX_CONTEXT - 1).trimEnd()}…` : flat;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function relative(file: string, root: string): string {
  if (!file) return 'a file';
  const rel = root ? path.relative(root, file) : '';
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(file);
}

function firstQuestion(input: Record<string, unknown>): string {
  const questions = input.questions;
  if (Array.isArray(questions) && questions[0] && typeof questions[0] === 'object') return str((questions[0] as Record<string, unknown>).question);
  return str(input.question);
}

function describeTool(tool: Block, root: string, exists: (file: string) => boolean): Description {
  const input = tool.input ?? {};
  const file = str(input.file_path) || str(input.notebook_path);
  switch (tool.name) {
    case 'Bash':
      return { title: 'Run a shell command?', context: plain(str(input.description) ? `${str(input.description)}: ${str(input.command)}` : str(input.command)) };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { title: `Edit ${relative(file, root)}?`, context: plain(str(input.new_string) || str(input.new_source)) || undefined };
    case 'Write':
      return { title: `${exists(file) ? 'Overwrite' : 'Create'} ${relative(file, root)}?`, context: plain(str(input.content)) || undefined };
    case 'WebFetch': {
      let host = str(input.url);
      try {
        host = new URL(host).host;
      } catch {}
      return { title: `Fetch ${host}?`, context: plain(str(input.prompt)) || undefined };
    }
    case 'WebSearch':
      return { title: 'Search the web?', context: plain(str(input.query)) || undefined };
    case 'AskUserQuestion':
      return { title: 'Claude is asking you', context: plain(firstQuestion(input)) || undefined };
    case 'ExitPlanMode':
      return { title: 'Claude is ready — review the plan', context: plain(str(input.plan)) || undefined };
    default:
      return { title: tool.name ? `Use ${tool.name.replace(/^mcp__[^_]+__/, '')}?` : undefined };
  }
}

const ASKING = new Set(['AskUserQuestion', 'ExitPlanMode']);

function describeNotice(kind: NoticeKind, entries: Entry[], root: string, exists: (file: string) => boolean = fs.existsSync): Description {
  const pending = pendingTool(entries);
  if (kind === 'permission' && pending) return describeTool(pending, root, exists);
  if (kind === 'waiting' && pending && pending.name && ASKING.has(pending.name)) return describeTool(pending, root, exists);
  const summary = plain(lastText(entries));
  return summary ? { context: summary } : {};
}

export { describeNotice, readTranscript, transcriptPath };
export type { Entry };
