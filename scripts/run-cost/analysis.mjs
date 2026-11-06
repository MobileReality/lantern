import { PHASES, assignPhases, isReviewerType } from './phases.mjs';
import { callUsd } from './prices.mjs';
import { estimateTokens } from './transcripts.mjs';

const GREEN_VERDICTS = new Set(['merge', 'merge-with-followups']);

export const emptyBucket = () => ({ calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, tokens: 0, usd: 0, toolOutputTokens: 0 });

function addCall(bucket, call, usd) {
  const { input, cacheWrite, cacheRead, output } = call.usage;
  bucket.calls += 1;
  bucket.input += input;
  bucket.cacheWrite += cacheWrite;
  bucket.cacheRead += cacheRead;
  bucket.output += output;
  bucket.tokens += input + cacheWrite + cacheRead + output;
  bucket.usd += usd ?? 0;
}

function addMerged(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key];
}

function lastTimestamp(agent) {
  return agent.calls.map((c) => c.timestamp ?? '').sort().at(-1) ?? '';
}

export function passFromReviewers(agents) {
  const verdicts = agents
    .filter((a) => isReviewerType(a.agentType) && a.verdict)
    .sort((a, b) => lastTimestamp(a).localeCompare(lastTimestamp(b)));
  const last = verdicts.at(-1)?.verdict;
  if (!last) return { value: null, source: 'none' };
  return { value: GREEN_VERDICTS.has(last.verdict) && last.blocking === 0, source: 'reviewer-verdict' };
}

export function analyseRun(agents, linker) {
  const phases = Object.fromEntries(PHASES.map((p) => [p, emptyBucket()]));
  const tools = new Map();
  const perAgent = [];
  let unpricedCalls = 0;
  for (const agent of agents) {
    const row = { id: agent.agentId, type: agent.agentType, model: agent.calls[0]?.model ?? null, effort: agent.calls[0]?.effort ?? null, ...emptyBucket() };
    const callPhases = assignPhases(agent.agentType, agent.calls, linker);
    agent.calls.forEach((call, i) => {
      const usd = callUsd(call.model, call.usage);
      if (usd === null) unpricedCalls += 1;
      addCall(phases[callPhases[i]], call, usd);
      addCall(row, call, usd);
      for (const tool of call.tools) {
        const tokens = estimateTokens(agent.resultBytes.get(tool.id) ?? 0);
        const entry = tools.get(tool.name) ?? { calls: 0, outputTokens: 0 };
        entry.calls += 1;
        entry.outputTokens += tokens;
        tools.set(tool.name, entry);
        phases[callPhases[i]].toolOutputTokens += tokens;
        row.toolOutputTokens += tokens;
      }
    });
    perAgent.push(row);
  }
  const total = emptyBucket();
  for (const phase of PHASES) addMerged(total, phases[phase]);
  return { phases, total, tools: Object.fromEntries([...tools].sort(([a], [b]) => a.localeCompare(b))), agents: perAgent, unpricedCalls, pass: passFromReviewers(agents) };
}
