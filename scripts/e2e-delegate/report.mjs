import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const DEFAULT_CAP_USD = 12;
export const ESTIMATE_USD = 7;
const SETUP_SHARE = 0.3;

export function parseResultLines(text) {
  const results = [];
  for (const raw of text.split('\n')) {
    if (!raw.includes('"result"')) continue;
    try {
      const entry = JSON.parse(raw);
      if (entry?.type === 'result') results.push(entry);
    } catch {}
  }
  return results;
}

export function sumCost(results) {
  return results.reduce((sum, r) => sum + (Number.isFinite(r.total_cost_usd) ? r.total_cost_usd : 0), 0);
}

export function resolveCap(env) {
  const raw = env.E2E_MAX_USD;
  if (raw === undefined || raw === '') return DEFAULT_CAP_USD;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error(`E2E_MAX_USD must be a positive number, got "${raw}"`);
  return cap;
}

export function planBudgets(capUsd, projectCount) {
  const perProject = capUsd / projectCount;
  const setup = Math.floor(perProject * SETUP_SHARE * 100) / 100;
  const run = Math.floor((perProject - setup) * 100) / 100;
  return { setup, run };
}

export const capExceeded = (spentUsd, capUsd) => spentUsd > capUsd;

export function fingerprintFile(file) {
  try {
    return createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch (e) {
    if (e.code === 'ENOENT') return 'absent';
    throw e;
  }
}

export function withConfigGuard(report, { file, before, after }) {
  const unchanged = before === after;
  return { ...report, passed: report.passed && unchanged, realConfig: { file, before, after, unchanged } };
}

export function buildReport({ startedAt, capUsd, projects, aborted }) {
  const rows = projects.map((p) => {
    const hardFailed = p.checks.filter((c) => c.hard && !c.ok);
    return {
      name: p.name,
      passed: hardFailed.length === 0,
      costUsd: round(p.setupCostUsd + p.runCostUsd),
      costUnknown: p.costUnknown === true,
      setupCostUsd: round(p.setupCostUsd),
      runCostUsd: round(p.runCostUsd),
      checks: p.checks,
      failed: hardFailed.map((c) => c.name),
    };
  });
  const totalUsd = round(rows.reduce((sum, r) => sum + r.costUsd, 0));
  const overCap = capExceeded(totalUsd, capUsd);
  const passed = rows.length > 0 && rows.every((r) => r.passed) && !overCap && !aborted;
  const costLowerBound = rows.some((r) => r.costUnknown);
  return { startedAt, capUsd, totalUsd, costLowerBound, overCap, aborted: aborted ?? null, passed, projects: rows };
}

const round = (usd) => Math.round(usd * 10000) / 10000;
const usd = (n, lowerBound = false) => `${lowerBound ? '>= ' : ''}$${n.toFixed(2)}`;

function checkLine(c) {
  const mark = c.ok ? 'PASS' : c.hard ? 'FAIL' : 'WARN';
  return `  ${mark.padEnd(4)} ${c.name.padEnd(28)} ${c.reason}`;
}

export function renderReport(report) {
  const lines = [];
  for (const p of report.projects) {
    lines.push(`${p.passed ? 'PASS' : 'FAIL'} ${p.name} (${usd(p.costUsd, p.costUnknown)}: setup ${usd(p.setupCostUsd)}, run ${usd(p.runCostUsd)})`);
    lines.push(...p.checks.map(checkLine));
  }
  lines.push('');
  lines.push(`total cost ${usd(report.totalUsd, report.costLowerBound)}${report.costLowerBound ? ' (a session gave no result line, so the real cost is unknown)' : ''} of cap ${usd(report.capUsd)}${report.overCap ? ' (CAP EXCEEDED)' : ''}`);
  if (report.aborted) lines.push(`aborted: ${report.aborted}`);
  if (report.realConfig) lines.push(`real extensions config ${report.realConfig.file} sha1 before ${report.realConfig.before}, after ${report.realConfig.after}: ${report.realConfig.unchanged ? 'unchanged' : 'CHANGED'}`);
  lines.push(report.passed ? 'RESULT: PASS' : `RESULT: FAIL (${failedSummary(report)})`);
  return lines.join('\n');
}

function failedSummary(report) {
  const parts = report.projects.filter((p) => !p.passed).map((p) => `${p.name}: ${p.failed.join(', ')}`);
  if (report.overCap) parts.push('cost cap exceeded');
  if (report.aborted) parts.push('aborted');
  if (report.realConfig && !report.realConfig.unchanged) parts.push('real extensions config changed');
  return parts.join('; ');
}

export const exitCodeFor = (report) => (report.passed ? 0 : 1);
