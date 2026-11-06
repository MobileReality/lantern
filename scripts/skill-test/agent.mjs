import path from 'node:path';
import { sessionFailure } from '../e2e-delegate/execute.mjs';
import { capExceeded, sumCost } from '../e2e-delegate/report.mjs';
import { runClaude } from '../e2e-delegate/session.mjs';

export const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const BUDGET_EXCEEDED = 'error_max_budget_usd';

export const usd = (n) => `$${n.toFixed(2)}`;
const budgetArg = (remainingUsd) => Math.floor(remainingUsd * 10000) / 10000;

export function costFailure(spentUsd, capUsd) {
  return capExceeded(spentUsd, capUsd) ? `cost cap exceeded: spent ${usd(spentUsd)} of cap ${usd(capUsd)}` : null;
}

export async function runAgent(ctx, { name, cwd, prompt, timeoutMs = AGENT_TIMEOUT_MS }) {
  const remaining = ctx.capUsd - ctx.spentUsd;
  if (remaining <= 0) return { ok: false, capExceeded: true, reason: costFailure(ctx.spentUsd, ctx.capUsd) ?? `no budget left of cap ${usd(ctx.capUsd)}` };
  const session = await runClaude({
    bin: ctx.bin,
    cwd,
    prompt,
    budgetUsd: budgetArg(remaining),
    logFile: path.join(ctx.logsDir, `${name}.jsonl`),
    timeoutMs,
    children: ctx.children,
  });
  const cost = sumCost(session.results);
  ctx.spentUsd += cost;
  const overCap = costFailure(ctx.spentUsd, ctx.capUsd);
  if (overCap) return { ok: false, capExceeded: true, reason: overCap, costUsd: cost };
  if (session.result?.subtype === BUDGET_EXCEEDED) return { ok: false, capExceeded: true, reason: `cost cap exceeded: the agent hit its budget of ${usd(remaining)}`, costUsd: cost };
  const failure = sessionFailure(session);
  return failure ? { ok: false, reason: failure, costUsd: cost } : { ok: true, costUsd: cost, report: String(session.result?.result ?? '') };
}
