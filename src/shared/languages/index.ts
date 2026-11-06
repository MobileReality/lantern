import type { SettingsNode } from '../settings-schema';

export const LANGUAGES = ['english', 'polish', 'german', 'spanish', 'french', 'italian', 'portuguese', 'ukrainian'] as const;
export type Language = (typeof LANGUAGES)[number];

export const AUTOMATIC = 'automatic';

const CODES: Record<Language, string> = { english: 'en', polish: 'pl', german: 'de', spanish: 'es', french: 'fr', italian: 'it', portuguese: 'pt', ukrainian: 'uk' };

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

export function languageCode(language?: string): string {
  const name = language?.toLowerCase();
  return isLanguage(name) ? CODES[name] : 'en';
}

export function chosenLanguage(value: string | undefined): Language | undefined {
  const name = value?.toLowerCase();
  return isLanguage(name) ? name : undefined;
}

export const LANGUAGE_SETTINGS = {
  id: 'language',
  title: 'Languages',
  properties: {
    'language.map': {
      type: 'string',
      default: AUTOMATIC,
      enum: [AUTOMATIC, ...LANGUAGES],
      description:
        'Language Claude writes the map texts in when it sets up or refreshes a map. With automatic, an existing map keeps its language and a new map is written in english. A project can fix it for its whole team with "language.map" in .lantern/settings.json, which wins over this value.',
    },
    'language.explainers': {
      type: 'string',
      default: AUTOMATIC,
      enum: [AUTOMATIC, ...LANGUAGES],
      description:
        'Language Claude writes change explainers and file reasons in. With automatic, explainers follow the map language. A project can fix it for its whole team with "language.explainers" in .lantern/settings.json, which wins over this value.',
    },
  },
} satisfies SettingsNode;
