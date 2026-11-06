import { LIMITS } from '../../../skills/lantern-plan/scripts/plan-format.mjs';
import type { LanternPlanView, PlanQuestionView } from '../../main/lantern-plan-view-types';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { flowHtml } from './lanternflow';
import type { FlowSubject } from './lanternflow';
import { esc } from './lanternctx';
import { askCounts, askOf, formatAsks, readyText, splitQuestionText } from './lanternplananswers';
import type { AskRequest, PlanNotes } from './lanternplananswers';
import { trapTab } from './modal-focus';

interface QuestionModalOptions {
  host: HTMLElement;
  plan: LanternPlanView;
  question: PlanQuestionView;
  notes: PlanNotes;
  copy: (text?: string) => Promise<boolean>;
  onShow: () => void;
  onClose: () => void;
}

interface QuestionModal {
  el: HTMLElement;
  close(): void;
}

const COPIED_MS = 1500;
let modalSeq = 0;

function subjectOf(question: PlanQuestionView): FlowSubject {
  return { id: question.id, flow: question.flow, files: [] };
}

function textBlock(question: PlanQuestionView) {
  const { main, fallback } = splitQuestionText(question.text);
  const planned = question.answer ? `<p class="pl-answer">${esc(say(VIEW.QUESTION_ANSWER, { by: question.answer.by, text: question.answer.text }))}</p>` : '';
  return `<p class="pl-qtext">${esc(main)}</p>${fallback ? `<p class="pl-qdefault">${esc(fallback)}</p>` : ''}${planned}`;
}

function explainBox(question: PlanQuestionView) {
  if (!question.explain.length) return '';
  return `<section class="pl-qbox-help" data-qm-box="explain"><h3>${esc(say(VIEW.MODAL_EXPLAIN_HEAD))}</h3>${question.explain.map((line) => `<p>${esc(line)}</p>`).join('')}</section>`;
}

function flowBox(question: PlanQuestionView) {
  if (!question.flow.length) return '';
  const draw = { pickable: false, label: say(VIEW.FLOW_LABEL, { id: question.id }) };
  return `<section class="pl-qbox-help" data-qm-box="flow"><h3>${esc(say(VIEW.MODAL_FLOW_HEAD))}</h3>${flowHtml(subjectOf(question), `q${question.id}`, null, draw)}</section>`;
}

function helpButtons(question: PlanQuestionView) {
  const explainTitle = say(question.explain.length ? VIEW.HELP_EXPLAIN_MORE_TITLE : VIEW.HELP_EXPLAIN_TITLE);
  const flowTitle = say(question.flow.length ? VIEW.HELP_FLOW_SHOWN_TITLE : VIEW.HELP_FLOW_TITLE);
  const flowPressed = question.flow.length ? '' : ' aria-pressed="false"';
  return (
    `<div class="pl-qhelp" role="group" aria-label="${esc(say(VIEW.HELP_LABEL))}">` +
    `<button type="button" class="pl-qaction" data-qm="explain" aria-pressed="false" data-tip="${esc(explainTitle)}">${esc(say(VIEW.HELP_EXPLAIN))}</button>` +
    `<button type="button" class="pl-qaction" data-qm="show" data-tip="${esc(say(VIEW.HELP_SHOW_TITLE))}">${esc(say(VIEW.HELP_SHOW))}</button>` +
    `<button type="button" class="pl-qaction" data-qm="flow"${flowPressed} data-tip="${esc(flowTitle)}">${esc(say(VIEW.HELP_FLOW))}</button>` +
    `</div>`
  );
}

function frame(question: PlanQuestionView, uid: number) {
  const title = `pl-qm-title-${uid}`;
  const input = `pl-qm-input-${uid}`;
  const tag = question.answer ? '' : `<span class="pl-open-tag">${esc(say(VIEW.QUESTION_OPEN))}</span>`;
  return (
    `<div class="modal-card pl-qcard">` +
    `<div class="modal-head"><span class="modal-title" id="${title}"><b>${esc(question.id)}</b> ${tag}</span><button type="button" class="modal-close" data-qm="close" data-tip="${esc(say(VIEW.MODAL_CLOSE_TITLE))}" aria-label="${esc(say(VIEW.MODAL_CLOSE))}">${CLOSE_ICON}</button></div>` +
    `<div class="pl-qmodal-body">${textBlock(question)}` +
    `<label class="pl-qlabel" for="${input}">${esc(say(VIEW.ANSWER_LABEL))}</label>` +
    `<textarea id="${input}" class="pl-qinput" rows="4" maxlength="${LIMITS.answer}" placeholder="${esc(say(VIEW.ANSWER_PLACEHOLDER))}" data-qm-input></textarea>` +
    `<p class="pl-note">${esc(say(VIEW.ANSWER_HINT, { max: LIMITS.answer }))} <span class="pl-count" role="status" data-qm-count></span></p>` +
    `${helpButtons(question)}` +
    `<p class="pl-qnote" role="status" data-qm-note="explain" hidden></p><p class="pl-qnote" role="status" data-qm-note="flow" hidden></p>` +
    `${explainBox(question)}${flowBox(question)}</div>` +
    `<div class="modal-foot"><span class="pl-askready" role="status" data-qm-ready></span><span class="spacer"></span>` +
    `<button type="button" class="lt-cm-pill" data-qm="copy-one">${esc(say(VIEW.COPY_ONE))}</button>` +
    `<button type="button" class="lt-cm-pill" data-qm="copy" data-tip="${esc(say(VIEW.COPY_TITLE))}">${esc(say(VIEW.COPY))}</button>` +
    `<button type="button" data-qm="done">${esc(say(VIEW.MODAL_DONE))}</button></div></div>`
  );
}

function openQuestionModal(options: QuestionModalOptions): QuestionModal {
  const { host, plan, question, notes } = options;
  const uid = ++modalSeq;
  const opener = document.activeElement as HTMLElement | null;
  const modal = document.createElement('div');
  modal.className = 'modal pl-qmodal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', `pl-qm-title-${uid}`);
  modal.innerHTML = frame(question, uid);
  const part = <T extends HTMLElement>(selector: string) => modal.querySelector<T>(selector);
  const input = part<HTMLTextAreaElement>('[data-qm-input]') as HTMLTextAreaElement;
  const ready = part('[data-qm-ready]') as HTMLElement;
  const count = part('[data-qm-count]') as HTMLElement;
  const copyButton = part<HTMLButtonElement>('[data-qm="copy"]') as HTMLButtonElement;
  const copyOneButton = part<HTMLButtonElement>('[data-qm="copy-one"]') as HTMLButtonElement;
  const copiedTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  let pressedInCard = false;
  let closed = false;

  const requestButton = (request: AskRequest) => part<HTMLButtonElement>(`[data-qm="${request}"]`) as HTMLButtonElement;

  function paintRequest(request: AskRequest) {
    const pending = notes.note(question.id)[request] === (request === 'explain' ? question.explain.length : question.flow.length);
    const note = part(`[data-qm-note="${request}"]`) as HTMLElement;
    const present = (request === 'explain' ? question.explain.length : question.flow.length) > 0;
    note.hidden = !pending;
    note.textContent = pending ? say(request === 'explain' ? (present ? VIEW.EXPLAIN_REQUESTED_MORE : VIEW.EXPLAIN_REQUESTED) : VIEW.FLOW_REQUESTED) : '';
    if (request === 'explain' || !present) requestButton(request).setAttribute('aria-pressed', String(pending));
  }

  function paintReady() {
    const counts = askCounts(plan, notes.all());
    ready.textContent = readyText(counts);
    copyButton.disabled = counts.answers + counts.requests === 0;
    const empty = ownAsk() === null;
    copyOneButton.disabled = empty;
    copyOneButton.dataset.tip = say(empty ? VIEW.COPY_ONE_EMPTY_TITLE : VIEW.COPY_ONE_TITLE);
  }

  function ownAsk() {
    return askOf(question, notes.note(question.id));
  }

  function paintCount() {
    const length = input.value.length;
    count.textContent = say(length >= LIMITS.answer ? VIEW.ANSWER_COUNT_FULL : VIEW.ANSWER_COUNT, { count: length, max: LIMITS.answer });
  }

  function toggle(request: AskRequest) {
    const length = request === 'explain' ? question.explain.length : question.flow.length;
    const pending = notes.note(question.id)[request] === length;
    notes.setRequest(question.id, request, pending ? null : length);
    paintRequest(request);
    paintReady();
  }

  function showFlow() {
    if (!question.flow.length) return toggle('flow');
    (part('[data-qm-box="flow"]') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }

  async function copyWith(button: HTMLButtonElement, label: string, text?: string) {
    const ok = await options.copy(text);
    button.textContent = say(ok ? VIEW.COPIED : VIEW.COPY_FAILED);
    clearTimeout(copiedTimers.get(button));
    copiedTimers.set(
      button,
      setTimeout(() => {
        button.textContent = label;
      }, COPIED_MS),
    );
  }

  function copyOne() {
    const ask = ownAsk();
    if (ask) void copyWith(copyOneButton, say(VIEW.COPY_ONE), formatAsks(plan, [ask]));
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const timer of copiedTimers.values()) clearTimeout(timer);
    modal.remove();
    options.onClose();
    if (opener?.isConnected) opener.focus();
  }

  const ACTIONS: Record<string, () => void> = {
    close,
    done: close,
    explain: () => toggle('explain'),
    flow: showFlow,
    show() {
      close();
      options.onShow();
    },
    copy: () => void copyWith(copyButton, say(VIEW.COPY)),
    'copy-one': copyOne,
  };

  input.value = notes.note(question.id).answer;
  paintRequest('explain');
  paintRequest('flow');
  paintReady();
  paintCount();

  input.addEventListener('input', () => {
    notes.setAnswer(question.id, input.value);
    paintCount();
    paintReady();
  });
  modal.addEventListener('click', (ev) => {
    const target = ev.target as Element;
    const pressedInside = pressedInCard;
    pressedInCard = false;
    if (target === modal) return pressedInside ? undefined : close();
    ACTIONS[target.closest<HTMLElement>('[data-qm]')?.dataset.qm ?? '']?.();
  });
  modal.addEventListener('pointerdown', (ev) => {
    pressedInCard = ev.target !== modal;
  });
  modal.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === 'Tab') trapTab(ev, modal);
  });

  host.appendChild(modal);
  input.focus();
  return { el: modal, close };
}

export { openQuestionModal };
export type { QuestionModal, QuestionModalOptions };
