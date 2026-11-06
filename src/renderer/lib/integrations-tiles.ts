import { BINDING_CHOICE } from '@shared/auth-kinds';
import type { ProjectIntegrations, ProjectSlot } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import type { ProviderId } from '@shared/providers';
import { providerLogo } from './provider-logo';
import { el } from './util';

interface TileState {
  text: string;
  attention: boolean;
}

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

const isConnected = (slot: ProjectSlot) => slot.binding === BINDING_CHOICE.bound || slot.binding === BINDING_CHOICE.default;

const connectedProviders = (view: ProjectIntegrations): ProviderId[] => view.slots.filter(isConnected).map((slot) => slot.provider);

function tileState(view: ProjectIntegrations, names: Record<ProviderId, string>): TileState {
  if (view.slots.some((slot) => slot.binding === BINDING_CHOICE.choose)) return { text: msg('integrations.tile.attention'), attention: true };
  const connected = connectedProviders(view).map((provider) => names[provider]);
  if (connected.length === 0) return { text: msg('integrations.tile.none'), attention: false };
  return { text: msg('integrations.tile.connected', { providers: LIST.format(connected) }), attention: false };
}

function buildProjectTile(view: ProjectIntegrations, projectName: string, names: Record<ProviderId, string>, open: () => void): HTMLButtonElement {
  const state = tileState(view, names);
  const tile = el('button', state.attention ? 'int-tile int-tile-ask' : 'int-tile');
  tile.type = 'button';
  tile.dataset.project = view.project;
  tile.dataset.tip = view.project;
  tile.setAttribute('aria-label', msg('integrations.projects.openTile', { project: projectName, state: state.text }));
  const line = el('span', 'int-tile-line');
  line.append(...connectedProviders(view).map((provider) => providerLogo(provider)), el('span', 'int-tile-state', state.text));
  tile.append(el('span', 'int-tile-name', projectName), line);
  tile.addEventListener('click', open);
  return tile;
}

export { buildProjectTile, tileState };
export type { TileState };
