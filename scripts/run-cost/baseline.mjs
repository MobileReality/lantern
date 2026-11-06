import { PHASES } from './phases.mjs';
import { USD_ESTIMATOR } from './prices.mjs';
import { TOKEN_ESTIMATOR } from './transcripts.mjs';

export const BASELINE_SCHEMA = 'lantern-run-cost-baseline';
export const BASELINE_VERSION = 1;

export const BUCKET_FIELDS = ['calls', 'input', 'cacheWrite', 'cacheRead', 'output', 'tokens', 'usd', 'toolOutputTokens'];
const PASS_SOURCES = ['reviewer-verdict', 'flag', 'none'];

const roundUsd = (usd) => Math.round(usd * 10000) / 10000;

function pickBucket(bucket) {
  return Object.fromEntries(BUCKET_FIELDS.map((f) => [f, f === 'usd' ? roundUsd(bucket[f]) : bucket[f]]));
}

export function buildBaseline({ analysis, label, runId, project, passOverride }) {
  const root = analysis.agents[0];
  const pass = passOverride === undefined || passOverride === null ? analysis.pass : { value: passOverride, source: 'flag' };
  return {
    schema: BASELINE_SCHEMA,
    version: BASELINE_VERSION,
    label,
    run: { id: runId, project, model: root.model, effort: root.effort },
    estimators: { toolOutputTokens: TOKEN_ESTIMATOR, usd: USD_ESTIMATOR },
    pass,
    unpricedCalls: analysis.unpricedCalls,
    phases: Object.fromEntries(PHASES.map((p) => [p, pickBucket(analysis.phases[p])])),
    total: pickBucket(analysis.total),
    tools: analysis.tools,
    agents: analysis.agents.map((a) => ({ id: a.id, type: a.type, model: a.model, effort: a.effort, ...pickBucket(a) })),
  };
}

export const serializeBaseline = (baseline) => `${JSON.stringify(baseline, null, 2)}\n`;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function requireBucket(bucket, where) {
  if (!isObject(bucket)) throw new Error(`${where} is missing`);
  for (const field of BUCKET_FIELDS) if (!Number.isFinite(bucket[field])) throw new Error(`${where}.${field} must be a number`);
}

export function parseBaseline(text, name = 'baseline') {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  if (!isObject(data) || data.schema !== BASELINE_SCHEMA) throw new Error(`${name} is not a ${BASELINE_SCHEMA} file`);
  if (data.version !== BASELINE_VERSION) throw new Error(`${name} has version ${data.version}, this tool reads version ${BASELINE_VERSION}`);
  if (typeof data.label !== 'string' || data.label === '') throw new Error(`${name}.label must say how the baseline was made`);
  if (!isObject(data.run) || typeof data.run.id !== 'string' || typeof data.run.project !== 'string') throw new Error(`${name}.run needs id and project`);
  if (!isObject(data.estimators)) throw new Error(`${name}.estimators is missing`);
  if (!isObject(data.pass) || !(data.pass.value === null || typeof data.pass.value === 'boolean') || !PASS_SOURCES.includes(data.pass.source)) throw new Error(`${name}.pass is malformed`);
  if (!isObject(data.phases)) throw new Error(`${name}.phases is missing`);
  for (const phase of PHASES) requireBucket(data.phases[phase], `${name}.phases.${phase}`);
  requireBucket(data.total, `${name}.total`);
  if (!isObject(data.tools)) throw new Error(`${name}.tools is missing`);
  for (const [tool, entry] of Object.entries(data.tools)) {
    if (!Number.isFinite(entry?.calls) || !Number.isFinite(entry?.outputTokens)) throw new Error(`${name}.tools.${tool} needs calls and outputTokens`);
  }
  return data;
}

const signed = (n, digits = 0) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(digits)}`;

function percent(from, to) {
  if (from === 0) return to === 0 ? '0%' : 'new';
  return `${signed(((to - from) / from) * 100, 1)}%`;
}

const passText = (pass) => (pass.value === null ? 'unknown' : pass.value ? 'pass' : 'fail');

export function compareBaselines(a, b) {
  const incompatible = ['toolOutputTokens', 'usd'].filter((k) => a.estimators[k] !== b.estimators[k]);
  if (incompatible.length > 0) throw new Error(`the baselines use different estimators (${incompatible.join(', ')}); the delta would mean nothing`);
  const lines = [`compare: ${a.run.id} (${a.run.project}) -> ${b.run.id} (${b.run.project})`];
  lines.push(`model: ${a.run.model} ${a.run.effort} -> ${b.run.model} ${b.run.effort}`);
  lines.push(`estimators: tool output ${a.estimators.toolOutputTokens}, usd ${a.estimators.usd}`);
  lines.push('');
  lines.push(['phase'.padEnd(10), 'tokens'.padStart(30), 'tool-output'.padStart(30), 'usd'.padStart(34)].join(' '));
  for (const phase of [...PHASES, 'total']) {
    const from = phase === 'total' ? a.total : a.phases[phase];
    const to = phase === 'total' ? b.total : b.phases[phase];
    lines.push(
      [
        phase.padEnd(10),
        `${from.tokens} -> ${to.tokens} (${percent(from.tokens, to.tokens)})`.padStart(30),
        `${from.toolOutputTokens} -> ${to.toolOutputTokens} (${percent(from.toolOutputTokens, to.toolOutputTokens)})`.padStart(30),
        `${from.usd.toFixed(4)} -> ${to.usd.toFixed(4)} (${signed(to.usd - from.usd, 4)})`.padStart(34),
      ].join(' '),
    );
  }
  lines.push('', 'tool-output tokens per tool');
  for (const tool of [...new Set([...Object.keys(a.tools), ...Object.keys(b.tools)])].sort()) {
    const from = a.tools[tool]?.outputTokens ?? 0;
    const to = b.tools[tool]?.outputTokens ?? 0;
    lines.push(`  ${tool.padEnd(14)} ${from} -> ${to} (${signed(to - from)}, ${percent(from, to)})`);
  }
  const samePass = a.pass.value === b.pass.value;
  lines.push('', `pass result: ${passText(a.pass)} -> ${passText(b.pass)}${samePass ? ' (same)' : ' (DIFFERENT)'}`);
  return { samePass, text: lines.join('\n') };
}
