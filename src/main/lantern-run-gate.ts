import { Worker } from 'node:worker_threads';

interface WorkerDenial {
  tool: string;
  detail?: string;
  text: string;
}

interface RunWatch {
  uses: Map<string, { tool: string; detail?: string }>;
  denied: WorkerDenial[];
}

type GateResult = { ok: true } | { ok: false; text: string };

const DENIAL_TEXT = /permission to use .{1,40} has been denied|requires (?:permission|approval)|can't be checked before it runs|cannot be auto-allowed|contains multiple operations/i;
const GATE_TIMEOUT_MS = 60_000;
const SHOWN_COMMAND = 140;
const NOTHING_TO_SAY = 'no output';

function newWatch(): RunWatch {
  return { uses: new Map(), denied: [] };
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ');
}

function watchMessage(watch: RunWatch, msg: any, detailOf: (input: any) => string | undefined) {
  const fromWorker = !!(msg?.parent_tool_use_id || msg?.isSidechain);
  const content = msg?.message?.content;
  if (!fromWorker || !Array.isArray(content)) return;
  for (const part of content) {
    if (msg.type === 'assistant' && part?.type === 'tool_use' && typeof part.id === 'string') {
      watch.uses.set(part.id, { tool: String(part.name), detail: detailOf(part.input) });
    } else if (msg.type === 'user' && part?.type === 'tool_result' && part.is_error) {
      const text = resultText(part.content).replace(/\s+/g, ' ').trim();
      if (!DENIAL_TEXT.test(text)) continue;
      const use = watch.uses.get(part.tool_use_id);
      watch.denied.push({ tool: use?.tool ?? 'a tool', detail: use?.detail, text });
    }
  }
}

function workerDenialText(denied: readonly WorkerDenial[]) {
  const first = denied[0];
  const what = first.detail ? `${first.tool} \`${first.detail.slice(0, SHOWN_COMMAND)}\`` : first.tool;
  const count = denied.length === 1 ? 'A mapper worker call was' : `${denied.length} mapper worker calls were`;
  return `${count} refused permission (first: ${what}). Those chunks were not mapped by their workers. What the run did write is on disk and may be complete: Resume maps only what is still missing, and a clean Resume ends the run. Nothing in your project's settings was changed.`;
}

function runAreasGate(project: string, script: string, languageCode: string, timeoutMs = GATE_TIMEOUT_MS): Promise<GateResult | null> {
  return new Promise((resolve) => {
    let out = '';
    let worker: Worker;
    try {
      worker = new Worker(script, { argv: [project, 'required'], env: { ...process.env, LANTERN_LANG: languageCode }, stdout: true, stderr: true });
    } catch {
      resolve(null);
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void worker.terminate();
    }, timeoutMs);
    worker.stdout.on('data', (d: Buffer) => (out += d.toString()));
    worker.stderr.on('data', () => {});
    worker.on('error', () => resolve(null));
    worker.on('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) resolve(null);
      else if (code === 0) resolve({ ok: true });
      else if (code === 1) resolve({ ok: false, text: out.trim() || NOTHING_TO_SAY });
      else resolve(null);
    });
  });
}

export { newWatch, runAreasGate, watchMessage, workerDenialText };
export type { GateResult, RunWatch, WorkerDenial };
