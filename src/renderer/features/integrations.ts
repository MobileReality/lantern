import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { addToken, bindAccount, loadAuthStatus, loadProjectIntegrations, onAuthChange, removeAccount, renameAccount, setAccountEmail, setAccountExpiry, unbindAccount } from '@renderer/lib/auth-client';
import { buildAccountRow } from '@renderer/lib/integrations-account';
import { buildAddForm } from '@renderer/lib/integrations-form';
import type { Added } from '@renderer/lib/integrations-form';
import { accountName } from '@renderer/lib/integrations-format';
import { buildProjectCard } from '@renderer/lib/integrations-projects';
import { buildProjectTile } from '@renderer/lib/integrations-tiles';
import { trapTab } from '@renderer/lib/modal-focus';
import { providerLogo } from '@renderer/lib/provider-logo';
import type { ProjectRef } from '@renderer/lib/opened-projects';
import { el } from '@renderer/lib/util';
import { activeProjectPath } from '@renderer/state';
import { MAX_NICKNAME_LENGTH } from '@shared/auth-input';
import { AUTH_ERROR, PERSISTENCE } from '@shared/auth-kinds';
import type { AuthErrorCode } from '@shared/auth-kinds';
import type { AuthStatus, ProfileStatus, ProjectIntegrations } from '@shared/auth-view';
import { msg, msgCount } from '@shared/lang/messages';
import type { MessageKey } from '@shared/lang/messages';
import { PROVIDER_ROLE, providersWithRole } from '@shared/providers';
import type { ProviderId, ProviderRole } from '@shared/providers';

interface IntegrationsDeps {
  projects: () => ProjectRef[];
  focusProject?: string | null;
  now?: () => number;
}

const TITLE_ID = 'int-dialog-title';
const GROUP_ROLES: readonly ProviderRole[] = [PROVIDER_ROLE.codeHost, PROVIDER_ROLE.tracker];
type FailureTexts = Partial<Record<AuthErrorCode, MessageKey>>;

const RENAME_FAILURES: FailureTexts = {
  [AUTH_ERROR.invalidRequest]: 'auth.input.nickname',
  [AUTH_ERROR.unknownProfile]: 'integrations.failure.unknownProfile',
};
const EMAIL_FAILURES: FailureTexts = {
  [AUTH_ERROR.invalidRequest]: 'integrations.failure.emailInvalid',
  [AUTH_ERROR.unknownProfile]: 'integrations.failure.unknownProfile',
};
const EXPIRY_FAILURES: FailureTexts = {
  [AUTH_ERROR.invalidRequest]: 'integrations.failure.expiryInvalid',
  [AUTH_ERROR.unknownProfile]: 'integrations.failure.unknownProfile',
  [AUTH_ERROR.providerReportsExpiry]: 'integrations.failure.expiryProvider',
};

const failureText = (texts: FailureTexts, error: AuthErrorCode, fallback: MessageKey) => msg(texts[error] ?? fallback, { max: MAX_NICKNAME_LENGTH });

let open: { modal: HTMLElement; focus: () => void } | null = null;

interface Section {
  provider: ProviderId;
  root: HTMLElement;
  count: HTMLElement;
  add: HTMLButtonElement;
  formHost: HTMLElement;
  list: HTMLUListElement;
  empty: HTMLElement;
}

function openIntegrations(opener: Element | null, deps: IntegrationsDeps): void {
  if (open) return open.focus();
  const now = deps.now ?? Date.now;
  const modal = el('div', 'modal int-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', TITLE_ID);
  const card = el('div', 'modal-card int-card');
  const head = el('div', 'modal-head');
  const title = el('span', 'modal-title', msg('integrations.title'));
  title.id = TITLE_ID;
  const announce = el('p', 'int-announce');
  announce.setAttribute('role', 'status');
  const close = el('button', 'modal-close');
  close.type = 'button';
  close.dataset.tip = msg('integrations.close.title');
  close.setAttribute('aria-label', msg('integrations.close.label'));
  close.innerHTML = CLOSE_ICON;
  head.append(title, announce, close);

  const body = el('div', 'int-body');
  const intro = el('p', 'int-intro', msg('integrations.intro'));
  const jump = el('button', 'int-btn int-jump', msg('integrations.projects.jump'));
  jump.type = 'button';
  jump.dataset.tip = msg('integrations.projects.jumpTitle');
  const banner = el('p', 'int-banner');
  banner.hidden = true;
  const loadError = el('p', 'int-banner int-banner-error', msg('integrations.loadError'));
  loadError.setAttribute('role', 'alert');
  loadError.hidden = true;
  const sectionsHost = el('div', 'int-sections');
  const projectsHost = el('section', 'int-group int-projects');
  projectsHost.setAttribute('aria-labelledby', 'int-projects-title');
  const projectsTitle = el('h3', 'int-group-title', msg('integrations.projects.title'));
  projectsTitle.id = 'int-projects-title';
  const projectsList = el('div', 'int-tiles');
  projectsHost.append(projectsTitle, el('p', 'int-group-note', msg('integrations.projects.note')), projectsList);
  body.append(intro, jump, banner, loadError, sectionsHost, projectsHost);
  card.append(head, body);
  modal.append(card);
  document.body.append(modal);

  const sections = new Map<ProviderId, Section>();
  let status: AuthStatus | null = null;
  const askedForProject = typeof deps.focusProject === 'string';
  let selectedProject = deps.focusProject === undefined ? activeProjectPath() : deps.focusProject;
  let announceTimer: ReturnType<typeof setTimeout> | undefined;

  const say = (text: string) => {
    announce.textContent = text;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (announce.textContent = ''), 6000);
  };

  function closeForms(except?: ProviderId) {
    for (const section of sections.values()) {
      if (section.provider === except) continue;
      section.formHost.replaceChildren();
      section.add.setAttribute('aria-expanded', 'false');
    }
  }

  function showForm(provider: ProviderId) {
    const section = sections.get(provider);
    if (!section || !status) return;
    closeForms(provider);
    if (section.formHost.firstChild) {
      (section.formHost.querySelector('input') as HTMLElement | null)?.focus();
      return;
    }
    const hide = () => {
      section.formHost.replaceChildren();
      section.add.setAttribute('aria-expanded', 'false');
      section.add.focus();
    };
    const form = buildAddForm({
      provider,
      providerName: status.providers[provider].name,
      submit: addToken,
      onClose: hide,
      onAdded: (added) => void accountAdded(provider, added),
    });
    section.formHost.append(form);
    section.add.setAttribute('aria-expanded', 'true');
    (form.querySelector('input') as HTMLElement | null)?.focus();
    form.scrollIntoView?.({ block: 'nearest' });
  }

  async function accountAdded(provider: ProviderId, added: Added) {
    const section = sections.get(provider);
    section?.formHost.replaceChildren();
    section?.add.setAttribute('aria-expanded', 'false');
    await refresh();
    say(msg(added.created ? 'integrations.announce.added' : 'integrations.announce.updated', { name: accountName(added.profile) }));
    (sections.get(provider)?.list.querySelector(`[data-profile="${added.profile.id}"] button`) as HTMLElement | null)?.focus();
  }

  const accountDeps = {
    now,
    rename: async (profile: ProfileStatus, nickname: string) => {
      const reply = await renameAccount(profile.id, nickname);
      if (!reply.ok) return failureText(RENAME_FAILURES, reply.error, 'integrations.failure.renameFallback');
      await refresh();
      return null;
    },
    setExpiry: async (profile: ProfileStatus, expiresOn: string | null) => {
      const reply = await setAccountExpiry(profile.id, expiresOn);
      if (!reply.ok) return failureText(EXPIRY_FAILURES, reply.error, 'integrations.failure.expiryFallback');
      await refresh();
      return null;
    },
    setEmail: async (profile: ProfileStatus, email: string | null) => {
      const reply = await setAccountEmail(profile.id, email);
      if (!reply.ok) return failureText(EMAIL_FAILURES, reply.error, 'integrations.failure.emailFallback');
      await refresh();
      return null;
    },
    remove: async (profile: ProfileStatus) => {
      const removed = await removeAccount(profile.id);
      await refresh();
      say(msg(removed ? 'integrations.announce.removed' : 'integrations.announce.notRemoved', { name: accountName(profile) }));
    },
  };

  function buildSection(provider: ProviderId, name: string): Section {
    const root = el('section', 'int-provider');
    root.dataset.provider = provider;
    const headingId = `int-provider-${provider}`;
    root.setAttribute('aria-labelledby', headingId);
    const header = el('div', 'int-provider-head');
    const heading = el('h4', 'int-provider-name', name);
    const logo = providerLogo(provider);
    heading.id = headingId;
    const count = el('span', 'int-count');
    const add = el('button', 'int-btn int-btn-add', msg('integrations.provider.add'));
    add.type = 'button';
    add.setAttribute('aria-expanded', 'false');
    add.setAttribute('aria-label', msg('integrations.provider.addLabel', { provider: name }));
    add.addEventListener('click', () => (add.getAttribute('aria-expanded') === 'true' ? closeForms() : showForm(provider)));
    header.append(logo, heading, count, add);
    const formHost = el('div', 'int-form-host');
    const list = el('ul', 'int-accounts');
    list.setAttribute('aria-label', msg('integrations.provider.accountsLabel', { provider: name }));
    const empty = el('p', 'int-empty');
    root.append(header, formHost, list, empty);
    return { provider, root, count, add, formHost, list, empty };
  }

  function buildSections(current: AuthStatus) {
    for (const role of GROUP_ROLES) {
      const wrap = el('section', 'int-group');
      const titleId = `int-group-${role}`;
      wrap.setAttribute('aria-labelledby', titleId);
      const heading = el('h3', 'int-group-title', msg(`integrations.group.${role}`));
      heading.id = titleId;
      wrap.append(heading);
      for (const provider of providersWithRole(role)) {
        const section = buildSection(provider, current.providers[provider].name);
        sections.set(provider, section);
        wrap.append(section.root);
      }
      sectionsHost.append(wrap);
    }
  }

  function renderAccounts(current: AuthStatus) {
    for (const section of sections.values()) {
      const info = current.providers[section.provider];
      const profiles = info.profiles;
      section.count.textContent = profiles.length === 0 ? '' : msgCount('counts.accounts', profiles.length);
      section.list.replaceChildren(...profiles.map((profile) => buildAccountRow(profile, accountDeps)));
      section.empty.hidden = profiles.length > 0;
      section.empty.textContent = msg(`integrations.provider.empty.${info.role}`, { provider: info.name });
    }
    banner.hidden = current.persistence === PERSISTENCE.secure;
    banner.textContent = msg('integrations.memoryOnly');
  }

  async function renderProjects(current: AuthStatus) {
    const refs = deps.projects();
    const views = await Promise.all(refs.map(async (ref) => [ref, await loadProjectIntegrations(ref.path)] as const));
    const names = Object.fromEntries(Object.entries(current.providers).map(([id, info]) => [id, info.name])) as Record<ProviderId, string>;
    const projectDeps = {
      names,
      bind: async (provider: ProviderId, profileId: string, project: string) => {
        await bindAccount(provider, profileId, project);
        await refresh();
      },
      unbind: async (provider: ProviderId, project: string) => {
        await unbindAccount(provider, project);
        await refresh();
      },
      addAccount: (provider: ProviderId) => {
        sections.get(provider)?.root.scrollIntoView?.({ block: 'start' });
        showForm(provider);
      },
    };
    const known = views.filter((entry): entry is readonly [ProjectRef, ProjectIntegrations] => entry[1] !== null);
    const chosen = known.find(([ref]) => ref.path === selectedProject);
    if (chosen) {
      const back = el('button', 'int-btn int-back', msg('integrations.projects.back'));
      back.type = 'button';
      back.dataset.tip = msg('integrations.projects.backTitle');
      back.addEventListener('click', () => showTiles(chosen[0].path));
      projectsList.className = 'int-project-detail';
      projectsList.replaceChildren(back, buildProjectCard(chosen[1], chosen[0].name, projectDeps));
      return;
    }
    selectedProject = null;
    projectsList.className = 'int-tiles';
    const tiles = known.map(([ref, view]) => buildProjectTile(view, ref.name, names, () => showDetail(ref.path)));
    projectsList.replaceChildren(...(tiles.length ? tiles : [el('p', 'int-empty', msg('integrations.projects.empty'))]));
  }

  function focusDetail() {
    projectsHost.scrollIntoView?.({ block: 'start' });
    (projectsList.querySelector('select, .int-tile, .int-btn:not(.int-back)') as HTMLElement | null)?.focus();
  }

  function showDetail(project: string) {
    selectedProject = project;
    void refresh().then(focusDetail);
  }

  function showTiles(project: string) {
    selectedProject = null;
    void refresh().then(() => [...projectsList.querySelectorAll<HTMLElement>('.int-tile')].find((node) => node.dataset.project === project)?.focus());
  }

  let refreshing: Promise<void> = Promise.resolve();
  let landed = false;

  function refresh(): Promise<void> {
    refreshing = refreshing.then(async () => {
      const current = await loadAuthStatus();
      if (!modal.isConnected) return;
      loadError.hidden = current !== null;
      if (!current) return;
      status = current;
      if (sections.size === 0) buildSections(current);
      renderAccounts(current);
      await renderProjects(current);
      if (!landed) {
        landed = true;
        if (selectedProject && askedForProject) focusDetail();
      }
    });
    return refreshing;
  }

  jump.addEventListener('click', focusDetail);
  const unsubscribe = onAuthChange(() => void refresh());

  function dismiss() {
    window.removeEventListener('keydown', onKey, true);
    unsubscribe();
    clearTimeout(announceTimer);
    open = null;
    modal.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Tab') return trapTab(e, modal);
    if (e.key !== 'Escape') return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.int-form, .int-inline')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    dismiss();
  }

  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', dismiss);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) dismiss();
  });
  open = { modal, focus: () => (modal.querySelector('.int-btn, select') as HTMLElement | null)?.focus() };
  close.focus();
  void refresh();
}

function isIntegrationsOpen(): boolean {
  return open !== null;
}

export { openIntegrations, isIntegrationsOpen };
export type { IntegrationsDeps };
