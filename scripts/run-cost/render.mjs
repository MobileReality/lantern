import { PHASES } from './phases.mjs';

const usd = (n) => `$${n.toFixed(4)}`;
const cell = (value, width) => String(value).padStart(width);

const COLUMNS = [
  ['calls', 6],
  ['input', 9],
  ['cache-write', 12],
  ['cache-read', 12],
  ['output', 9],
  ['tokens', 12],
  ['usd', 10],
  ['tool-output', 12],
];

const bucketCells = (b) => [b.calls, b.input, b.cacheWrite, b.cacheRead, b.output, b.tokens, usd(b.usd), b.toolOutputTokens].map((v, i) => cell(v, COLUMNS[i][1]));

export function renderRun(baseline) {
  const { run, phases, total, tools, agents, pass, estimators, unpricedCalls } = baseline;
  const head = ['phase'.padEnd(10), ...COLUMNS.map(([name, width]) => cell(name, width))].join(' ');
  const lines = [`run ${run.id} (${run.project}) ${run.model} ${run.effort}`, `${baseline.label}`, '', head];
  for (const phase of PHASES) lines.push([phase.padEnd(10), ...bucketCells(phases[phase])].join(' '));
  lines.push(['total'.padEnd(10), ...bucketCells(total)].join(' '), '');
  lines.push('tool-output tokens per tool');
  for (const [name, entry] of Object.entries(tools).sort((x, y) => y[1].outputTokens - x[1].outputTokens)) {
    lines.push(`  ${name.padEnd(16)} ${cell(entry.outputTokens, 9)} tokens in ${entry.calls} call(s)`);
  }
  lines.push('', 'per agent');
  for (const a of agents) lines.push(`  ${a.type.padEnd(22)} ${a.model ?? 'n/a'} ${a.effort ?? 'n/a'}: ${a.calls} call(s), ${a.tokens} tokens, ${usd(a.usd)}, ${a.toolOutputTokens} tool-output tokens`);
  lines.push('', `pass result: ${pass.value === null ? 'unknown' : pass.value ? 'pass' : 'fail'} (${pass.source})`);
  lines.push(`tool-output tokens: estimated as ${estimators.toolOutputTokens} of tool_result text (no offline API token counter)`);
  lines.push(`usd: ${estimators.usd}; not billed telemetry${unpricedCalls > 0 ? `; ${unpricedCalls} call(s) on an unpriced model count as 0` : ''}`);
  return lines.join('\n');
}
