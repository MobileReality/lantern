import { INPUT_FIELD, parseTokenInput } from '@shared/auth-input';
import type { InputField, InputIssue } from '@shared/auth-input';
import { AUTH_ERROR } from '@shared/auth-kinds';
import type { AddTokenResult } from '@shared/auth-view';
import { EXPIRY_WARNING_DAYS } from '@shared/auth-expiry';
import { msg } from '@shared/lang/messages';
import { PROVIDERS, TOKEN_FIELD } from '@shared/providers';
import type { ProviderId } from '@shared/providers';
import { providerHelp } from './integrations-help';
import { providerLogo } from './provider-logo';
import { el } from './util';

type Added = Extract<AddTokenResult, { ok: true }>;

interface FormDeps {
  provider: ProviderId;
  providerName: string;
  submit: (input: Record<string, unknown>) => Promise<AddTokenResult>;
  onAdded: (added: Added) => void;
  onClose: () => void;
}

interface Field {
  input: HTMLInputElement;
  error: HTMLElement;
}

function makeField(form: HTMLElement, id: string, name: InputField, label: string, placeholder: string, hint?: string): Field {
  const wrap = el('div', 'int-field');
  const inputId = `${id}-${name}`;
  const caption = el('label', 'int-label', label);
  caption.htmlFor = inputId;
  const input = el('input', 'int-input');
  input.id = inputId;
  input.name = name;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  if (name === INPUT_FIELD.token) input.type = 'password';
  if (name === INPUT_FIELD.expiresOn) input.type = 'date';
  const error = el('p', 'int-field-error');
  error.id = `${inputId}-error`;
  error.hidden = true;
  input.setAttribute('aria-describedby', hint ? `${inputId}-hint ${error.id}` : error.id);
  wrap.append(caption, input);
  if (hint) {
    const note = el('p', 'int-field-hint', hint);
    note.id = `${inputId}-hint`;
    wrap.append(note);
  }
  wrap.append(error);
  form.append(wrap);
  return { input, error };
}

function buildAddForm(deps: FormDeps): HTMLFormElement {
  const { provider, providerName } = deps;
  const help = providerHelp(provider);
  const id = `int-form-${provider}`;
  const form = el('form', 'int-form');
  form.noValidate = true;
  form.setAttribute('aria-labelledby', `${id}-title`);
  form.dataset.provider = provider;

  const title = el('h4', 'int-form-title');
  title.append(providerLogo(provider), msg('integrations.form.title', { provider: providerName }));
  title.id = `${id}-title`;

  const fields = el('div', 'int-form-fields');
  const byName = new Map<InputField, Field>();
  for (const name of PROVIDERS[provider].tokenFields) {
    const copy = help.fields[name];
    if (!copy) continue;
    const hint = name === TOKEN_FIELD.token ? msg('integrations.form.tokenHint') : undefined;
    byName.set(name, makeField(fields, id, name, copy.label, copy.placeholder, hint));
  }
  const optional = el('div', 'int-form-optional');
  if (PROVIDERS[provider].optionalEmail) {
    byName.set(INPUT_FIELD.email, makeField(optional, id, INPUT_FIELD.email, msg('integrations.form.commitEmail.label'), msg('integrations.form.commitEmail.placeholder'), msg('integrations.form.commitEmail.hint')));
  }
  byName.set(INPUT_FIELD.nickname, makeField(optional, id, INPUT_FIELD.nickname, msg('integrations.form.nickname.label'), msg('integrations.form.nickname.placeholder'), msg('integrations.form.nickname.hint')));
  const expiryHint = PROVIDERS[provider].reportsExpiry ? msg('integrations.form.expiresOn.hintReported', { provider: providerName }) : msg('integrations.form.expiresOn.hintWarned', { days: EXPIRY_WARNING_DAYS });
  byName.set(INPUT_FIELD.expiresOn, makeField(optional, id, INPUT_FIELD.expiresOn, msg('integrations.form.expiresOn.label'), '', expiryHint));
  fields.append(optional);

  const aside = el('aside', 'int-help');
  aside.setAttribute('aria-label', msg('integrations.form.helpLabel', { provider: providerName }));
  aside.append(el('h5', 'int-help-title', help.title), el('p', 'int-help-page', help.page));
  const steps = el('ul', 'int-help-steps');
  for (const step of help.steps) steps.append(el('li', '', step));
  aside.append(steps);

  const failure = el('p', 'int-form-failure');
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  const status = el('p', 'int-form-status');
  status.setAttribute('role', 'status');

  const save = el('button', 'int-btn int-btn-primary', msg('integrations.form.submit'));
  save.type = 'submit';
  const cancel = el('button', 'int-btn', msg('common.cancel'));
  cancel.type = 'button';
  cancel.addEventListener('click', deps.onClose);
  const actions = el('div', 'int-form-actions');
  actions.append(save, cancel, status);

  const body = el('div', 'int-form-body');
  body.append(fields, aside);
  form.append(title, body, failure, actions);

  function showIssue(issue: InputIssue) {
    for (const field of byName.values()) {
      field.error.hidden = true;
      field.input.removeAttribute('aria-invalid');
    }
    const target = byName.get(issue.field);
    if (!target) {
      failure.hidden = false;
      failure.textContent = issue.message;
      return;
    }
    target.error.hidden = false;
    target.error.textContent = issue.message;
    target.input.setAttribute('aria-invalid', 'true');
    target.input.focus();
  }

  function clearMessages() {
    failure.hidden = true;
    failure.textContent = '';
    for (const field of byName.values()) {
      field.error.hidden = true;
      field.input.removeAttribute('aria-invalid');
    }
  }

  function setBusy(busy: boolean) {
    save.disabled = busy;
    cancel.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    status.textContent = busy ? msg('integrations.form.checking', { provider: providerName }) : '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    clearMessages();
    const raw = Object.fromEntries([...byName].map(([name, field]) => [name, field.input.value]));
    const parsed = parseTokenInput(provider, raw);
    if (!parsed.ok) return showIssue(parsed.issue);
    setBusy(true);
    const reply = await deps.submit({ provider, ...raw });
    setBusy(false);
    if (reply.ok) {
      const tokenField = byName.get(INPUT_FIELD.token);
      if (tokenField) tokenField.input.value = '';
      return deps.onAdded(reply);
    }
    if (reply.error === AUTH_ERROR.invalidInput) return showIssue({ field: reply.field as InputIssue['field'], message: reply.message });
    failure.hidden = false;
    failure.textContent = 'message' in reply ? reply.message : msg('integrations.form.saveFailed');
    byName.get(INPUT_FIELD.token)?.input.focus();
  });

  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || save.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    deps.onClose();
  });

  return form;
}

export { buildAddForm };
export type { FormDeps, Added };
