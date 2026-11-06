import { BINDING_CHOICE } from '@shared/auth-kinds';
import type { ProjectIntegrations, ProjectSlot } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import { CODE_HOST_IDS, PROVIDERS } from '@shared/providers';
import type { ProviderId } from '@shared/providers';
import { accountOptionLabel, bindingNote, hostLabel, isShadowed, slotRole, suggestedNote, winnerNote } from './integrations-format';
import { providerLogo } from './provider-logo';
import { el } from './util';

interface ProjectDeps {
  names: Record<ProviderId, string>;
  bind: (provider: ProviderId, profileId: string, project: string) => Promise<void>;
  unbind: (provider: ProviderId, project: string) => Promise<void>;
  addAccount: (provider: ProviderId) => void;
}

const CHOOSE = '';
const CODE_HOST_NAMES = new Intl.ListFormat('en', { type: 'disjunction' });
let cardCount = 0;

function namesLine(label: string, names: string[]): HTMLElement {
  const line = el('p', 'int-slot-env');
  line.append(`${label} `);
  names.forEach((name, index) => {
    if (index > 0) line.append(', ');
    line.append(el('code', 'int-code', name));
  });
  return line;
}

function buildSlot(slot: ProjectSlot, project: string, projectName: string, deps: ProjectDeps): HTMLElement {
  const providerName = deps.names[slot.provider];
  const row = el('div', 'int-slot');
  row.dataset.provider = slot.provider;
  const heading = el('div', 'int-slot-title');
  const providerLine = el('span', 'int-slot-provider');
  providerLine.append(providerLogo(slot.provider), providerName);
  heading.append(providerLine, el('span', 'int-slot-role', slotRole(slot)));
  const control = el('div', 'int-slot-control');

  if (slot.candidates.length === 0) {
    const add = el('button', 'int-btn', msg('integrations.provider.addLabel', { provider: providerName }));
    add.type = 'button';
    add.addEventListener('click', () => deps.addAccount(slot.provider));
    control.append(add);
  } else {
    const select = el('select', 'int-select');
    select.setAttribute('aria-label', msg('integrations.projects.selectLabel', { provider: providerName, project: projectName }));
    if (slot.bound === null) {
      const ask = el('option', '', msg('integrations.projects.choose'));
      ask.value = CHOOSE;
      ask.selected = true;
      ask.disabled = true;
      select.append(ask);
    }
    for (const profile of slot.candidates) {
      const option = el('option', '', accountOptionLabel(profile));
      option.value = profile.id;
      option.selected = profile.id === slot.bound;
      select.append(option);
    }
    select.addEventListener('change', () => {
      if (select.value !== CHOOSE) void deps.bind(slot.provider, select.value, project);
    });
    control.append(select);
    if (slot.binding === BINDING_CHOICE.bound) {
      const unlink = el('button', 'int-btn', msg('integrations.projects.unlink'));
      unlink.type = 'button';
      unlink.dataset.tip = msg('integrations.projects.unlinkTitle', { project: projectName });
      unlink.addEventListener('click', () => void deps.unbind(slot.provider, project));
      control.append(unlink);
    }
  }

  const note = el('p', slot.binding === BINDING_CHOICE.choose ? 'int-slot-note int-slot-ask' : 'int-slot-note', bindingNote(slot, providerName));
  row.append(heading, control);
  if (isShadowed(slot)) row.append(el('p', 'int-slot-warn', msg('integrations.projects.shadowed')));
  row.append(note);
  const suggested = suggestedNote(slot, providerName);
  if (suggested) row.append(el('p', 'int-slot-hint', suggested));
  const winner = slot.candidates.length > 0 ? winnerNote(slot) : null;
  if (winner) row.append(el('p', 'int-slot-run', winner));
  if (slot.inEnvironment.length) row.append(namesLine(msg('integrations.projects.setInEnvironment'), slot.inEnvironment));
  return row;
}

function buildProjectCard(view: ProjectIntegrations, projectName: string, deps: ProjectDeps): HTMLElement {
  const card = el('section', 'int-project');
  card.dataset.project = view.project;
  const head = el('header', 'int-project-head');
  const title = el('h4', 'int-project-name', projectName);
  cardCount += 1;
  title.id = `int-project-${cardCount}`;
  card.setAttribute('aria-labelledby', title.id);
  const path = el('span', 'int-project-path', view.project);
  path.dataset.tip = view.project;
  head.append(title, path);

  const remote = hostLabel(view.host);
  const host = el('p', 'int-project-remote');
  if (remote) host.append(`${msg('integrations.projects.remote')} `, el('code', 'int-code', remote));
  else host.textContent = msg('integrations.projects.noRemote', { hosts: CODE_HOST_NAMES.format(CODE_HOST_IDS.map((id) => PROVIDERS[id].name)) });

  card.append(head, host);
  for (const slot of view.slots) card.append(buildSlot(slot, view.project, projectName, deps));
  return card;
}

export { buildProjectCard };
export type { ProjectDeps };
