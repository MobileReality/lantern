import type { LanternGuide, LanternGuideHunk, LanternPr } from '../../main/lantern';
import type { DiffRow } from './codeview';
import { esc } from './lanternctx';

interface GuideBar {
  on: boolean;
  reason: string;
}

const GUIDE_TITLE = 'The pull request as a short guided tour: steps in reading order, each with its own hunks';
const CONTEXT_LINES = 2;
const GUIDE_ERROR_PREFIX = 'The guide in this record could not be read: ';

function guideOf(pr: Pick<LanternPr, 'guide'> | undefined): LanternGuide | null {
  return pr?.guide?.steps.length ? pr.guide : null;
}

function guideBar(pr: LanternPr | undefined, on: boolean): GuideBar | null {
  if (!pr) return null;
  if (guideOf(pr)) return { on, reason: '' };
  return pr.guideError ? { on: false, reason: `${GUIDE_ERROR_PREFIX}${pr.guideError}` } : null;
}

function guideButtonHtml(bar: GuideBar) {
  const disabled = bar.reason !== '';
  const tip = esc(disabled ? bar.reason : GUIDE_TITLE);
  return `<button class="lt-plat" data-view="guide" aria-pressed="${bar.on}" data-tip="${tip}"${disabled ? ' disabled' : ''}>Guide</button>`;
}

function wholeFile(ref: LanternGuideHunk) {
  return ref.side === undefined || ref.start === undefined;
}

function touches(ref: LanternGuideHunk, row: DiffRow) {
  const line = ref.side === 'old' ? (row.type === 'del' ? row.oldLn : undefined) : row.type === 'add' ? row.newLn : undefined;
  return line !== undefined && line >= (ref.start as number) && line <= (ref.end ?? (ref.start as number));
}

function isChange(row: DiffRow) {
  return row.type === 'add' || row.type === 'del';
}

function hunkBlocks(rows: readonly DiffRow[]) {
  const blocks: DiffRow[][] = [];
  for (const row of rows) {
    if (row.type === 'hunk' || blocks.length === 0) blocks.push([row]);
    else blocks[blocks.length - 1].push(row);
  }
  return blocks;
}

function changeRuns(body: readonly DiffRow[]) {
  const runs: { from: number; to: number }[] = [];
  body.forEach((row, index) => {
    if (!isChange(row)) return;
    const last = runs[runs.length - 1];
    if (last?.to === index) last.to = index + 1;
    else runs.push({ from: index, to: index + 1 });
  });
  return runs;
}

function keptIndexes(body: readonly DiffRow[], runs: readonly { from: number; to: number }[]) {
  const kept = new Set<number>();
  for (const { from, to } of runs) {
    for (let i = Math.max(0, from - CONTEXT_LINES); i < Math.min(body.length, to + CONTEXT_LINES); i++) {
      if ((i >= from && i < to) || body[i].type === 'ctx') kept.add(i);
    }
  }
  return [...kept].sort((a, b) => a - b);
}

function selectInBlock(block: readonly DiffRow[], refs: readonly LanternGuideHunk[], out: DiffRow[]) {
  const head = block[0].type === 'hunk' ? block[0] : null;
  const body = head ? block.slice(1) : block;
  const runs = changeRuns(body).filter(({ from, to }) => body.slice(from, to).some((row) => refs.some((ref) => touches(ref, row))));
  let previous = -2;
  for (const index of keptIndexes(body, runs)) {
    if (index !== previous + 1) {
      const lastOld = [...out].reverse().find((row) => row.oldLn !== undefined)?.oldLn ?? 0;
      out.push({ type: 'hunk', text: out.length === 0 ? (head?.text ?? '') : '', oldStart: lastOld + 1, newStart: 0 });
    }
    out.push(body[index]);
    previous = index;
  }
}

function selectRows(rows: readonly DiffRow[], refs: readonly LanternGuideHunk[]): DiffRow[] {
  if (refs.some(wholeFile)) return [...rows];
  const out: DiffRow[] = [];
  for (const block of hunkBlocks(rows)) selectInBlock(block, refs, out);
  return out;
}

function pathsOf(refs: readonly LanternGuideHunk[]) {
  return [...new Set(refs.map((ref) => ref.path))];
}

function refsOf(refs: readonly LanternGuideHunk[], path: string) {
  return refs.filter((ref) => ref.path === path);
}

export { guideBar, guideButtonHtml, guideOf, pathsOf, refsOf, selectRows };
export type { GuideBar };
