import type { LanternFlowKind, LanternFlowStep, LanternFlowStory, LanternPr, LanternPrFileKind } from '../../main/lantern';
import { esc } from './lanternctx';

interface FlowBar {
  on: boolean;
  reason: string;
}

type FlowRow = 'steps' | 'below';

interface PickedStep {
  label: string;
  files: ReadonlySet<string>;
}

interface FlowSubject {
  id: string;
  flow?: LanternFlowStory[];
  files: readonly Pick<LanternPr['files'][number], 'path' | 'kind' | 'reason'>[];
}

interface FlowDraw {
  pickable: boolean;
  label: string;
}

const reviewDraw = (id: string): FlowDraw => ({ pickable: true, label: `Flow of pull request #${id}` });

const KIND_LABEL: Record<LanternFlowKind, string> = { actor: 'Who', action: 'Does', subject: 'To', interaction: 'In the app', consequence: 'Changes' };
const FILE_KIND_LABEL: Record<LanternPrFileKind, string> = { added: 'Added', modified: 'Modified', removed: 'Removed' };
const NO_FLOW_REASON = 'No flow recorded for this pull request.';
const FLOW_TITLE = 'What this pull request changes for people, as blocks';
const PICK_TITLE = 'Mark the files of this step in the list, the graph and Macro (Esc clears)';
const READING_TEXT = 'READING';
const READING_LABEL = 'Reading: this step mentions the file open in the review pane';
const PERSON_ICON = '<svg class="lt-flow-person" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="5" r="3" fill="currentColor"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5z" fill="currentColor"/></svg>';

function flowOf(pr: Pick<FlowSubject, 'flow'> | undefined): LanternFlowStory[] | null {
  return pr?.flow?.length ? pr.flow : null;
}

function flowReason(pr: LanternPr) {
  if (flowOf(pr)) return '';
  return pr.flowError ? `The flow in this record could not be read: ${pr.flowError}` : NO_FLOW_REASON;
}

function flowBar(pr: LanternPr | undefined, on: boolean): FlowBar | null {
  return pr ? { on: on && !!flowOf(pr), reason: flowReason(pr) } : null;
}

function flowButtonHtml(bar: FlowBar, uid: string) {
  const disabled = bar.reason !== '';
  const reasonId = `lt-flow-reason-${uid}`;
  const attrs = disabled ? ` disabled aria-describedby="${reasonId}"` : '';
  const reason = disabled ? `<span class="lt-flow-reason" id="${reasonId}" data-tip="${esc(bar.reason)}">${esc(bar.reason)}</span>` : '';
  const note = disabled ? '' : '<span class="lt-flow-note" role="status" hidden></span>';
  return `<button class="lt-plat" data-view="flow" aria-pressed="${bar.on}" data-tip="${esc(disabled ? bar.reason : FLOW_TITLE)}"${attrs}>Flow</button>${reason}${note}`;
}

function stepKey(story: number, row: FlowRow, index: number) {
  return `${story}:${row}:${index}`;
}

function stepAt(flow: readonly LanternFlowStory[] | null, key: string | null): LanternFlowStep | null {
  if (!flow || !key) return null;
  const [story, row, index] = key.split(':');
  const steps = row === 'steps' || row === 'below' ? flow[Number(story)]?.[row] : undefined;
  return steps?.[Number(index)] ?? null;
}

function stepLabel(step: LanternFlowStep) {
  return step.kind === 'consequence' ? `${step.old} → ${step.new}` : step.text;
}

function pickedStep(pr: LanternPr | undefined, key: string | null): PickedStep | null {
  const step = stepAt(flowOf(pr), key);
  return step?.files?.length ? { label: stepLabel(step), files: new Set(step.files) } : null;
}

function readingKeys(flow: readonly LanternFlowStory[] | null, path: string | null): ReadonlySet<string> {
  const keys = new Set<string>();
  if (!flow || !path) return keys;
  flow.forEach((story, index) => {
    for (const row of ['steps', 'below'] as const) {
      story[row].forEach((step, i) => {
        if (step.files?.includes(path)) keys.add(stepKey(index, row, i));
      });
    }
  });
  return keys;
}

function readingBadge() {
  const badge = document.createElement('span');
  badge.className = 'lt-flow-reading-badge';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', READING_LABEL);
  badge.textContent = READING_TEXT;
  return badge;
}

function syncReadingNote(bar: ParentNode, path: string | null, missed: boolean) {
  const note = bar.querySelector<HTMLElement>('.lt-flow-note');
  if (!note) return;
  note.hidden = !(path && missed);
  note.textContent = path && missed ? `No flow step mentions ${path.slice(path.lastIndexOf('/') + 1)}` : '';
  note.dataset.tip = path && missed ? path : '';
}

function syncReading(host: ParentNode, bar: ParentNode, pr: LanternPr | undefined, path: string | null) {
  const keys = readingKeys(flowOf(pr), path);
  host.querySelector('.lt-flow-view')?.classList.toggle('lt-flow-calm', keys.size > 0);
  host.querySelectorAll<HTMLElement>('[data-flow-step]').forEach((block) => {
    const on = keys.has(block.dataset.flowStep ?? '');
    const step = block.closest<HTMLElement>('.lt-flow-step');
    step?.classList.toggle('lt-flow-reading', on);
    block.querySelector('.lt-flow-reading-badge')?.remove();
    if (on) block.append(readingBadge());
  });
  syncReadingNote(bar, path, keys.size === 0);
}

function chipHtml(pr: FlowSubject, path: string, draw: FlowDraw) {
  const file = pr.files.find((candidate) => candidate.path === path);
  const kind = file ? FILE_KIND_LABEL[file.kind] : '';
  const tip = file ? `${kind}: ${file.reason ?? path}` : path;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!draw.pickable) return `<li><span class="lt-flow-file lt-flow-file-plan" data-tip="${esc(path)}">${esc(name)}</span></li>`;
  return `<li><button type="button" class="lt-flow-file lt-flow-file-${file?.kind ?? 'modified'}" data-flow-open="${esc(path)}" data-tip="${esc(tip)}" aria-label="${esc(`Open ${path}${kind ? ` (${kind.toLowerCase()})` : ''}`)}">${esc(name)}</button></li>`;
}

function blockHtml(step: LanternFlowStep, key: string, picked: boolean, draw: FlowDraw) {
  const kind = `<span class="lt-flow-kind">${KIND_LABEL[step.kind]}</span>`;
  const pick = draw.pickable && step.files?.length ? ` role="button" tabindex="0" aria-pressed="${picked}" data-flow-step="${key}" data-tip="${PICK_TITLE}"` : '';
  if (step.kind === 'consequence') {
    const pair = `<span class="lt-flow-pair"><span class="lt-flow-old"><span class="lt-flow-tag">Old</span> <del>${esc(step.old)}</del></span><span class="lt-flow-new"><span class="lt-flow-tag">New</span> <strong>${esc(step.new)}</strong></span></span>`;
    return `<div class="lt-flow-block"${pick}>${kind}${pair}</div>`;
  }
  const icon = step.kind === 'actor' ? PERSON_ICON : '';
  return `<div class="lt-flow-block"${pick}>${kind}<span class="lt-flow-text">${icon}${esc(step.text)}</span></div>`;
}

function cellHtml(pr: FlowSubject, step: LanternFlowStep, key: string, picked: boolean, draw: FlowDraw) {
  const files = step.files?.length ? `<ul class="lt-flow-files" aria-label="Files of this step">${step.files.map((path) => chipHtml(pr, path, draw)).join('')}</ul>` : '';
  return `<div class="lt-flow-cell">${blockHtml(step, key, picked, draw)}${files}</div>`;
}

function rowHtml(pr: FlowSubject, story: number, row: FlowRow, cls: string, label: string, picked: string | null, draw: FlowDraw) {
  const steps = (flowOf(pr) as LanternFlowStory[])[story][row];
  const items = steps.map((step, i) => {
    const key = stepKey(story, row, i);
    const on = key === picked;
    return `<li class="lt-flow-step lt-flow-${step.kind}${on ? ' lt-flow-picked' : ''}" data-kind="${step.kind}">${i > 0 ? '<span class="lt-flow-arrow" aria-hidden="true">→</span>' : ''}${cellHtml(pr, step, key, on, draw)}</li>`;
  });
  return `<ol class="${cls}" ${label}>${items.join('')}</ol>`;
}

function subjectOf(story: LanternFlowStory) {
  const subject = story.steps.find((step) => step.kind === 'subject');
  return subject && subject.kind !== 'consequence' ? subject.text : '';
}

function storyHtml(pr: FlowSubject, index: number, key: string, picked: string | null, draw: FlowDraw) {
  const story = (flowOf(pr) as LanternFlowStory[])[index];
  const title = `lt-flow-t-${key}`;
  const then = `lt-flow-n-${key}`;
  const below = story.below.length
    ? `<p class="lt-flow-then" id="${then}"><span class="lt-flow-down" aria-hidden="true">↓</span>Then${subjectOf(story) ? `, for <b>${esc(subjectOf(story))}</b>` : ''}</p>${rowHtml(pr, index, 'below', 'lt-flow-row lt-flow-below', `aria-labelledby="${then}"`, picked, draw)}`
    : '';
  const count = (flowOf(pr) as LanternFlowStory[]).length;
  const head = `<header class="lt-flow-head"><span class="lt-flow-index" aria-hidden="true">${count > 1 ? index + 1 : ''}</span><h2 class="lt-flow-title" id="${title}">${esc(story.title)}</h2></header>`;
  return `<article class="lt-flow-story" aria-labelledby="${title}">${head}${rowHtml(pr, index, 'steps', 'lt-flow-row', 'aria-label="What happens"', picked, draw)}${below}</article>`;
}

function flowHtml(pr: FlowSubject, uid: string, picked: string | null = null, draw: FlowDraw = reviewDraw(pr.id)) {
  const stories = flowOf(pr);
  if (!stories) return '';
  return `<section class="lt-flow-view" aria-label="${esc(draw.label)}">${stories.map((_, i) => storyHtml(pr, i, `${uid}-${i}`, picked, draw)).join('')}</section>`;
}

function syncPick(host: ParentNode, picked: string | null) {
  host.querySelectorAll<HTMLElement>('[data-flow-step]').forEach((block) => {
    const on = block.dataset.flowStep === picked;
    block.setAttribute('aria-pressed', String(on));
    block.closest('.lt-flow-step')?.classList.toggle('lt-flow-picked', on);
  });
}

export { flowBar, flowButtonHtml, flowHtml, flowOf, flowReason, pickedStep, syncPick, syncReading };
export type { FlowBar, FlowDraw, FlowSubject, PickedStep };
