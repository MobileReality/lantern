import { hasControlCharacter } from '../shared/control-characters';
import { decodePath } from './lantern-parse';
import type { LanternGuide, LanternGuideHunk, LanternGuideRisk, LanternGuideStep } from './lantern-types';

const GUIDE_RISK_LEVELS: readonly LanternGuideRisk['level'][] = ['low', 'medium', 'high'];
const GUIDE_STEP_MODES = ['careful', 'skim'] as const;
const GUIDE_MAX_STEPS = 8;
const GUIDE_MAX_HUNKS_PER_STEP = 60;
const GUIDE_MAX_PSEUDO_LINES = 8;
const GUIDE_SUMMARY_MAX = 160;
const GUIDE_RISK_WHY_MAX = 160;
const GUIDE_TITLE_MAX = 60;
const GUIDE_WHY_MAX = 240;
const GUIDE_WHY_MAX_SENTENCES = 2;
const GUIDE_PSEUDO_MAX = 100;
const GUIDE_LINE = /^#(guide|risk|gstep|gwhy|ghunk|gpseudo)(?:[ \t]+(.*?))?[ \t]*$/;
const RANGE = /^([+-])(\d+)(?:-(\d+))?$/;

type GuideTag = 'guide' | 'risk' | 'gstep' | 'gwhy' | 'ghunk' | 'gpseudo';

interface GuideLine {
  tag: GuideTag;
  raw: string;
  at: string;
}

interface GuideParse {
  guide: LanternGuide | null;
  error: string | null;
}

interface DraftStep {
  title: string;
  careful: boolean;
  why: string | null;
  hunks: LanternGuideHunk[];
  pseudo: string[];
  at: string;
}

type HunkParse = { ref: LanternGuideHunk } | { problem: string };

function matchGuideLine(line: string, at: string): GuideLine | null {
  const m = GUIDE_LINE.exec(line);
  return m ? { tag: m[1] as GuideTag, raw: m[2] ?? '', at } : null;
}

function lineProblem(text: string, what: string, max: number) {
  if (text === '') return `${what} is empty`;
  if (hasControlCharacter(text)) return `${what} contains a control character (one line, no tabs)`;
  if ([...text].length > max) return `${what} is ${[...text].length} characters, the cap is ${max}`;
  return null;
}

function sentenceCount(text: string) {
  return text.split(/(?<=[.!?])\s+/).filter((part) => part !== '').length;
}

function whyProblem(text: string) {
  const problem = lineProblem(text, 'the why', GUIDE_WHY_MAX);
  if (problem) return problem;
  const sentences = sentenceCount(text);
  return sentences > GUIDE_WHY_MAX_SENTENCES ? `the why is ${sentences} sentences, the cap is ${GUIDE_WHY_MAX_SENTENCES}` : null;
}

function splitFirstWord(raw: string) {
  const cut = raw.search(/\s/);
  return { word: cut === -1 ? raw : raw.slice(0, cut), rest: cut === -1 ? '' : raw.slice(cut).trim() };
}

function hunkOf(raw: string, listed: ReadonlySet<string>): HunkParse {
  const parts = raw.split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return { problem: 'must be "#ghunk <path>" or "#ghunk <path> +<from>-<to>" (-<from>-<to> for old lines)' };
  if (parts.length > 2) return { problem: 'takes a path and at most one range (encode a space in the path as %20)' };
  const path = decodePath(parts[0]);
  if (!listed.has(path)) return { problem: `names ${parts[0]}, which is not a file line of this record` };
  if (parts.length === 1) return { ref: { path } };
  const match = RANGE.exec(parts[1]);
  if (!match) return { problem: `range "${parts[1]}" must be +<from>-<to> (new lines) or -<from>-<to> (old lines), "-<n>" for one line` };
  const start = Number(match[2]);
  const end = match[3] === undefined ? start : Number(match[3]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1) return { problem: 'a line range is whole numbers from line 1' };
  if (end < start) return { problem: `the range ${start}-${end} ends before it starts` };
  return { ref: { path, side: match[1] === '+' ? 'new' : 'old', start, end } };
}

function sameHunk(a: LanternGuideHunk, b: LanternGuideHunk) {
  return a.path === b.path && a.side === b.side && a.start === b.start && a.end === b.end;
}

function parseGuideLines(lines: readonly GuideLine[], listed: ReadonlySet<string> = new Set()): GuideParse {
  if (lines.length === 0) return { guide: null, error: null };
  const errors: string[] = [];
  let summary: string | null = null;
  let risk: LanternGuideRisk | null = null;
  const steps: DraftStep[] = [];
  let step: DraftStep | null = null;
  const finishStep = () => {
    if (!step) return;
    if (step.why === null) errors.push(`${step.at}: step "${step.title}" has no #gwhy line`);
    if (step.hunks.length === 0) errors.push(`${step.at}: step "${step.title}" has no #ghunk line`);
  };
  for (const { tag, raw, at } of lines) {
    if (tag === 'guide') {
      const problem = lineProblem(raw, 'the summary', GUIDE_SUMMARY_MAX);
      if (summary !== null) errors.push(`${at}: #guide appears more than once`);
      else if (problem) errors.push(`${at}: #guide ${problem}`);
      else summary = raw;
      continue;
    }
    if (tag === 'risk') {
      const { word: level, rest: why } = splitFirstWord(raw);
      const known = (GUIDE_RISK_LEVELS as readonly string[]).includes(level);
      const problem = known ? lineProblem(why, 'the risk why', GUIDE_RISK_WHY_MAX) : `level must be one of ${GUIDE_RISK_LEVELS.join(', ')}, got "${level}"`;
      if (risk !== null) errors.push(`${at}: #risk appears more than once`);
      else if (problem) errors.push(`${at}: #risk ${problem}`);
      else risk = { level: level as LanternGuideRisk['level'], why };
      continue;
    }
    if (tag === 'gstep') {
      finishStep();
      step = null;
      const { word: mode, rest: title } = splitFirstWord(raw);
      const known = (GUIDE_STEP_MODES as readonly string[]).includes(mode);
      const problem = known ? lineProblem(title, 'the title', GUIDE_TITLE_MAX) : `must be "#gstep <${GUIDE_STEP_MODES.join('|')}> <title>", got mode "${mode}"`;
      if (problem) {
        errors.push(`${at}: #gstep ${problem}`);
        continue;
      }
      if (steps.length >= GUIDE_MAX_STEPS) errors.push(`${at}: more than ${GUIDE_MAX_STEPS} steps`);
      step = { title, careful: mode === 'careful', why: null, hunks: [], pseudo: [], at };
      steps.push(step);
      continue;
    }
    if (!step) {
      errors.push(`${at}: #${tag} before any #gstep`);
      continue;
    }
    if (tag === 'gwhy') {
      const problem = whyProblem(raw);
      if (step.why !== null) errors.push(`${at}: #gwhy appears more than once in step "${step.title}"`);
      else if (problem) errors.push(`${at}: #gwhy ${problem}`);
      else step.why = raw;
    } else if (tag === 'ghunk') {
      const parsed = hunkOf(raw, listed);
      if ('problem' in parsed) errors.push(`${at}: #ghunk ${parsed.problem}`);
      else if (step.hunks.some((ref) => sameHunk(ref, parsed.ref))) errors.push(`${at}: #ghunk repeats a hunk of step "${step.title}"`);
      else if (step.hunks.length >= GUIDE_MAX_HUNKS_PER_STEP) errors.push(`${at}: more than ${GUIDE_MAX_HUNKS_PER_STEP} #ghunk lines in step "${step.title}"`);
      else step.hunks.push(parsed.ref);
    } else {
      const problem = lineProblem(raw, 'the pseudocode line', GUIDE_PSEUDO_MAX);
      if (!step.careful) errors.push(`${at}: #gpseudo only on a careful step ("${step.title}" is skim)`);
      else if (problem) errors.push(`${at}: #gpseudo ${problem}`);
      else if (step.pseudo.length >= GUIDE_MAX_PSEUDO_LINES) errors.push(`${at}: more than ${GUIDE_MAX_PSEUDO_LINES} #gpseudo lines in step "${step.title}"`);
      else step.pseudo.push(raw);
    }
  }
  finishStep();
  const first = lines[0].at;
  if (summary === null) errors.push(`${first}: a guide needs a #guide summary line`);
  if (risk === null) errors.push(`${first}: a guide needs a #risk line`);
  if (steps.length === 0) errors.push(`${first}: a guide needs at least one #gstep`);
  if (errors.length > 0 || summary === null || risk === null) return { guide: null, error: errors[0] };
  const made: LanternGuideStep[] = steps.map(({ title, why, careful, hunks, pseudo }) => ({ title, why: why ?? '', careful, hunks, ...(pseudo.length > 0 ? { pseudo } : {}) }));
  return { guide: { summary, risk, steps: made }, error: null };
}

export {
  GUIDE_MAX_HUNKS_PER_STEP,
  GUIDE_MAX_PSEUDO_LINES,
  GUIDE_MAX_STEPS,
  GUIDE_PSEUDO_MAX,
  GUIDE_RISK_WHY_MAX,
  GUIDE_SUMMARY_MAX,
  GUIDE_TITLE_MAX,
  GUIDE_WHY_MAX,
  GUIDE_WHY_MAX_SENTENCES,
  matchGuideLine,
  parseGuideLines,
};
export type { GuideLine, GuideParse };
