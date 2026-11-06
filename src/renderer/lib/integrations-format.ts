import { expiryState } from '@shared/auth-expiry';
import { BINDING_CHOICE, CREDENTIAL_SOURCE, EXPIRY_LEVEL } from '@shared/auth-kinds';
import type { CredentialSource, ExpiryLevel } from '@shared/auth-kinds';
import type { ProfileStatus, ProjectHost, ProjectSlot } from '@shared/auth-view';
import { msg, msgCount } from '@shared/lang/messages';
import type { MessageKey } from '@shared/lang/messages';
import { PROVIDER, PROVIDERS } from '@shared/providers';
import { formatDay } from './util';

interface ExpiryLabel {
  text: string;
  title: string;
  level: ExpiryLevel;
}

const EXPIRY_LABELS: Record<ExpiryLevel, (days: number, date: string) => Pick<ExpiryLabel, 'text' | 'title'>> = {
  [EXPIRY_LEVEL.none]: () => ({ text: msg('integrations.expiry.none'), title: msg('integrations.expiry.noneTitle') }),
  [EXPIRY_LEVEL.ok]: (_days, date) => ({ text: msg('integrations.expiry.on', { date }), title: msg('integrations.expiry.titleOn', { date }) }),
  [EXPIRY_LEVEL.soon]: (days, date) => ({ text: days === 1 ? msg('integrations.expiry.tomorrow') : msgCount('integrations.expiry.inDays', days), title: msg('integrations.expiry.titleOn', { date }) }),
  [EXPIRY_LEVEL.expired]: (days, date) => ({ text: days === 0 ? msg('integrations.expiry.today') : msgCount('integrations.expiry.ago', days), title: msg('integrations.expiry.titleExpired', { date }) }),
};

function expiryLabel(expiresAt: number | null, now: number): ExpiryLabel {
  const { level, days } = expiryState(expiresAt, now);
  const date = expiresAt === null ? '' : formatDay(expiresAt, { utc: true });
  return { ...EXPIRY_LABELS[level](days, date), level };
}

function accountDetailParts(profile: ProfileStatus): string[] {
  const parts: string[] = [];
  if (profile.provider === PROVIDER.jira) {
    parts.push(profile.email ?? profile.login);
    if (profile.site) parts.push(profile.site.replace(/^https:\/\//, ''));
  } else {
    parts.push(profile.login);
    if (profile.displayName && profile.displayName !== profile.login) parts.push(profile.displayName);
    if (profile.email && !PROVIDERS[profile.provider].optionalEmail) parts.push(profile.email);
  }
  return parts.filter((part) => part !== accountName(profile));
}

const accountDetail = (profile: ProfileStatus) => accountDetailParts(profile).join(', ');

function accountName(profile: ProfileStatus): string {
  return profile.nickname || profile.login;
}

function accountOptionLabel(profile: ProfileStatus): string {
  const name = accountName(profile);
  const extra = profile.provider === PROVIDER.jira ? profile.site?.replace(/^https:\/\//, '') : profile.login !== name ? profile.login : null;
  return extra ? `${name} – ${extra}` : name;
}

function hostLabel(host: ProjectHost): string | null {
  const remote = host.provider ? PROVIDERS[host.provider].remoteHost : null;
  if (!remote || !host.owner || !host.repo) return null;
  return `${remote}/${host.owner}/${host.repo}`;
}

const slotRole = (slot: ProjectSlot): string => msg(`integrations.role.${slot.role}`);

const bindingNote = (slot: ProjectSlot, providerName: string): string => msg(`integrations.binding.${slot.binding}`, { provider: providerName });

const WINNER_KEYS: Record<CredentialSource, MessageKey | null> = {
  [CREDENTIAL_SOURCE.environment]: 'integrations.winner.environment',
  [CREDENTIAL_SOURCE.lantern]: 'integrations.winner.lantern',
  [CREDENTIAL_SOURCE.projectFile]: null,
  [CREDENTIAL_SOURCE.none]: 'integrations.winner.none',
};

const winnerNote = (slot: ProjectSlot): string | null => {
  if (slot.binding === BINDING_CHOICE.unused && slot.winner === CREDENTIAL_SOURCE.none) return null;
  const key = WINNER_KEYS[slot.winner];
  return key ? msg(key) : null;
};

const isShadowed = (slot: ProjectSlot): boolean => slot.binding === BINDING_CHOICE.bound && slot.winner === CREDENTIAL_SOURCE.environment;

const suggestedNote = (slot: ProjectSlot, providerName: string): string | null => (slot.suggested ? msg('integrations.projects.suggested', { provider: providerName }) : null);

export { expiryLabel, accountDetail, accountDetailParts, accountName, accountOptionLabel, hostLabel, slotRole, bindingNote, winnerNote, isShadowed, suggestedNote };
export type { ExpiryLabel };
