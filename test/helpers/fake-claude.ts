import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ pid: process.pid, args: process.argv.slice(2), cwd: process.cwd(), input }) + '\\n');
  const mode = process.env.FAKE_CLAUDE_MODE || '';
  const reply = (body, code = 0) => {
    process.stdout.write(JSON.stringify(body));
    process.exit(code);
  };
  const ok = (result) => reply({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.0123, duration_ms: 42, usage: { input_tokens: 100, output_tokens: 30 } });
  const stream = (success) => {
    const lines = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixing the plan.' }, { type: 'tool_use', name: 'Edit', input: { file_path: '.lantern/plans/p.plan' } }] } },
      { type: 'result', subtype: success ? 'success' : 'error_during_execution', is_error: !success, total_cost_usd: 0.01, duration_ms: 42, permission_denials: success ? [] : [{}, {}] },
    ];
    process.stdout.write(lines.map((l) => JSON.stringify(l) + '\\n').join(''));
    process.exit(0);
  };
  if (mode.startsWith('lantern')) {
    const helper = require('node:url').pathToFileURL(process.env.FAKE_CLAUDE_LANTERN).href;
    import(helper).then((m) => m.run({ args: process.argv.slice(2), input, env: process.env })).then(
      (code) => process.exit(code || 0),
      (e) => {
        process.stderr.write(String((e && e.stack) || e) + '\\n');
        process.exit(4);
      },
    );
    return;
  }
  if (mode === 'stream') return stream(true);
  if (mode === 'stream-fail') return stream(false);
  if (mode === 'hang') return void setInterval(() => {}, 1000);
  if (mode === 'error') {
    process.stderr.write('boom from fake claude\\n');
    process.exit(3);
  }
  if (mode === 'apierror') return reply({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Credit balance is too low' }, 1);
  if (mode === 'garbage') {
    process.stdout.write('this is not json');
    process.exit(0);
  }
  if (mode === 'empty') return ok('   ');
  if (mode === 'html') return ok('<img src=x onerror=alert(1)> <b>bold</b>');
  if (mode === 'long') return ok('x'.repeat(50000));
  if (mode === 'reply') return ok(process.env.FAKE_CLAUDE_REPLY || '');
  if (mode === 'second') return ok('Second explanation.');
  ok('It adds a guard. It runs before the call. It affects callers.');
});
`;

interface FakeCall {
  pid: number;
  args: string[];
  cwd: string;
  input: string;
}

interface FakeClaude {
  bin: string;
  calls(): FakeCall[];
}

function installFakeClaude(dir: string): FakeClaude {
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, SCRIPT, { mode: 0o755 });
  const log = path.join(dir, 'calls.jsonl');
  return {
    bin,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeCall) : []),
  };
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export { installFakeClaude, isAlive };
export type { FakeCall, FakeClaude };
