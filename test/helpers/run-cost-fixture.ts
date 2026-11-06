import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DELEGATE_ID = 'adelegate1';
export const REVIEWER_ID = 'areviewer1';
export const MODEL = 'claude-sonnet-5-5';

type Block = Record<string, unknown>;

const USAGE = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 };
export const CALL_USD = (10 * 2 + 50 * 10 + 1000 * 0.2 + 100 * 2 * 1.25) / 1_000_000;

let sequence = 0;
const nextId = (prefix: string) => `${prefix}${++sequence}`;

export const toolUse = (name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id: nextId('toolu_'), name, input });

function assistantLine(messageId: string, block: Block, output: number, model: string) {
  return JSON.stringify({
    type: 'assistant',
    effort: 'medium',
    timestamp: `2026-10-16T09:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    message: { id: messageId, model, role: 'assistant', content: [block], usage: { ...USAGE, output_tokens: output } },
  });
}

function resultLine(toolUseId: string, content: unknown) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] } });
}

export interface FakeCall {
  tools: Block[];
  results?: Array<string | Array<{ type: string; text?: string }>>;
  text?: string;
  model?: string;
}

export function agentTranscript(calls: FakeCall[]): string {
  const lines: string[] = [];
  for (const call of calls) {
    const messageId = nextId('msg_');
    const blocks: Block[] = call.text ? [{ type: 'text', text: call.text }, ...call.tools] : call.tools;
    blocks.forEach((block, i) => {
      lines.push(assistantLine(messageId, block, i === blocks.length - 1 ? 50 : 5, call.model ?? MODEL));
    });
    call.tools.forEach((tool, i) => {
      const result = call.results?.[i];
      if (result !== undefined) lines.push(resultLine(tool.id as string, result));
    });
  }
  return `${lines.join('\n')}\n`;
}

export const bytes = (n: number) => 'x'.repeat(n);

export const VERDICT_GREEN = 'VERDICT: merge-with-followups\nBLOCKING: 0\nCONVENTIONS: team-conventions\nUNAVAILABLE: none';
export const VERDICT_RED = 'VERDICT: fix\nBLOCKING: 2\nCONVENTIONS: team-conventions\nUNAVAILABLE: none';

export function delegateCalls(): FakeCall[] {
  const spawn = toolUse('Agent', { subagent_type: 'reviewer', prompt: 'review it' });
  return [
    { tools: [toolUse('Bash', { command: 'git fetch origin' })], results: ['(Bash completed with no output)'] },
    { tools: [toolUse('Read', { file_path: '/p/.claude/skills/commit/SKILL.md' })], results: [bytes(800)] },
    { tools: [toolUse('Edit', { file_path: '/p/src/a.ts' }), toolUse('Bash', { command: 'pnpm exec vitest run' })], results: ['edited', bytes(400)] },
    { tools: [spawn], results: ['reviewed'] },
    { tools: [toolUse('Bash', { command: 'node .claude/skills/lantern-sync/scripts/sync.mjs finish --base main' })], results: [bytes(200)] },
    { tools: [toolUse('Bash', { command: 'git push origin HEAD:refs/heads/feat/x' })], results: [bytes(40)] },
  ];
}

export function reviewerCalls(verdict: string): FakeCall[] {
  return [
    { tools: [toolUse('Bash', { command: 'git diff main...HEAD' })], results: [bytes(40)] },
    { tools: [toolUse('Grep', { pattern: 'foo' })], results: [[{ type: 'text', text: bytes(120) }, { type: 'tool_reference' }]] },
    { tools: [toolUse('SubagentHandback', { message: verdict })], results: [''] },
  ];
}

export interface FixtureOptions {
  verdict?: string | null;
}

export function writeRun(root: string, options: FixtureOptions = {}): string {
  const dir = path.join(root, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);
  write(`agent-${DELEGATE_ID}.meta.json`, JSON.stringify({ agentType: 'lantern-delegate-medium' }));
  write(`agent-${DELEGATE_ID}.jsonl`, agentTranscript(delegateCalls()));
  if (options.verdict !== null) {
    write(`agent-${REVIEWER_ID}.meta.json`, JSON.stringify({ agentType: 'reviewer', parentAgentId: DELEGATE_ID }));
    write(`agent-${REVIEWER_ID}.jsonl`, agentTranscript(reviewerCalls(options.verdict ?? VERDICT_GREEN)));
  }
  return dir;
}

export function tmpRoot(prefix = 'run-cost-'): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}
