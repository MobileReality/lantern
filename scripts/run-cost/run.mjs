#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuredSkillLinkerPath } from '../../skills/lantern-delegate/scripts/skill-linker.mjs';
import { analyseRun } from './analysis.mjs';
import { buildBaseline, compareBaselines, parseBaseline, serializeBaseline } from './baseline.mjs';
import { renderRun } from './render.mjs';
import { readRunTree } from './transcripts.mjs';

export const USAGE = `usage: pnpm run run-cost -- <transcripts-dir> --agent-id <id> [--project <name>] [--run-id <id>] [--label <text>] [--pass | --fail] [--out <baseline.json>] [--json]
       pnpm run run-cost -- --compare <a.json> <b.json>
  Prints tokens and USD per phase (brief, work, review, handover) and tool-output tokens per tool for one
  delegate run, read only from <transcripts-dir> (the folder holding agent-<id>.jsonl and agent-<id>.meta.json).
  --agent-id  the delegate; its reviewers are found through parentAgentId in the meta files
  --out       write the versioned baseline file; needs --label saying how the baseline was made
  --pass/--fail  set the pass result; without it, the last reviewer's verdict decides (VERDICT merge and BLOCKING 0 = pass)
  --compare   print the delta of two baseline files; exit 1 when the pass result differs, 2 when a file is unusable
  Offline. Tool-output tokens are bytes/4; USD is list price times the usage in the transcript.`;

export function parseArgs(argv) {
  const opts = { dir: null, agentId: null, project: 'unknown', runId: null, label: null, pass: undefined, out: null, json: false, compare: null, help: false };
  const need = (i, flag) => {
    if (argv[i + 1] === undefined) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--pass') opts.pass = true;
    else if (arg === '--fail') opts.pass = false;
    else if (arg === '--agent-id') opts.agentId = need(i++, arg);
    else if (arg === '--project') opts.project = need(i++, arg);
    else if (arg === '--run-id') opts.runId = need(i++, arg);
    else if (arg === '--label') opts.label = need(i++, arg);
    else if (arg === '--out') opts.out = need(i++, arg);
    else if (arg === '--compare') {
      opts.compare = [need(i, arg), need(i + 1, arg)];
      i += 2;
    } else if (arg.startsWith('-')) throw new Error(`unknown argument ${arg}`);
    else if (opts.dir) throw new Error(`one transcripts directory at a time, got "${opts.dir}" and "${arg}"`);
    else opts.dir = arg;
  }
  if (opts.help) return opts;
  if (opts.compare) {
    if (opts.dir || opts.agentId || opts.out) throw new Error('--compare takes two baseline files and nothing else');
    return opts;
  }
  if (!opts.dir) throw new Error('give the transcripts directory');
  if (!opts.agentId) throw new Error('give --agent-id');
  if (opts.out && !opts.label) throw new Error('--out needs --label saying how the baseline was made');
  opts.runId ??= opts.agentId;
  return opts;
}

function compare([fileA, fileB], out) {
  try {
    const a = parseBaseline(fs.readFileSync(fileA, 'utf8'), fileA);
    const b = parseBaseline(fs.readFileSync(fileB, 'utf8'), fileB);
    const result = compareBaselines(a, b);
    out.log(result.text);
    return result.samePass ? 0 : 1;
  } catch (error) {
    out.err(`run-cost: ${error.message}`);
    return 2;
  }
}

function measure(opts, out) {
  const dir = path.resolve(opts.dir);
  const analysis = analyseRun(readRunTree(dir, opts.agentId), configuredSkillLinkerPath());
  if (analysis.total.calls === 0) throw new Error(`no API calls found for agent ${opts.agentId} under ${dir}`);
  const baseline = buildBaseline({ analysis, label: opts.label ?? 'not stored', runId: opts.runId, project: opts.project, passOverride: opts.pass });
  if (opts.out) fs.writeFileSync(opts.out, serializeBaseline(baseline));
  out.log(opts.json ? serializeBaseline(baseline).trimEnd() : renderRun(baseline));
  if (opts.out && !opts.json) out.log(`\nwrote ${opts.out}`);
  return 0;
}

export function main(argv, out = { log: console.log, err: console.error }) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      out.log(USAGE);
      return 0;
    }
    return opts.compare ? compare(opts.compare, out) : measure(opts, out);
  } catch (error) {
    out.err(`run-cost: ${error.message}`);
    out.err(USAGE);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
