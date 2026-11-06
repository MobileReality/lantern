import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LANTERN_CODEX_MODEL, codexArgs, codexBinCandidates, createCodexDecoder, parseCodexRecord, resolveCodexBin } from '../src/main/agent-codex';

describe('codexArgs', () => {
  it('probes the packaged ChatGPT CLI and normal PATH locations for GUI launches', () => {
    const candidates = codexBinCandidates({ PATH: '/custom/bin:/other/bin' }, '/home/me', 'darwin');
    expect(candidates[0]).toBe('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
    expect(candidates).toContain('/home/me/.local/bin/codex');
    expect(candidates).toContain('/custom/bin/codex');
  });

  it('resolves only a direct Windows executable and keeps metacharacter paths in one argv value', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern cli & ^!%-'));
    try {
      const executable = path.join(root, 'codex.exe');
      const shim = path.join(root, 'codex.cmd');
      fs.writeFileSync(executable, 'native');
      fs.writeFileSync(shim, 'shim');
      expect(resolveCodexBin([shim], 'win32')).toBeNull();
      expect(resolveCodexBin([shim, executable], 'win32')).toBe(executable);
      const candidates = codexBinCandidates({ PATH: `${root};C:\\tools`, APPDATA: root }, 'C:\\Users\\me', 'win32', 'x64');
      expect(candidates.every((candidate) => candidate.endsWith('.exe'))).toBe(true);
      expect(candidates.some((candidate) => candidate.includes('codex-win32-x64'))).toBe(true);
      expect(resolveCodexBin(candidates, 'win32')).toBe(executable);

      const cwd = 'C:\\repo with spaces & echo "injected" ^!%';
      const args = codexArgs('explain', null, cwd);
      expect(args[args.indexOf('--cd') + 1]).toBe(cwd);
      expect(args.filter((arg) => arg === cwd)).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps sandbox and approval flags before a fresh stdin exec', () => {
    expect(codexArgs('explain')).toEqual(['--sandbox', 'workspace-write', '--ask-for-approval', 'never', 'exec', '--json', '-']);
  });

  it('forks only the supplied provider session and keeps the prompt out of argv', () => {
    expect(codexArgs('explain', '01a0fc31-fd36-7051-91b9-e594352e2387', '/repo')).toEqual([
      '--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--cd', '/repo', 'exec', 'fork', '--json', '01a0fc31-fd36-7051-91b9-e594352e2387', '-',
    ]);
  });

  it('rejects an option-shaped session id before it reaches argv', () => {
    expect(() => codexArgs('explain', '--dangerously-bypass')).toThrow(/Invalid Codex session id/);
  });

  it('pins the model for map runs only', () => {
    for (const kind of ['lantern', 'lantern-refresh'] as const) {
      const args = codexArgs(kind);
      expect(args[args.indexOf('--model') + 1]).toBe(LANTERN_CODEX_MODEL);
      expect(args.indexOf('--model')).toBeLessThan(args.indexOf('exec'));
    }
    for (const kind of ['explain', 'fix'] as const) expect(codexArgs(kind)).not.toContain('--model');
  });

});

describe('Codex JSONL', () => {
  it('normalizes start, messages, tool activity and measured completion without a cost', () => {
    let now = 1_000;
    const events: any[] = [];
    const threads: string[] = [];
    const decoder = createCodexDecoder({ emit: (event) => events.push(event), onThread: (id) => threads.push(id), now: () => now });
    const records = [
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'git status' } },
      { type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'git status' } },
      { type: 'item.completed', item: { id: 'file', type: 'file_change' } },
      { type: 'item.started', item: { id: 'mcp', type: 'mcp_tool_call', server: 'files', tool: 'read' } },
      { type: 'item.completed', item: { id: 'web', type: 'web_search', query: 'docs' } },
      { type: 'item.started', item: { id: 'collab', type: 'collab_tool_call', tool: 'wait' } },
      { type: 'item.completed', item: { id: 'msg', type: 'agent_message', text: 'Zażółć 🏮' } },
      { type: 'turn.completed', usage: { output_tokens: 2 } },
      { type: 'error', message: 'late error' },
    ].map(JSON.stringify);
    now = 3_500;
    const stream = records.join('\n');
    decoder.write(stream.slice(0, 71));
    decoder.write(stream.slice(71));
    decoder.flush();

    expect(threads).toEqual(['thread-1']);
    expect(events.filter((event) => event.kind === 'tool')).toEqual([
      { kind: 'tool', tool: 'Bash', detail: 'git status' },
      { kind: 'tool', tool: 'File change' },
      { kind: 'tool', tool: 'files: read' },
      { kind: 'tool', tool: 'Web search: docs' },
      { kind: 'tool', tool: 'Collaboration: wait' },
    ]);
    expect(events.filter((event) => event.kind === 'text')).toEqual([{ kind: 'text', text: 'Zażółć 🏮' }]);
    expect(events.filter((event) => event.kind === 'done')).toEqual([{ kind: 'done', ok: true, durationMs: 2500 }]);
    expect(events.filter((event) => event.kind === 'error')).toEqual([]);
    expect(events.some((event) => 'costUsd' in event)).toBe(false);
  });

  it('flushes a final line without a newline and bounds malformed diagnostics', () => {
    const emit = vi.fn();
    const decoder = createCodexDecoder({ emit, onThread: vi.fn() });
    decoder.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'tail' } }));
    decoder.flush();
    expect(emit).toHaveBeenCalledWith({ kind: 'text', text: 'tail' });

    decoder.write('x'.repeat(300_000));
    decoder.flush();
    expect(decoder.diagnostic().length).toBeLessThanOrEqual(16 * 1024);
  });

  it('maps failures and ignores unknown records', () => {
    expect(parseCodexRecord('{"type":"turn.failed","error":{"message":"model unavailable"}}', 10).event).toEqual({ kind: 'error', text: 'model unavailable' });
    expect(parseCodexRecord('{"type":"future.event"}', 10)).toEqual({});
  });
});
