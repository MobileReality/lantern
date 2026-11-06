import { KEYMAP_SETTINGS } from './commands/keymap-settings';
import { LANGUAGE_SETTINGS } from './languages';
import { GRAPH_SETTINGS } from './settings-graph';
import { NOTIFICATION_SETTINGS } from './settings-notifications';
import { REASONS_SETTINGS } from './settings-reasons';
import type { KeyBinding, SettingSchema, SettingsNode } from './settings-schema';
import { TAB_SETTINGS } from './settings-tabs';

const SETTINGS_NODES = [GRAPH_SETTINGS, LANGUAGE_SETTINGS, NOTIFICATION_SETTINGS, TAB_SETTINGS, REASONS_SETTINGS, KEYMAP_SETTINGS] as const;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
type Properties = UnionToIntersection<(typeof SETTINGS_NODES)[number]['properties']>;

type Widen<T> = T extends boolean ? boolean : T extends string ? string : T extends number ? number : T;

export type SettingKey = keyof Properties & string;
export type SettingValue<K extends SettingKey> = Properties[K] extends { enum: readonly (infer E extends string)[] }
  ? E
  : Properties[K] extends { type: 'bindings' }
    ? readonly KeyBinding[]
    : Widen<Properties[K]['default']>;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export interface SettingsCategory {
  id: string;
  title: string;
  order: number;
}

export interface RegisteredSetting<K extends string = SettingKey> {
  key: K;
  schema: SettingSchema;
  category: SettingsCategory;
}

export interface SettingsSnapshot {
  values: SettingValues;
  modified: SettingKey[];
  problems: string[];
  writable: boolean;
}

export type SettingsUpdateResult = { ok: true; snapshot: SettingsSnapshot } | { ok: false; error: string };

export interface SettingsChange {
  snapshot: SettingsSnapshot;
  changed: SettingKey[];
}

const UNORDERED = Number.MAX_SAFE_INTEGER;

export function registerNodes(nodes: readonly SettingsNode[]): RegisteredSetting<string>[] {
  const seen = new Set<string>();
  const settings: RegisteredSetting<string>[] = [];
  for (const node of nodes) {
    const category = { id: node.id, title: node.title, order: node.order ?? UNORDERED };
    for (const [key, schema] of Object.entries(node.properties)) {
      if (!key.trim()) throw new Error(`Settings node "${node.id}" declares an empty key`);
      if (key !== key.trim()) throw new Error(`Setting "${key}" has surrounding whitespace`);
      if (!key.startsWith(`${node.id}.`)) throw new Error(`Setting "${key}" must start with "${node.id}."`);
      if (seen.has(key)) throw new Error(`Setting "${key}" is declared twice`);
      seen.add(key);
      settings.push({ key, schema, category });
    }
  }
  return settings;
}

export const SETTINGS = registerNodes(SETTINGS_NODES) as readonly RegisteredSetting[];

export const SETTING_DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, s.schema.default])) as SettingValues;

const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key as string, s]));

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && SETTINGS_BY_KEY.has(key);
}

export function settingSchema(key: SettingKey): SettingSchema {
  const setting = SETTINGS_BY_KEY.get(key);
  if (!setting) throw new Error(`Unknown setting "${key}"`);
  return setting.schema;
}

export function affectsSetting(section: string, keys: readonly string[]): boolean {
  return keys.some((key) => key === section || key.startsWith(`${section}.`));
}
