import type { SetupProgress } from '../../main/setup-progress';

type SetupKind = 'lantern' | 'lantern-refresh';
type Phase = 'planning' | 'features' | 'mapping' | 'sections' | 'finishing';

const PHASES: ReadonlyArray<{ id: Phase; label: string }> = [
  { id: 'planning', label: 'Planning' },
  { id: 'features', label: 'Features' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'sections', label: 'Sections' },
  { id: 'finishing', label: 'Finishing' },
];

const MIN_ETA_CHUNKS = 2;
const MIN_ETA_MS = 120_000;
const MAX_ETA_MS = 48 * 3_600_000;

// Read off the skill's own procedure order and what it leaves on disk, never off the model's words:
// nothing written yet is planning, a feature list is the last step before chunk 1, every chunk done
// means the sections and final checks are what is left.
function phaseOf(p: SetupProgress | null): Phase {
  if (!p) return 'planning';
  const allMapped = p.chunks.total > 0 && p.chunks.done === p.chunks.total;
  if (allMapped) return p.sections > 0 ? 'finishing' : 'sections';
  if (p.chunks.done > 0 || p.features) return 'mapping';
  return p.platforms ? 'features' : 'planning';
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

interface RunView {
  phase: Phase;
  known: boolean;
  fraction: number;
  chunkText: string;
  filesText: string;
  currentDir: string | null;
  filesDone: number;
  filesTotal: number;
  chunksDone: number;
  chunksTotal: number;
  chunksLeft: number;
  elapsedMs: number;
  etaMs: number | null;
}

interface RunInput {
  progress: SetupProgress | null;
  baseline: SetupProgress | null;
  kind: SetupKind;
  elapsedMs: number;
}

// A setup bar covers the whole project, so a resumed run starts partway. A refresh of an
// already-mapped project would sit near 100% from the first second, so its bar covers the files
// this run had to re-map.
function fractionOf({ progress, baseline, kind }: RunInput): number {
  if (!progress) return 0;
  if (kind === 'lantern' || !baseline) return progress.files.total ? clamp01(progress.files.done / progress.files.total) : 0;
  const work = baseline.files.total - baseline.files.done;
  return work > 0 ? clamp01((progress.files.done - baseline.files.done) / work) : 0;
}

// Only once the run has shown its own pace: at least two chunks finished in this sitting and two
// minutes elapsed. It covers the chunks still to map, not the sections and final checks after them.
function etaOf({ progress, baseline, elapsedMs }: RunInput): number | null {
  if (!progress || !baseline) return null;
  if (progress.chunks.done - baseline.chunks.done < MIN_ETA_CHUNKS || elapsedMs < MIN_ETA_MS) return null;
  const doneBytes = progress.bytes.done - baseline.bytes.done;
  const leftBytes = progress.bytes.total - progress.bytes.done;
  if (doneBytes <= 0) return null;
  if (leftBytes <= 0) return 0;
  const eta = (elapsedMs * leftBytes) / doneBytes;
  return Number.isFinite(eta) && eta <= MAX_ETA_MS ? eta : null;
}

function deriveRunView(input: RunInput): RunView {
  const { progress, baseline, kind, elapsedMs } = input;
  const filesDone = progress?.files.done ?? 0;
  const filesTotal = progress?.files.total ?? 0;
  const chunksDone = progress?.chunks.done ?? 0;
  const chunksTotal = progress?.chunks.total ?? 0;
  const next = progress?.next ?? null;
  let filesText = '';
  if (progress) {
    if (kind === 'lantern-refresh' && baseline) {
      const work = baseline.files.total - baseline.files.done;
      filesText = `${Math.min(work, Math.max(0, filesDone - baseline.files.done))} of ${work} files re-mapped`;
    } else {
      filesText = `${filesDone} of ${filesTotal} files mapped`;
    }
  }
  return {
    phase: phaseOf(progress),
    known: !!progress,
    fraction: fractionOf(input),
    chunkText: next ? `chunk ${next.id} of ${chunksTotal}` : '',
    filesText,
    currentDir: next ? next.dir : null,
    filesDone,
    filesTotal,
    chunksDone,
    chunksTotal,
    chunksLeft: Math.max(0, chunksTotal - chunksDone),
    elapsedMs,
    etaMs: etaOf(input),
  };
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatEta(ms: number): string {
  if (ms < 60_000) return 'under a minute';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}

function relativeTo(root: string, file: string): string {
  const base = root.endsWith('/') ? root : `${root}/`;
  return file.startsWith(base) ? file.slice(base.length) : file;
}

function mapDirOf(file: string): string | null {
  const m = /^\.lantern\/map\/(.+)\.lantern$/.exec(file);
  if (m) return m[1];
  return file === '.lantern/map/.lantern' ? '.' : null;
}

function activityOf(tool: string, detail: string | undefined, root: string): string {
  const d = detail ?? '';
  if (tool === 'Read' && d) return `Reading ${relativeTo(root, d)}`;
  if ((tool === 'Write' || tool === 'Edit') && d) {
    const rel = relativeTo(root, d);
    const dir = mapDirOf(rel);
    if (dir) return `Writing the map for ${dir}`;
    if (rel.startsWith('.lantern/lang/')) return 'Writing the texts';
    if (rel.startsWith('.lantern/sections/')) return `Writing the ${rel.split('/').pop()?.replace(/\.section$/, '')} section`;
    if (rel === '.lantern/features') return 'Writing the feature list';
    if (rel === '.lantern/platforms') return 'Declaring the platforms';
    return `Writing ${rel}`;
  }
  if (tool === 'Bash' && d) {
    const chunk = /plan\.mjs\s+\S+\s+chunk\s+(\d+)/.exec(d);
    if (chunk) return `Reading chunk ${chunk[1]}`;
    if (/plan\.mjs/.test(d)) return 'Checking what is left to map';
    if (/validate\.mjs/.test(d)) return 'Validating the map';
    if (/enumerate\.mjs/.test(d)) return 'Listing the source files';
    return `Running ${d.slice(0, 60)}`;
  }
  if (tool === 'Agent') return 'Handing a chunk to a mapper';
  if (tool === 'Glob' || tool === 'Grep') return 'Searching the project';
  return tool || '';
}

function resumeLabel(progress: SetupProgress | null, kind: SetupKind): string {
  const noun = kind === 'lantern' ? 'setup' : 'refresh';
  if (!progress) return `Resume ${noun}`;
  const left = progress.chunks.total - progress.chunks.done;
  return left > 0 ? `Resume ${noun} (${left} of ${progress.chunks.total} chunks left)` : `Resume ${noun} (final steps left)`;
}

const FAILURE_KEPT = 'What was written to .lantern/ is kept, and Resume continues from it.';

function failureNote(error: string | null | undefined): string {
  const reason = (error ?? '').trim() || 'The run failed.';
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
  return `${sentence} ${FAILURE_KEPT}`;
}

export { PHASES, phaseOf, deriveRunView, formatElapsed, formatEta, activityOf, resumeLabel, failureNote };
export type { Phase, RunView, SetupKind };
