import bitbucket from '@renderer/assets/logos/bitbucket.svg';
import github from '@renderer/assets/logos/github.svg';
import jira from '@renderer/assets/logos/jira.svg';
import type { ProviderId } from '@shared/providers';
import { el } from './util';

const LOGOS: Record<ProviderId, string> = { github, bitbucket, jira };

function providerLogo(provider: ProviderId): HTMLSpanElement {
  const logo = el('span', `prov-logo prov-logo-${provider}`);
  logo.innerHTML = LOGOS[provider];
  logo.setAttribute('aria-hidden', 'true');
  return logo;
}

export { providerLogo };
