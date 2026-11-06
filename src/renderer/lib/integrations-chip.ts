import { BINDING_CHOICE } from '@shared/auth-kinds';
import type { ProjectIntegrations } from '@shared/auth-view';
import { msg } from '@shared/lang/messages';
import type { ProviderId } from '@shared/providers';
import { loadAuthStatus, loadProjectIntegrations, onAuthChange } from './auth-client';
import { accountName } from './integrations-format';
import { providerLogo } from './provider-logo';
import { el } from './util';

interface IntegrationChip {
  el: HTMLElement;
  refresh(): Promise<void>;
  dispose(): void;
}

function describeSlots(view: ProjectIntegrations, names: Record<string, string>): { parts: { id: ProviderId; provider: string; text: string; ask: boolean; bound: boolean }[] } {
  const parts = view.slots.map((slot) => {
    const bound = slot.candidates.find((profile) => profile.id === slot.bound);
    const name = names[slot.provider] ?? slot.provider;
    if (bound) return { id: slot.provider, provider: name, text: accountName(bound), ask: false, bound: true };
    const ask = slot.binding === BINDING_CHOICE.choose || slot.binding === BINDING_CHOICE.unused;
    return { id: slot.provider, provider: name, text: msg(ask ? 'integrations.chip.chooseAccount' : 'integrations.chip.noAccount'), ask, bound: false };
  });
  return { parts };
}

function mountIntegrationChip(project: string, open: (opener: HTMLElement) => void): IntegrationChip {
  const box = el('span', 'lt-int-icons');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', msg('integrations.chip.group'));
  box.hidden = true;

  async function refresh() {
    const [status, view] = await Promise.all([loadAuthStatus(), loadProjectIntegrations(project)]);
    if (!status || !view) {
      box.hidden = true;
      return;
    }
    const names = Object.fromEntries(Object.entries(status.providers).map(([id, info]) => [id, info.name]));
    const { parts } = describeSlots(view, names);
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.lt-int-icon')?.dataset.provider;
    box.replaceChildren(
      ...parts.map((part) => {
        const button = el('button', `lt-int-icon${part.bound ? '' : ' is-missing'}`);
        button.type = 'button';
        button.dataset.provider = part.id;
        button.dataset.tip = msg(part.bound ? 'integrations.chip.icon' : 'integrations.chip.iconMissing', { provider: part.provider, account: part.text });
        button.setAttribute('aria-label', button.dataset.tip ?? '');
        button.append(providerLogo(part.id));
        button.addEventListener('click', () => open(button));
        return button;
      }),
    );
    if (focused) box.querySelector<HTMLElement>(`[data-provider="${focused}"]`)?.focus();
    box.hidden = parts.length === 0;
  }

  const unsubscribe = onAuthChange(() => void refresh());
  void refresh();
  return { el: box, refresh, dispose: unsubscribe };
}

export { mountIntegrationChip, describeSlots };
export type { IntegrationChip };
