import type { RegisteredSetting, SettingsCategory } from '../../shared/settings-registry';

export const MODIFIED_TOKEN = '@modified';

export interface SettingsQuery {
  text: string;
  modifiedOnly: boolean;
}

export interface SettingsGroup<S extends RegisteredSetting<string>> {
  category: SettingsCategory;
  settings: S[];
}

const UNORDERED = Number.MAX_SAFE_INTEGER;

export function settingTitle(key: string): string {
  const name = key.slice(key.lastIndexOf('.') + 1);
  const words = name.split(/(?=[A-Z])/).map((word) => word.toLowerCase());
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function parseQuery(text: string): SettingsQuery {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const modifiedOnly = words.some((word) => word.toLowerCase() === MODIFIED_TOKEN);
  const rest = words.filter((word) => word.toLowerCase() !== MODIFIED_TOKEN);
  return { text: rest.join(' '), modifiedOnly };
}

export function countText(count: number): string {
  if (count === 0) return 'No settings found';
  return count === 1 ? '1 setting' : `${count} settings`;
}

export function matchesWords(haystack: string, text: string): boolean {
  const lower = haystack.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => lower.includes(word));
}

function matchesText(setting: RegisteredSetting<string>, text: string): boolean {
  return matchesWords(`${setting.key} ${settingTitle(setting.key)} ${setting.schema.description}`, text);
}

export function filterSettings<S extends RegisteredSetting<string>>(
  settings: readonly S[],
  query: SettingsQuery,
  modified: ReadonlySet<string>,
  category: string | null,
): S[] {
  return settings.filter(
    (setting) =>
      (!category || setting.category.id === category) &&
      (!query.modifiedOnly || modified.has(setting.key)) &&
      matchesText(setting, query.text),
  );
}

function compareSettings(a: RegisteredSetting<string>, b: RegisteredSetting<string>): number {
  const byOrder = (a.schema.order ?? UNORDERED) - (b.schema.order ?? UNORDERED);
  return byOrder || settingTitle(a.key).localeCompare(settingTitle(b.key));
}

export function groupByCategory<S extends RegisteredSetting<string>>(settings: readonly S[]): SettingsGroup<S>[] {
  const groups = new Map<string, SettingsGroup<S>>();
  for (const setting of settings) {
    const group = groups.get(setting.category.id) ?? { category: setting.category, settings: [] };
    group.settings.push(setting);
    groups.set(setting.category.id, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.category.order - b.category.order || a.category.title.localeCompare(b.category.title))
    .map((group) => ({ ...group, settings: group.settings.sort(compareSettings) }));
}
