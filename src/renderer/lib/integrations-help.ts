import { msg, msgList } from '@shared/lang/messages';
import type { MessageKey } from '@shared/lang/messages';
import { PROVIDER, PROVIDERS, TOKEN_FIELD } from '@shared/providers';
import type { ProviderId, TokenField } from '@shared/providers';

interface FieldCopy {
  label: string;
  placeholder: string;
}

interface ProviderHelp {
  title: string;
  page: string;
  steps: string[];
  fields: Partial<Record<TokenField, FieldCopy>>;
}

type LabelBase = MessageKey extends infer Key ? (Key extends `${infer Base}.label` ? Base : never) : never;

type CopyBase = LabelBase extends infer Base ? (Base extends string ? (`${Base}.placeholder` extends MessageKey ? Base : never) : never) : never;

const FIELD_COPY: Record<ProviderId, Partial<Record<TokenField, CopyBase>>> = {
  [PROVIDER.github]: { [TOKEN_FIELD.token]: 'integrations.help.github.token' },
  [PROVIDER.bitbucket]: { [TOKEN_FIELD.email]: 'integrations.form.email', [TOKEN_FIELD.token]: 'integrations.form.apiToken' },
  [PROVIDER.jira]: { [TOKEN_FIELD.site]: 'integrations.help.jira.site', [TOKEN_FIELD.email]: 'integrations.form.email', [TOKEN_FIELD.token]: 'integrations.form.apiToken' },
};

const fieldCopy = (base: CopyBase): FieldCopy => ({ label: msg(`${base}.label`), placeholder: msg(`${base}.placeholder`) });

function providerHelp(provider: ProviderId): ProviderHelp {
  const bases = Object.entries(FIELD_COPY[provider]) as [TokenField, CopyBase][];
  return {
    title: msg('integrations.help.title'),
    page: PROVIDERS[provider].tokenPage,
    steps: msgList(`integrations.help.${provider}.steps`),
    fields: Object.fromEntries(bases.map(([field, base]) => [field, fieldCopy(base)])),
  };
}

export { providerHelp };
export type { ProviderHelp, FieldCopy };
