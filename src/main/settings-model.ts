import { applyEdits, modify, parse, printParseErrorCode, visit } from 'jsonc-parser';
import type { FormattingOptions, ParseError } from 'jsonc-parser';
import { isCommandId } from '../shared/commands';
import { isDispatchableKey, normalizeKey } from '../shared/commands/key-syntax';
import { SETTING_DEFAULTS, SETTINGS, settingSchema } from '../shared/settings-registry';
import type { SettingKey, SettingValues } from '../shared/settings-registry';
import type { SettingSchema } from '../shared/settings-schema';

export type UserSettings = Record<string, unknown>;

export interface ParsedSettingsFile {
  user: UserSettings;
  error: string | null;
}

export interface ResolvedSettings {
  values: SettingValues;
  problems: string[];
}

export const EMPTY_SETTINGS_TEXT = '{}\n';
const BYTE_ORDER_MARK = '\uFEFF';
const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' };
const VALUE_EXPECTED = 'ValueExpected';
const NON_OBJECT_ROOT = 'Line 1: settings must be a JSON object';

function withoutBom(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function describeParseError(text: string, error: ParseError): string {
  const message = printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return `Line ${lineAt(text, error.offset)}: ${message}`;
}

function isPlainObject(value: unknown): value is UserSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSettingsText(text: string): ParsedSettingsFile & { isBlank: boolean } {
  const errors: ParseError[] = [];
  const root: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const isBlank = root === undefined && errors.every((e) => printParseErrorCode(e.error) === VALUE_EXPECTED);
  if (isBlank) return { user: {}, error: null, isBlank };
  if (errors.length > 0) return { user: {}, error: describeParseError(text, errors[0]), isBlank };
  if (!isPlainObject(root)) return { user: {}, error: NON_OBJECT_ROOT, isBlank };
  return { user: root, error: null, isBlank };
}

export function parseSettingsFile(raw: string | null): ParsedSettingsFile {
  if (raw === null) return { user: {}, error: null };
  const { user, error } = readSettingsText(withoutBom(raw));
  return { user, error };
}

function isBinding(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const { key, command } = entry as Record<string, unknown>;
  const normalized = typeof key === 'string' ? normalizeKey(key) : undefined;
  return (
    normalized !== undefined &&
    isDispatchableKey(normalized) &&
    typeof command === 'string' &&
    isCommandId(command.startsWith('-') ? command.slice(1) : command)
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b));
}

export function isValidValue(schema: SettingSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string' && (!schema.enum || schema.enum.includes(value));
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      );
    case 'bindings':
      return Array.isArray(value) && value.every(isBinding);
  }
}

function describeExpected(schema: SettingSchema): string {
  if (schema.type === 'string' && schema.enum) return `one of ${schema.enum.join(', ')}`;
  if (schema.type === 'bindings') return 'a list of { "key", "command" } entries with a key using mod or an F-key and a known command id';
  if (schema.type !== 'number') return `a ${schema.type}`;
  const { minimum, maximum } = schema;
  if (minimum !== undefined && maximum !== undefined) return `a number between ${minimum} and ${maximum}`;
  if (minimum !== undefined) return `a number of at least ${minimum}`;
  if (maximum !== undefined) return `a number of at most ${maximum}`;
  return 'a finite number';
}

function describeReceived(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return JSON.stringify(value) ?? String(value);
}

function hasUserValue(user: UserSettings, key: string): boolean {
  return Object.hasOwn(user, key);
}

export function resolveSettings(user: UserSettings): ResolvedSettings {
  const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
  const problems: string[] = [];
  for (const { key, schema } of SETTINGS) {
    if (!hasUserValue(user, key)) continue;
    const value = user[key];
    if (isValidValue(schema, value)) values[key] = value;
    else problems.push(`"${key}": expected ${describeExpected(schema)}, got ${describeReceived(value)}; using the default`);
  }
  return { values: values as SettingValues, problems };
}

export function modifiedKeys(user: UserSettings, values: SettingValues): SettingKey[] {
  return SETTINGS.filter(
    ({ key }) => hasUserValue(user, key) && user[key] === values[key] && !sameValue(values[key], SETTING_DEFAULTS[key]),
  ).map(({ key }) => key);
}

export function normalizeSettingsText(text: string | null): string {
  return text === null ? EMPTY_SETTINGS_TEXT : withoutBom(text);
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// Removing the only property of an object with a trailing comma leaves that comma behind: `{ , }`.
function withoutCommas(text: string): { text: string; hasComment: boolean } {
  const commas: number[] = [];
  let hasComment = false;
  visit(
    text,
    {
      onSeparator: (character, offset) => {
        if (character === ',') commas.push(offset);
      },
      onComment: () => {
        hasComment = true;
      },
    },
    { allowTrailingComma: true },
  );
  const kept = commas.reduceRight((result, offset) => result.slice(0, offset) + result.slice(offset + 1), text);
  return { text: kept, hasComment };
}

function emptiedSettingsText(brokenText: string, eol: string): string {
  const { text, hasComment } = withoutCommas(brokenText);
  return hasComment ? text : EMPTY_SETTINGS_TEXT.replaceAll('\n', eol);
}

export function editSettingsText(text: string | null, key: SettingKey, value: unknown): string {
  const source = normalizeSettingsText(text);
  const { user, error, isBlank } = readSettingsText(source);
  if (error) throw new Error(`Cannot edit settings with a syntax error: ${error}`);
  const stored = sameValue(value, settingSchema(key).default) ? undefined : value;
  if (stored === undefined && isBlank) return source;
  const eol = eolOf(source);
  let next = applyEdits(source, modify(source, [key], stored, { formattingOptions: { ...FORMATTING, eol } }));
  const remainsEmpty = stored === undefined && Object.keys(user).every((k) => k === key);
  if (remainsEmpty && readSettingsText(next).error) next = emptiedSettingsText(next, eol);
  const check = readSettingsText(next);
  if (check.error) throw new Error(`Refusing to write settings that do not parse: ${check.error}`);
  return next;
}

export function diffSettings(prev: SettingValues, next: SettingValues): SettingKey[] {
  return SETTINGS.filter(({ key }) => !sameValue(prev[key], next[key])).map(({ key }) => key);
}
