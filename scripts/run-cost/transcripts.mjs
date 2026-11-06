import fs from 'node:fs';
import path from 'node:path';

export const TOKEN_ESTIMATOR = 'bytes/4';
const AGENT_ID = /^[A-Za-z0-9_-]+$/;
const HANDBACK_TOOL = 'SubagentHandback';

export const estimateTokens = (bytes) => Math.ceil(bytes / 4);

export function assertAgentId(agentId) {
  if (!AGENT_ID.test(agentId ?? '')) throw new Error(`invalid agent id "${agentId}"`);
  return agentId;
}

function readInside(dir, name) {
  const file = path.join(dir, name);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return null;
  return fs.readFileSync(file, 'utf8');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readMeta(dir, agentId) {
  const text = readInside(dir, `agent-${assertAgentId(agentId)}.meta.json`);
  return text === null ? null : parseJson(text);
}

export function childrenOf(dir, agentId) {
  const children = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const match = name.match(/^agent-(.+)\.meta\.json$/);
    if (!match || !AGENT_ID.test(match[1])) continue;
    const meta = readMeta(dir, match[1]);
    if (meta?.parentAgentId === agentId) children.push(match[1]);
  }
  return children;
}

export function textBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, part) => sum + (part?.type === 'text' && typeof part.text === 'string' ? Buffer.byteLength(part.text, 'utf8') : 0), 0);
}

function usageOf(raw) {
  const u = raw ?? {};
  return {
    input: u.input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
}

function collectCalls(entries) {
  const order = [];
  const byId = new Map();
  for (const entry of entries) {
    if (entry?.type !== 'assistant' || !entry.message?.id) continue;
    const { message } = entry;
    let call = byId.get(message.id);
    if (!call) {
      call = { id: message.id, model: null, effort: null, timestamp: null, usage: usageOf(), tools: [], text: '' };
      byId.set(message.id, call);
      order.push(call);
    }
    call.model = message.model ?? call.model;
    call.effort = entry.effort ?? call.effort;
    call.timestamp = entry.timestamp ?? call.timestamp;
    call.usage = usageOf(message.usage);
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'tool_use' && !call.tools.some((t) => t.id === block.id)) {
        call.tools.push({ id: block.id, name: block.name, input: block.input ?? {} });
        if (block.name === HANDBACK_TOOL && typeof block.input?.message === 'string') call.text += `${block.input.message}\n`;
      }
      if (block?.type === 'text' && typeof block.text === 'string') call.text += `${block.text}\n`;
    }
  }
  return order;
}

function collectResultBytes(entries) {
  const bytes = new Map();
  for (const entry of entries) {
    if (entry?.type !== 'user' || !Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message.content) {
      if (block?.type === 'tool_result' && block.tool_use_id) bytes.set(block.tool_use_id, (bytes.get(block.tool_use_id) ?? 0) + textBytes(block.content));
    }
  }
  return bytes;
}

const VERDICT = /VERDICT:\s*\**\s*([a-z-]+)/i;
const BLOCKING = /BLOCKING:\s*\**\s*(\d+)/i;

export function verdictOf(text) {
  const verdict = text.match(VERDICT);
  if (!verdict) return null;
  const blocking = text.match(BLOCKING);
  return { verdict: verdict[1].toLowerCase(), blocking: blocking ? Number(blocking[1]) : null };
}

export function readAgent(dir, agentId) {
  const text = readInside(dir, `agent-${assertAgentId(agentId)}.jsonl`);
  if (text === null) return null;
  const entries = text.split('\n').filter(Boolean).map(parseJson);
  const calls = collectCalls(entries);
  const verdict = [...calls].reverse().map((c) => verdictOf(c.text)).find(Boolean) ?? null;
  return { calls, resultBytes: collectResultBytes(entries), verdict };
}

export function readRunTree(dir, rootAgentId) {
  assertAgentId(rootAgentId);
  const agents = [];
  const walk = (agentId, depth) => {
    const meta = readMeta(dir, agentId);
    const data = readAgent(dir, agentId);
    if (!meta && !data) throw new Error(`no transcript or meta for agent ${agentId} under ${dir}`);
    agents.push({ agentId, depth, agentType: meta?.agentType ?? (depth === 0 ? 'delegate' : 'unknown'), calls: data?.calls ?? [], resultBytes: data?.resultBytes ?? new Map(), verdict: data?.verdict ?? null });
    for (const child of childrenOf(dir, agentId)) walk(child, depth + 1);
  };
  walk(rootAgentId, 0);
  return agents;
}
