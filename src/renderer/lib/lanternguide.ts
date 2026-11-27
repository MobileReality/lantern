import type { LanternGuide, LanternGuideHunk, LanternGuideStep, LanternPr, LanternPrFile } from '../../main/lantern';

interface GuideStop {
  path: string;
  step: number;
}

interface GuideNote {
  at: number;
  count: number;
  title: string;
  why: string;
  careful: boolean;
  refs: LanternGuideHunk[];
}

const NO_STEP = -1;
const MARK_CLASS = 'guide-hit';
const GUIDE_ERROR_PREFIX = 'The guide in this record could not be read: ';

function guideOf(pr: Pick<LanternPr, 'guide'> | undefined): LanternGuide | null {
  return pr?.guide?.steps.length ? pr.guide : null;
}

function guideErrorOf(pr: Pick<LanternPr, 'guide' | 'guideError'> | undefined) {
  return !guideOf(pr) && pr?.guideError ? `${GUIDE_ERROR_PREFIX}${pr.guideError}` : '';
}

function pathsOf(refs: readonly LanternGuideHunk[]) {
  return [...new Set(refs.map((ref) => ref.path))];
}

function refsOf(refs: readonly LanternGuideHunk[], path: string) {
  return refs.filter((ref) => ref.path === path);
}

function guideStops(guide: LanternGuide, files: readonly LanternPrFile[]): GuideStop[] {
  const changed = new Set(files.map((file) => file.path));
  const stops: GuideStop[] = [];
  guide.steps.forEach((step, index) => {
    for (const path of pathsOf(step.hunks)) if (changed.has(path)) stops.push({ path, step: index });
  });
  const named = new Set(stops.map((stop) => stop.path));
  for (const file of files) if (!named.has(file.path)) stops.push({ path: file.path, step: NO_STEP });
  return stops;
}

function stopAt(stops: readonly GuideStop[], path: string | null, preferred: number) {
  if (!path) return -1;
  return stops[preferred]?.path === path ? preferred : stops.findIndex((stop) => stop.path === path);
}

function noteOf(guide: LanternGuide, stop: GuideStop): GuideNote | undefined {
  const step: LanternGuideStep | undefined = guide.steps[stop.step];
  if (!step) return undefined;
  return { at: stop.step, count: guide.steps.length, title: step.title, why: step.why, careful: step.careful, refs: refsOf(step.hunks, stop.path) };
}

function wholeFile(ref: LanternGuideHunk) {
  return ref.side === undefined || ref.start === undefined;
}

function covers(ref: LanternGuideHunk, side: 'old' | 'new', line: number) {
  return ref.side === side && line >= (ref.start as number) && line <= (ref.end ?? (ref.start as number));
}

function lineOf(row: Element, side: 'old' | 'new') {
  return Number(row.querySelectorAll('.ln')[side === 'old' ? 0 : 1]?.textContent);
}

function markRows(root: ParentNode, refs: readonly LanternGuideHunk[]) {
  root.querySelectorAll(`.cl.${MARK_CLASS}`).forEach((row) => { row.classList.remove(MARK_CLASS); });
  if (!refs.length || refs.some(wholeFile)) return [];
  const marked: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>('.cl.add, .cl.del').forEach((row) => {
    const side = row.classList.contains('del') ? 'old' : 'new';
    const line = lineOf(row, side);
    if (!line || !refs.some((ref) => covers(ref, side, line))) return;
    row.classList.add(MARK_CLASS);
    marked.push(row);
  });
  return marked;
}

export { NO_STEP, guideErrorOf, guideOf, guideStops, markRows, noteOf, pathsOf, stopAt };
export type { GuideNote, GuideStop };
