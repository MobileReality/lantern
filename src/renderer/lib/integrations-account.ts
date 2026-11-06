import WARN_ICON from '@renderer/assets/icons/warn.svg';
import { formatExpiryDate } from '@shared/auth-expiry';
import { MAX_NICKNAME_LENGTH, parseCommitEmail } from '@shared/auth-input';
import { CONNECTION_STATE, EXPIRY_LEVEL, EXPIRY_SOURCE } from '@shared/auth-kinds';
import type { ConnectionState, ExpiryLevel } from '@shared/auth-kinds';
import type { ProfileStatus } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import type { MessageKey } from '@shared/lang/messages';
import { PROVIDERS } from '@shared/providers';
import { providerLogo } from './provider-logo';
import { accountDetail, accountDetailParts, accountName, expiryLabel } from './integrations-format';
import { confirmBtn, el, formatDay } from './util';

interface AccountDeps {
  now: () => number;
  rename: (profile: ProfileStatus, nickname: string) => Promise<string | null>;
  setExpiry: (profile: ProfileStatus, expiresOn: string | null) => Promise<string | null>;
  setEmail: (profile: ProfileStatus, email: string | null) => Promise<string | null>;
  remove: (profile: ProfileStatus) => Promise<void>;
}

const STATE_NOTES: Partial<Record<ConnectionState, MessageKey>> = {
  [CONNECTION_STATE.expired]: 'integrations.account.problem.expired',
  [CONNECTION_STATE.unavailable]: 'integrations.account.problem.unavailable',
};

const WARNED_LEVELS: readonly ExpiryLevel[] = [EXPIRY_LEVEL.soon, EXPIRY_LEVEL.expired];

const EMAIL_ACTIONS = {
  set: { label: 'integrations.account.setEmail', describe: 'integrations.account.setEmailLabel' },
  change: { label: 'integrations.account.changeEmail', describe: 'integrations.account.changeEmailLabel' },
} as const;

const EXPIRY_ACTIONS = {
  set: { label: 'integrations.account.setExpiry', describe: 'integrations.account.setExpiryLabel' },
  change: { label: 'integrations.account.changeExpiry', describe: 'integrations.account.changeExpiryLabel' },
} as const;

function button(label: string, onClick: () => void, cls = 'int-btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function inlineForm(label: string, input: HTMLInputElement, submit: string, extra: HTMLElement[], onSubmit: () => void, onCancel: () => void): HTMLFormElement {
  const form = el('form', 'int-inline');
  const field = el('label', 'int-inline-field');
  field.append(el('span', 'int-inline-label', label), input);
  const save = el('button', 'int-btn int-btn-primary', submit);
  save.type = 'submit';
  form.append(field, save, ...extra, button(msg('common.cancel'), onCancel));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  });
  return form;
}

function buildEmailLine(profile: ProfileStatus): HTMLElement {
  const line = el('div', profile.email === null ? 'int-account-email int-account-email-none' : 'int-account-email');
  line.append(el('span', 'int-account-email-label', msg('integrations.account.emailLine')), el('span', 'int-account-email-value', profile.email ?? msg('integrations.account.emailNone')));
  line.dataset.tip = profile.email ?? msg('integrations.account.emailNone');
  return line;
}

function buildAccountRow(profile: ProfileStatus, deps: AccountDeps): HTMLLIElement {
  const row = el('li', 'int-account');
  row.dataset.profile = profile.id;
  const mark = el('span', 'int-mark');
  mark.append(providerLogo(profile.provider));

  const main = el('div', 'int-account-main');
  const nameLine = el('div', 'int-account-name');
  const name = el('strong', 'int-nickname', accountName(profile));
  name.dataset.tip = accountName(profile);
  nameLine.append(name);
  const detail = el('div', 'int-account-detail');
  detail.append(...accountDetailParts(profile).map((part) => el('span', 'int-detail-part', part)));
  detail.dataset.tip = accountDetail(profile);
  detail.hidden = detail.childElementCount === 0;

  const emailLine = PROVIDERS[profile.provider].optionalEmail ? buildEmailLine(profile) : null;

  const meta = el('div', 'int-account-meta');
  meta.append(el('span', 'int-added', msg('integrations.account.added', { date: formatDay(profile.createdAt) })));
  const expiry = expiryLabel(profile.expiresAt, deps.now());
  const chip = el('span', `int-expiry int-expiry-${expiry.level}`);
  chip.dataset.tip = expiry.title;
  if (WARNED_LEVELS.includes(expiry.level)) chip.insertAdjacentHTML('afterbegin', WARN_ICON);
  chip.append(el('span', 'int-expiry-text', expiry.text));
  if (profile.expirySource === EXPIRY_SOURCE.provider) chip.append(el('span', 'int-expiry-source', msg('integrations.expiry.providerReported')));
  meta.append(chip);

  const note = STATE_NOTES[profile.state];
  const problem = note ? el('p', 'int-account-problem', msg(note)) : null;
  main.append(nameLine, detail, ...(emailLine ? [emailLine] : []), meta, ...(problem ? [problem] : []));

  const error = el('p', 'int-account-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const fail = (message: string | null) => {
    error.hidden = message === null;
    error.textContent = message ?? '';
  };

  const actions = el('div', 'int-account-actions');
  const restore = (focus: HTMLElement) => {
    row.querySelector('.int-inline')?.remove();
    main.hidden = false;
    actions.hidden = false;
    focus.focus();
  };

  const rename = button(msg('common.rename'), () => {
    const input = el('input', 'int-input');
    input.value = accountName(profile);
    input.maxLength = MAX_NICKNAME_LENGTH;
    input.required = true;
    const form = inlineForm(
      msg('integrations.account.nameLabel'),
      input,
      msg('common.save'),
      [],
      async () => {
        const failure = await deps.rename(profile, input.value);
        if (failure === null) return;
        fail(failure);
        input.focus();
      },
      () => {
        fail(null);
        restore(rename);
      },
    );
    main.hidden = true;
    actions.hidden = true;
    row.insertBefore(form, error);
    input.focus();
    input.select();
  });
  rename.setAttribute('aria-label', msg('integrations.account.renameLabel', { name: accountName(profile) }));

  const expiryAction = EXPIRY_ACTIONS[profile.expiresAt === null ? 'set' : 'change'];
  const expiryButton = button(msg(expiryAction.label), () => {
    const input = el('input', 'int-input');
    input.type = 'date';
    if (profile.expiresAt !== null) input.value = formatExpiryDate(profile.expiresAt);
    const clear = button(msg('integrations.account.noExpiry'), async () => {
      const failure = await deps.setExpiry(profile, null);
      if (failure !== null) fail(failure);
    });
    const form = inlineForm(
      msg('integrations.account.expiresOnLabel'),
      input,
      msg('common.save'),
      profile.expiresAt === null ? [] : [clear],
      async () => {
        if (!input.value) return fail(msg('integrations.account.pickDate'));
        const failure = await deps.setExpiry(profile, input.value);
        if (failure === null) return;
        fail(failure);
        input.focus();
      },
      () => {
        fail(null);
        restore(expiryButton);
      },
    );
    main.hidden = true;
    actions.hidden = true;
    row.insertBefore(form, error);
    input.focus();
  });
  expiryButton.setAttribute('aria-label', msg(expiryAction.describe, { name: accountName(profile) }));

  const emailAction = EMAIL_ACTIONS[profile.email === null ? 'set' : 'change'];
  const emailButton = button(msg(emailAction.label), () => {
    const input = el('input', 'int-input');
    input.type = 'email';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = profile.email ?? '';
    const save = async () => {
      const parsed = parseCommitEmail(input.value);
      if (!parsed.ok) {
        fail(msg('integrations.failure.emailInvalid'));
        return input.focus();
      }
      const failure = await deps.setEmail(profile, parsed.email);
      if (failure === null) return;
      fail(failure);
      input.focus();
    };
    const clear = button(msg('integrations.account.noEmail'), async () => {
      const failure = await deps.setEmail(profile, null);
      if (failure !== null) fail(failure);
    });
    const form = inlineForm(
      msg('integrations.account.emailFieldLabel'),
      input,
      msg('common.save'),
      profile.email === null ? [] : [clear],
      save,
      () => {
        fail(null);
        restore(emailButton);
      },
    );
    main.hidden = true;
    actions.hidden = true;
    row.insertBefore(form, error);
    input.focus();
    input.select();
  });
  emailButton.setAttribute('aria-label', msg(emailAction.describe, { name: accountName(profile) }));

  const remove = confirmBtn(msg('integrations.account.remove'), msg('integrations.account.removeConfirm'), () => void deps.remove(profile), 'int-btn int-btn-danger');
  remove.dataset.tip = msg('integrations.account.removeTitle', { name: accountName(profile) });
  name.id = `int-name-${profile.id}`;
  remove.setAttribute('aria-describedby', name.id);

  actions.append(rename, ...(emailLine ? [emailButton] : []), ...(profile.expirySource === EXPIRY_SOURCE.provider ? [] : [expiryButton]), remove);
  row.append(mark, main, actions, error);
  return row;
}

export { buildAccountRow };
export type { AccountDeps };
