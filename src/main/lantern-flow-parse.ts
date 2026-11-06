import { hasControlCharacter } from '../shared/control-characters';
import { decodePath } from './lantern-parse';
import type { LanternFlowKind, LanternFlowStep, LanternFlowStory } from './lantern-types';

const FLOW_KINDS: readonly LanternFlowKind[] = ['actor', 'action', 'subject', 'interaction', 'consequence'];
const FLOW_TEXT_MAX = 80;
const FLOW_MAX_STORIES = 5;
const FLOW_MAX_STEPS = 6;
const FLOW_MAX_FILES = 6;
const CONSEQUENCE_ARROW = '=>';
const FLOW_LINE = /^#(story|step|below|file)(?:[ \t]+(.*?))?[ \t]*$/;

type FlowTag = 'story' | 'step' | 'below' | 'file';

interface FlowLine {
  tag: FlowTag;
  raw: string;
  at: string;
}

interface FlowParse {
  stories: LanternFlowStory[];
  error: string | null;
}

interface DraftStory extends LanternFlowStory {
  at: string;
}

type StepParse = { step: LanternFlowStep } | { problem: string };

function matchFlowLine(line: string, at: string): FlowLine | null {
  const m = FLOW_LINE.exec(line);
  return m ? { tag: m[1] as FlowTag, raw: m[2] ?? '', at } : null;
}

function textProblem(text: string, what: string) {
  if (text === '') return `${what} is empty`;
  if (hasControlCharacter(text)) return `${what} contains a control character`;
  if ([...text].length > FLOW_TEXT_MAX) return `${what} is ${[...text].length} characters, the cap is ${FLOW_TEXT_MAX}`;
  return null;
}

function consequenceOf(text: string): StepParse {
  const cut = text.indexOf(` ${CONSEQUENCE_ARROW} `);
  if (cut === -1) return { problem: `a consequence is "<old text> ${CONSEQUENCE_ARROW} <new text>"` };
  const old = text.slice(0, cut).trim();
  const now = text.slice(cut + CONSEQUENCE_ARROW.length + 2).trim();
  const problem = textProblem(old, 'the old text') ?? textProblem(now, 'the new text');
  return problem ? { problem } : { step: { kind: 'consequence', old, new: now } };
}

function stepOf(raw: string): StepParse {
  const cut = raw.search(/\s/);
  const kind = cut === -1 ? raw : raw.slice(0, cut);
  const text = cut === -1 ? '' : raw.slice(cut).trim();
  if (kind === '') return { problem: `must be "<kind> <text>" with kind ${FLOW_KINDS.join(', ')}` };
  if (!(FLOW_KINDS as readonly string[]).includes(kind)) return { problem: `unknown kind "${kind}" (known: ${FLOW_KINDS.join(', ')})` };
  if (kind === 'consequence') return consequenceOf(text);
  const problem = textProblem(text, `the ${kind} text`);
  return problem ? { problem } : { step: { kind: kind as Exclude<LanternFlowKind, 'consequence'>, text } };
}

function attachFile(step: LanternFlowStep, raw: string, listed: ReadonlySet<string>): string | null {
  if (raw === '') return 'must be "#file <path>"';
  if (/\s/.test(raw)) return 'takes one path and nothing after it (encode a space as %20)';
  const target = decodePath(raw);
  if (!listed.has(target)) return `names ${raw}, which is not a file line of this record`;
  const files = step.files ?? [];
  if (files.includes(target)) return `names ${raw} twice on one step`;
  if (files.length >= FLOW_MAX_FILES) return `has more than ${FLOW_MAX_FILES} files on one step`;
  step.files = [...files, target];
  return null;
}

function parseFlowLines(lines: readonly FlowLine[], listed: ReadonlySet<string> = new Set()): FlowParse {
  const errors: string[] = [];
  const stories: DraftStory[] = [];
  let story: DraftStory | null = null;
  let below = false;
  let last: LanternFlowStep | null = null;
  let skipFiles = false;
  const finish = () => {
    if (story && story.steps.length === 0) errors.push(`${story.at}: story "${story.title}" has no #step line`);
  };
  for (const { tag, raw, at } of lines) {
    if (tag === 'file') {
      if (!story) errors.push(`${at}: #file before any #story`);
      else if (!last && !skipFiles) errors.push(`${at}: #file before any #step`);
      else if (last) {
        const problem = attachFile(last, raw, listed);
        if (problem) errors.push(`${at}: #file ${problem}`);
      }
      continue;
    }
    last = null;
    skipFiles = false;
    if (tag === 'story') {
      finish();
      below = false;
      const problem = textProblem(raw, 'the story title');
      if (problem) {
        errors.push(`${at}: #story ${problem}`);
        story = null;
        continue;
      }
      if (stories.length >= FLOW_MAX_STORIES) errors.push(`${at}: more than ${FLOW_MAX_STORIES} stories`);
      story = { title: raw, steps: [], below: [], at };
      stories.push(story);
      continue;
    }
    if (!story) {
      errors.push(`${at}: #${tag} before any #story`);
      continue;
    }
    skipFiles = true;
    if (tag === 'step' && below) {
      errors.push(`${at}: #step after #below`);
      continue;
    }
    if (tag === 'below') below = true;
    const parsed = stepOf(raw);
    if ('problem' in parsed) {
      errors.push(`${at}: #${tag} ${parsed.problem}`);
      continue;
    }
    const row = tag === 'step' ? story.steps : story.below;
    if (row.length >= FLOW_MAX_STEPS) errors.push(`${at}: more than ${FLOW_MAX_STEPS} #${tag} lines in story "${story.title}"`);
    else {
      row.push(parsed.step);
      last = parsed.step;
      skipFiles = false;
    }
  }
  finish();
  if (errors.length > 0) return { stories: [], error: errors[0] };
  return { stories: stories.map(({ title, steps, below: under }) => ({ title, steps, below: under })), error: null };
}

export { FLOW_KINDS, FLOW_MAX_FILES, FLOW_MAX_STEPS, FLOW_MAX_STORIES, FLOW_TEXT_MAX, matchFlowLine, parseFlowLines };
export type { FlowLine, FlowParse };
