import { DEFAULT_INTENT, INTENT_IDS, isIntentId, suggestedIntent } from '../../../shared/lang/fix-requests';
import type { FixPreset, IntentId } from '../../../shared/lang/fix-requests';
import { intentLabel } from '../fixrequests/intent';
import { el, isMac } from '../util';

interface BoxSpec {
  heading: string;
  submit: string;
  comment: string;
  preset: string;
  presets: readonly FixPreset[];
  intent?: IntentId;
  fallback?: IntentId;
}

interface BoxResult {
  comment: string;
  preset: string;
  intent?: IntentId;
}

interface BoxHandlers {
  onSave(result: BoxResult): void;
  onCancel(): void;
}

interface CommentBox {
  el: HTMLFormElement;
  open(spec: BoxSpec): void;
  close(): void;
  isOpen(): boolean;
  wantsFocus(): boolean;
  focus(caretAtEnd?: boolean): void;
  fail(text: string): void;
}

const TEXT = {
  chips: 'Predefined texts',
  intent: 'Intent',
  comment: 'Comment',
  placeholder: 'Write a comment, or pick a text above',
  cancel: 'Cancel',
  needComment: 'Write a comment or pick a text.',
} as const;

function insertText(value: string, start: number, end: number, text: string) {
  const before = value.slice(0, start);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  return { value: `${before}${lead}${text}${value.slice(end)}`, caret: before.length + lead.length + text.length };
}

function chip(preset: FixPreset) {
  const button = el('button', 'lt-cm-chip', preset.text);
  button.type = 'button';
  button.dataset.preset = preset.id;
  return button;
}

let boxCount = 0;

function intentChoice(name: string, id: IntentId) {
  const label = el('label', 'lt-cm-seg');
  const input = el('input', 'lt-cm-seg-input');
  input.type = 'radio';
  input.name = name;
  input.value = id;
  label.append(input, el('span', 'lt-cm-seg-text', intentLabel(id)));
  return { label, input };
}

function createCommentBox(handlers: BoxHandlers): CommentBox {
  const form = el('form', 'lt-cm-box');
  form.hidden = true;
  form.noValidate = true;
  const heading = el('p', 'lt-cm-box-title');
  const chips = el('div', 'lt-cm-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', TEXT.chips);
  const intents = el('div', 'lt-cm-intent');
  intents.setAttribute('role', 'radiogroup');
  intents.setAttribute('aria-label', TEXT.intent);
  const groupName = `lt-cm-intent-${++boxCount}`;
  const segments = INTENT_IDS.map((id) => intentChoice(groupName, id));
  intents.append(el('span', 'lt-cm-intent-name', TEXT.intent), ...segments.map((each) => each.label));
  const text = el('textarea', 'lt-cm-text');
  text.name = 'comment';
  text.rows = 3;
  text.placeholder = TEXT.placeholder;
  text.setAttribute('aria-label', TEXT.comment);
  const error = el('p', 'lt-cm-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const submit = el('button', 'lt-cm-btn lt-cm-primary');
  submit.type = 'submit';
  const cancel = el('button', 'lt-cm-btn', TEXT.cancel);
  cancel.type = 'button';
  const hint = el('span', 'lt-cm-hint', `${isMac() ? '⌘' : 'Ctrl'}+Enter to save · Esc to cancel`);
  const actions = el('div', 'lt-cm-actions');
  actions.append(submit, cancel, hint);
  form.append(heading, chips, intents, text, error, actions);

  let preset = '';
  let intent: IntentId | undefined;
  let picked = false;
  let fallback: IntentId = DEFAULT_INTENT;
  let focused = false;

  function showIntent(id: IntentId | undefined) {
    for (const each of segments) each.input.checked = each.input.value === (id ?? fallback);
  }

  function fail(message: string) {
    error.textContent = message;
    error.hidden = false;
  }

  chips.addEventListener('mousedown', (ev) => ev.preventDefault());
  chips.addEventListener('click', (ev) => {
    const button = (ev.target as Element).closest<HTMLButtonElement>('.lt-cm-chip');
    if (!button) return;
    const next = insertText(text.value, text.selectionStart ?? text.value.length, text.selectionEnd ?? text.value.length, button.textContent ?? '');
    text.value = next.value;
    text.setSelectionRange(next.caret, next.caret);
    preset = button.dataset.preset ?? '';
    const suggestion = suggestedIntent(preset);
    if (suggestion && !picked) {
      intent = suggestion;
      showIntent(intent);
    }
    error.hidden = true;
    text.focus();
  });
  intents.addEventListener('click', (ev) => {
    const input = ev.target instanceof HTMLInputElement ? ev.target : null;
    if (!input || !isIntentId(input.value)) return;
    intent = input.value;
    picked = true;
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const comment = text.value.trim();
    if (!comment) return fail(TEXT.needComment);
    error.hidden = true;
    handlers.onSave({ comment, preset, intent });
  });
  cancel.addEventListener('click', () => handlers.onCancel());
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      handlers.onCancel();
    } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && ev.target === text) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('focusin', () => {
    focused = true;
  });
  form.addEventListener('focusout', (ev) => {
    if (ev.relatedTarget) focused = false;
  });

  return {
    el: form,
    open(spec) {
      heading.textContent = spec.heading;
      submit.textContent = spec.submit;
      form.setAttribute('aria-label', spec.heading);
      chips.replaceChildren(...spec.presets.map(chip));
      chips.hidden = spec.presets.length === 0;
      text.value = spec.comment;
      preset = spec.preset;
      intent = spec.intent;
      fallback = spec.fallback ?? DEFAULT_INTENT;
      picked = spec.intent !== undefined;
      showIntent(intent);
      error.hidden = true;
      form.hidden = false;
    },
    close() {
      form.hidden = true;
      focused = false;
    },
    isOpen: () => !form.hidden,
    wantsFocus: () => focused,
    focus(caretAtEnd = true) {
      focused = true;
      text.focus();
      if (caretAtEnd) text.setSelectionRange(text.value.length, text.value.length);
    },
    fail,
  };
}

export { createCommentBox, insertText };
export type { BoxHandlers, BoxResult, BoxSpec, CommentBox };
