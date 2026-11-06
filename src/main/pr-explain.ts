import { EXPLAINER_ENABLED } from '../shared/pr-explain';
import type { PrExplainDone, PrExplainSavedResult, PrExplainStartResult, PrExplainTarget } from '../shared/pr-explain';
import { readPrFile } from './lantern-prfile';
import { readPrFileDiff } from './lantern-prdiff';
import { buildPrExplainPrompt, PR_EXPLAIN_MODEL } from './pr-explain-prompt';
import { INVALID_REQUEST, parseSaved, parseTarget, resolvePrTarget } from './pr-explain-request';
import type { ResolvedPrExplain } from './pr-explain-request';
import { startOneShot } from './pr-explain-run';
import type { OneShotDeps, OneShotRun, OneShotUsage } from './pr-explain-run';
import { resolveExplanation } from './pr-explain-sections';
import { createPrExplainStore, storeFileFor } from './pr-explain-store';

const MAX_CONCURRENT_RUNS = 3;
const EXPLAINER_OFF = 'Explanations are not available.';
const NOTHING_TO_EXPLAIN = 'There is no text change to explain in this file.';

interface PrExplainDeps {
  projectPaths(): string[];
  userData: string;
  language(project: string): string;
  run: OneShotDeps;
  log(line: string): void;
  now?: () => number;
  enabled?: boolean;
}

interface Flight {
  cancelled: boolean;
  run?: OneShotRun;
}

type Content = { ok: true; kind: 'diff' | 'file'; text: string } | { ok: false; error: string };

function keyOf(target: PrExplainTarget) {
  return `${target.project}\0${target.pr}\0${target.path}`;
}

async function gatherContent({ target, file }: ResolvedPrExplain): Promise<Content> {
  const { project, pr, path } = target;
  if (file.kind === 'added') {
    const read = await readPrFile(project, pr, path);
    if (!read.ok) return { ok: false, error: read.reason ?? NOTHING_TO_EXPLAIN };
    return read.binary || !read.text.trim() ? { ok: false, error: NOTHING_TO_EXPLAIN } : { ok: true, kind: 'file', text: read.text };
  }
  const read = await readPrFileDiff(project, pr, path);
  if (!read.ok) return { ok: false, error: read.reason ?? NOTHING_TO_EXPLAIN };
  return read.binary || !read.diff.trim() ? { ok: false, error: NOTHING_TO_EXPLAIN } : { ok: true, kind: 'diff', text: read.diff };
}

function usageLine(target: PrExplainTarget, usage: OneShotUsage) {
  const part = (label: string, value: number | undefined) => (value === undefined ? `${label}=n/a` : `${label}=${value}`);
  return `[pr-explain] #${target.pr} ${target.path} model=${PR_EXPLAIN_MODEL} ${part('cost_usd', usage.costUsd)} ${part('input_tokens', usage.inputTokens)} ${part('output_tokens', usage.outputTokens)} ${part('ms', usage.durationMs)}`;
}

function createPrExplainService(deps: PrExplainDeps) {
  const flights = new Map<string, Flight>();
  const now = deps.now ?? Date.now;
  const storeOf = (project: string) => createPrExplainStore(storeFileFor(deps.userData, project), undefined, now);

  function conclude(resolved: ResolvedPrExplain, result: Awaited<OneShotRun['done']>, deliver: (done: PrExplainDone) => void) {
    const { target, pr } = resolved;
    if (!result.ok) {
      deliver({ ...target, ok: false, cancelled: result.cancelled, error: result.error });
      return;
    }
    deps.log(usageLine(target, result.usage));
    const { text, sections } = resolveExplanation(result.text, resolved.file.kind === 'added');
    let explanation;
    try {
      explanation = storeOf(target.project).save(target.pr, target.path, pr.head, text, sections);
    } catch (e) {
      deps.log(`[pr-explain] could not save #${target.pr} ${target.path}: ${(e as Error).message}`);
      explanation = { text, ...(sections ? { sections } : {}), head: pr.head, at: now(), stale: false };
    }
    deliver({ ...target, ok: true, explanation });
  }

  async function start(raw: unknown, deliver: (done: PrExplainDone) => void): Promise<PrExplainStartResult> {
    if (!(deps.enabled ?? EXPLAINER_ENABLED)) return { ok: false, error: EXPLAINER_OFF };
    const target = parseTarget(raw, deps.projectPaths());
    if (!target) return { ok: false, error: INVALID_REQUEST };
    const key = keyOf(target);
    if (flights.has(key)) return { ok: false, busy: true, error: 'already running' };
    if (flights.size >= MAX_CONCURRENT_RUNS) return { ok: false, busy: true, error: 'Too many explanations are running. Wait for one to finish.' };
    const flight: Flight = { cancelled: false };
    flights.set(key, flight);
    const release = () => flights.delete(key);
    const refuse = (error: string): PrExplainStartResult => {
      release();
      return { ok: false, error };
    };
    try {
      const resolution = await resolvePrTarget(target);
      if (!resolution.ok) return refuse(resolution.error);
      const resolved = resolution.value;
      const content = await gatherContent(resolved);
      if (!content.ok) return refuse(content.error);
      if (flight.cancelled) return refuse('Cancelled.');
      const prompt = buildPrExplainPrompt({
        language: deps.language(target.project),
        title: resolved.pr.title,
        reason: resolved.file.reason ?? '',
        path: target.path,
        kind: resolved.file.kind,
        otherPaths: resolved.pr.files.map((f) => f.path).filter((p) => p !== target.path),
        content: { kind: content.kind, text: content.text },
      });
      const run = startOneShot(deps.run, prompt);
      if ('error' in run) return refuse(run.error);
      flight.run = run;
      void run.done.then((result) => {
        release();
        conclude(resolved, result, deliver);
      });
      return { ok: true };
    } catch (e) {
      return refuse((e as Error).message);
    }
  }

  function cancel(raw: unknown) {
    const target = parseTarget(raw, deps.projectPaths());
    const flight = target ? flights.get(keyOf(target)) : undefined;
    if (!flight) return false;
    flight.cancelled = true;
    flight.run?.cancel();
    return true;
  }

  function saved(raw: unknown): PrExplainSavedResult {
    const request = parseSaved(raw, deps.projectPaths());
    if (!request) return { ok: false, error: INVALID_REQUEST };
    const { target, head } = request;
    return { ok: true, explanation: storeOf(target.project).lookup(target.pr, target.path, head) };
  }

  function cancelAll() {
    for (const flight of flights.values()) {
      flight.cancelled = true;
      flight.run?.cancel();
    }
  }

  return { start, cancel, saved, cancelAll, running: () => flights.size };
}

export { EXPLAINER_OFF, MAX_CONCURRENT_RUNS, NOTHING_TO_EXPLAIN, createPrExplainService };
export type { PrExplainDeps };
