import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { areaSpec } from './helpers/lantern-areas-fixtures';
import { makeVocabProject, removeVocabProjects } from './helpers/lantern-vocab-project';

vi.setConfig({ testTimeout: 60_000 });

const SCRIPT = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'areas.mjs');
const FEATURES = ['catalog', 'orders', 'payments', 'invoices', 'shipping', 'returns', 'accounts', 'reports', 'search'];
const TREE = [
  'order-handling', '  catalog', '  orders',
  'money-matters', '  payments', '  invoices',
  'parcel-delivery', '  shipping', '  returns',
  'people-and-insight', '  accounts',
  'retired-code', '  reports',
  '',
].join('\n');
const REAL: Record<string, string> = {
  catalog: 'order-handling', orders: 'order-handling', payments: 'money-matters', invoices: 'money-matters',
  shipping: 'parcel-delivery', returns: 'parcel-delivery', accounts: 'people-and-insight', reports: 'retired-code',
};
const CLAUDE_ARGS = ['-p', '--model', 'claude-sonnet-5-5', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'];

const STUB = `
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const lines = input.split('\\n');
  const feature = /what (.+) covers/.exec(lines[lines.indexOf('Feature:') + 1])[1];
  const real = JSON.parse(process.env.STUB_REAL);
  const mode = process.env.STUB_MODE || 'right';
  const other = Object.values(real).find((a) => a !== real[feature]);
  if (feature === process.env.STUB_BAD && mode === 'error') { process.stderr.write('boom\\n'); process.exit(3); }
  if (feature === process.env.STUB_BAD && mode === 'hang') return void setInterval(() => {}, 1000);
  console.log(mode === 'shuffle' ? other : real[feature]);
});
`;

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const real = JSON.parse(process.env.STUB_REAL);
  const feature = /what (.+) covers/.exec(input.split('\\n')[input.split('\\n').indexOf('Feature:') + 1])[1];
  const call = { args: process.argv.slice(2), cwd: process.cwd(), hasElectronFlag: 'ELECTRON_RUN_AS_NODE' in process.env, input };
  fs.appendFileSync(path.join(process.env.CALLS_DIR, 'calls.jsonl'), JSON.stringify(call) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: real[feature], total_cost_usd: 0.005 }));
});
`;

const dirs: string[] = [];
afterEach(() => {
  removeVocabProjects();
  dirs.splice(0).forEach((d) => { fs.rmSync(d, { recursive: true, force: true }); });
});

function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-run-')));
  dirs.push(dir);
  return dir;
}

function stubReader() {
  const file = path.join(tmp(), 'stub.cjs');
  fs.writeFileSync(file, STUB);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`;
}

function run(args: string[], env: Record<string, string> = {}) {
  const root = fs.realpathSync(makeVocabProject(areaSpec(TREE, FEATURES)));
  const out = path.join(tmp(), 'areas');
  const result = spawnSync(process.execPath, [SCRIPT, root, 'lookup', 'run', '--out', out, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANTERN_LANG: 'en', STUB_REAL: JSON.stringify(REAL), ...env },
  });
  return { root, out, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('areas.mjs lookup run with a --reader', () => {
  it('passes when the reader answers every packet right, and keeps answers.json beside the packets', () => {
    const r = run(['--reader', stubReader()]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('LOOKUP PASS: 8 of 8');
    expect(JSON.parse(fs.readFileSync(path.join(r.out, 'answers.json'), 'utf8'))).toEqual(REAL);
    expect(fs.existsSync(path.join(r.out, 'manifest.json'))).toBe(true);
  });

  it('fails with the misplaced list when the reader answers wrong', () => {
    const r = run(['--reader', stubReader()], { STUB_MODE: 'shuffle' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('LOOKUP FAIL');
    expect(r.stdout).toMatch(/revise orders: it is in order-handling, the reader chose /);
  });

  it('exits 2 and names the packet whose reader errors', () => {
    const r = run(['--reader', stubReader()], { STUB_MODE: 'error', STUB_BAD: 'orders' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no answer for orders: boom');
    expect(r.stdout).toContain('no answer for orders');
  });

  it('exits 2 and names the packet whose reader times out', () => {
    const r = run(['--reader', stubReader(), '--timeout-ms', '1500'], { STUB_MODE: 'hang', STUB_BAD: 'payments' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no answer for payments: timed out');
  });
});

describe('areas.mjs lookup run with the claude call', () => {
  it('runs one tool-less call per packet, outside the project, without ELECTRON_RUN_AS_NODE', () => {
    const bin = tmp();
    fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
    const r = run([], { CLAUDE_BIN: path.join(bin, 'claude'), CALLS_DIR: bin, ELECTRON_RUN_AS_NODE: '1' });
    expect(r.status).toBe(0);
    const calls = fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(calls).toHaveLength(8);
    for (const call of calls) {
      expect(call.args).toEqual(CLAUDE_ARGS);
      expect(call.cwd).not.toBe(r.root);
      expect(path.relative(r.root, call.cwd).startsWith('..')).toBe(true);
      expect(call.hasElectronFlag).toBe(false);
      expect(call.input).toContain('Which area would you look in for this feature?');
    }
    expect(r.stdout).toContain('cost: $0.0400 over 8 calls');
  });

  it('takes the model from --model', () => {
    const bin = tmp();
    fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
    run(['--model', 'claude-opus-5'], { CLAUDE_BIN: path.join(bin, 'claude'), CALLS_DIR: bin });
    const first = JSON.parse(fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').split('\n')[0]);
    expect(first.args.slice(0, 3)).toEqual(['-p', '--model', 'claude-opus-5']);
  });

  it('exits 2 when claude cannot be started', () => {
    const r = run([], { CLAUDE_BIN: path.join(tmp(), 'missing-claude') });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no answer for catalog');
  });
});
