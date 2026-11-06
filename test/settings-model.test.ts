import { describe, expect, it } from 'vitest';
import {
  diffSettings,
  editSettingsText,
  isValidValue,
  modifiedKeys,
  normalizeSettingsText,
  parseSettingsFile,
  resolveSettings,
} from '../src/main/settings-model';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import type { SettingKey } from '../src/shared/settings-registry';

const FOLD: SettingKey = 'graph.foldFilesWhenZoomedOut';
const BINDINGS: SettingKey = 'keymap.bindings';
const REVIEW = { key: 'mod+shift+l', command: 'lantern.open' };

describe('parseSettingsFile', () => {
  it('treats a missing file as empty settings', () => {
    expect(parseSettingsFile(null)).toEqual({ user: {}, error: null });
  });

  it('accepts line and block comments and a trailing comma', () => {
    const text = '{\n  // fold\n  /* tiles */ "graph.foldFilesWhenZoomedOut": false,\n  "other": 1,\n}\n';
    expect(parseSettingsFile(text)).toEqual({ user: { [FOLD]: false, other: 1 }, error: null });
  });

  it('reports the first parse error with its 1-based line', () => {
    const { user, error } = parseSettingsFile('{\n  "a": 1\n  "b": 2\n}');
    expect(user).toEqual({});
    expect(error).toBe('Line 3: comma expected');
  });

  it('rejects a root that is not an object', () => {
    expect(parseSettingsFile('[]').error).toMatch(/^Line 1:/);
    expect(parseSettingsFile('true').error).toMatch(/object/);
    expect(parseSettingsFile('null').error).toMatch(/object/);
  });

  it.each(['/* x', '// a\n/* x'])('reports an unclosed comment in %j', (text) => {
    expect(parseSettingsFile(text).error).toMatch(/unexpected end of comment/);
  });

  it('ignores a leading byte order mark', () => {
    expect(parseSettingsFile('\uFEFF{"a":1}')).toEqual({ user: { a: 1 }, error: null });
  });

  it.each(['', '  \n\n ', '// hi\n/* x */\n'])('treats a blank or comments-only file %j as empty settings', (text) => {
    expect(parseSettingsFile(text)).toEqual({ user: {}, error: null });
  });
});

describe('isValidValue', () => {
  it('rejects NaN and infinite numbers', () => {
    const anyNumber = { type: 'number', default: 0, description: '' } as const;
    expect(isValidValue(anyNumber, 3)).toBe(true);
    expect(isValidValue(anyNumber, Number.NaN)).toBe(false);
    expect(isValidValue(anyNumber, parseSettingsFile('{"n": 1e999}').user.n)).toBe(false);
  });

  it('checks type, enum membership and range', () => {
    expect(isValidValue({ type: 'boolean', default: true, description: '' }, 'yes')).toBe(false);
    const mode = { type: 'string', default: 'a', enum: ['a', 'b'], description: '' } as const;
    expect(isValidValue(mode, 'b')).toBe(true);
    expect(isValidValue(mode, 'c')).toBe(false);
    const ratio = { type: 'number', default: 0.5, minimum: 0.1, maximum: 1, description: '' } as const;
    expect(isValidValue(ratio, 0.3)).toBe(true);
    expect(isValidValue(ratio, 0)).toBe(false);
    expect(isValidValue(ratio, 2)).toBe(false);
  });
});

describe('isValidValue for bindings', () => {
  const schema = { type: 'bindings', default: [], description: '' } as const;

  it('accepts known commands, removals and keys in any modifier order', () => {
    expect(isValidValue(schema, [])).toBe(true);
    expect(isValidValue(schema, [REVIEW, { key: 'Shift + Mod + R', command: '-editor.devtools' }])).toBe(true);
  });

  it.each([
    ['an unknown command', [{ key: 'mod+r', command: 'review.nope' }]],
    ['a removal of an unknown command', [{ key: 'mod+r', command: '-nope' }]],
    ['a key with two non-modifiers', [{ key: 'mod+r+t', command: 'lantern.open' }]],
    ['an empty key', [{ key: '', command: 'lantern.open' }]],
    ['a missing command', [{ key: 'mod+r' }]],
    ['a non-object entry', ['mod+r']],
    ['a null entry', [null]],
    ['an object instead of a list', REVIEW],
  ])('rejects %s', (_name, value) => {
    expect(isValidValue(schema, value)).toBe(false);
  });

  it('rejects the whole list when one entry is bad', () => {
    expect(isValidValue(schema, [REVIEW, { key: 'mod+r', command: 'nope' }])).toBe(false);
  });
});

describe('resolveSettings', () => {
  it('falls back to the default and reports an invalid value', () => {
    const { values, problems } = resolveSettings({ [FOLD]: 'no' });
    expect(values[FOLD]).toBe(true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toBe(`"${FOLD}": expected a boolean, got "no"; using the default`);
  });

  it('keeps valid bindings', () => {
    expect(resolveSettings({ [BINDINGS]: [REVIEW] })).toMatchObject({ values: { [BINDINGS]: [REVIEW] }, problems: [] });
  });

  it('falls back to the default bindings and names the setting for an unknown command', () => {
    const { values, problems } = resolveSettings({ [BINDINGS]: [REVIEW, { key: 'mod+r', command: 'nope' }] });
    expect(values[BINDINGS]).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^"keymap\.bindings": expected a list of \{ "key", "command" \} entries/);
    expect(problems[0]).toContain('"nope"');
    expect(problems[0]).toMatch(/using the default$/);
  });

  it('rejects a bare key binding with the problem message', () => {
    const { values, problems } = resolveSettings({ [BINDINGS]: [{ key: 'a', command: 'lantern.open' }] });
    expect(values[BINDINGS]).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^"keymap\.bindings": expected a list of \{ "key", "command" \} entries with a key using mod or an F-key/);
    expect(problems[0]).toContain('"a"');
  });

  it('ignores unknown keys without a problem', () => {
    expect(resolveSettings({ 'nope.key': 1 })).toEqual({ values: SETTING_DEFAULTS, problems: [] });
  });
});

describe('modifiedKeys', () => {
  it('lists a valid non-default user value', () => {
    const user = { [FOLD]: false };
    expect(modifiedKeys(user, resolveSettings(user).values)).toEqual([FOLD]);
  });

  it('lists non-empty bindings and excludes an empty list', () => {
    const user = { [BINDINGS]: [REVIEW] };
    expect(modifiedKeys(user, resolveSettings(user).values)).toEqual([BINDINGS]);
    const empty = { [BINDINGS]: [] };
    expect(modifiedKeys(empty, resolveSettings(empty).values)).toEqual([]);
  });

  it('excludes a value equal to the default and an invalid value', () => {
    for (const user of [{ [FOLD]: true }, { [FOLD]: 'off' }]) {
      expect(modifiedKeys(user, resolveSettings(user).values)).toEqual([]);
    }
  });
});

describe('editSettingsText', () => {
  it('keeps comments and unknown keys when writing', () => {
    const text = '{\n  // keep me\n  "other.key": 1\n}\n';
    const next = editSettingsText(text, FOLD, false);
    expect(next).toContain('// keep me');
    expect(parseSettingsFile(next).user).toEqual({ 'other.key': 1, [FOLD]: false });
  });

  it('removes the key when writing the default', () => {
    const text = '{\n  "graph.foldFilesWhenZoomedOut": false,\n  "other.key": 1 // keep me\n}\n';
    const next = editSettingsText(text, FOLD, true);
    expect(next).toContain('// keep me');
    expect(parseSettingsFile(next).user).toEqual({ 'other.key': 1 });
  });

  it('writes bindings and removes the key when writing an empty list', () => {
    const next = editSettingsText('{"a": 1}', BINDINGS, [REVIEW]);
    expect(parseSettingsFile(next).user).toEqual({ a: 1, [BINDINGS]: [REVIEW] });
    expect(parseSettingsFile(editSettingsText(next, BINDINGS, [])).user).toEqual({ a: 1 });
  });

  it('removes only the exact key, not keys sharing its prefix', () => {
    const text = '{"graph": 1, "graph.foldFilesWhenZoomedOutX": 2, "graph.foldFilesWhenZoomedOut": false}';
    expect(parseSettingsFile(editSettingsText(text, FOLD, true)).user).toEqual({
      graph: 1,
      'graph.foldFilesWhenZoomedOutX': 2,
    });
  });

  it('drops the byte order mark when writing', () => {
    const next = editSettingsText('\uFEFF{"a": 1}', FOLD, false);
    expect(next.startsWith('\uFEFF')).toBe(false);
    expect(parseSettingsFile(next).user).toEqual({ a: 1, [FOLD]: false });
  });

  it.each(['', '  \n\n ', '// hi\n/* x */\n'])('writes valid settings into the blank file %j', (text) => {
    const next = editSettingsText(text, FOLD, false);
    expect(parseSettingsFile(next)).toEqual({ user: { [FOLD]: false }, error: null });
    if (text.includes('//')) expect(next).toContain('// hi');
    expect(editSettingsText(text, FOLD, true)).toBe(text);
  });

  it.each(['/* x', '// a\n/* x', '{"a": 1', '[]'])('refuses to edit the broken file %j', (text) => {
    expect(() => editSettingsText(text, FOLD, false)).toThrow(/Cannot edit settings/);
  });

  it('leaves the normalised text unchanged when the edit is a no-op', () => {
    const text = '\uFEFF{"a": 1}';
    expect(editSettingsText(text, FOLD, true)).toBe(normalizeSettingsText(text));
    expect(normalizeSettingsText(text)).toBe('{"a": 1}');
    expect(editSettingsText(null, FOLD, true)).toBe(normalizeSettingsText(null));
    expect(editSettingsText(text, FOLD, false)).not.toBe(normalizeSettingsText(text));
  });

  it('empties the file when the only key has a trailing comma and is reset', () => {
    const next = editSettingsText(`{\n  "${FOLD}": false,\n}\n`, FOLD, true);
    expect(next).toBe('{}\n');
    expect(parseSettingsFile(next)).toEqual({ user: {}, error: null });
  });

  it('empties the file with the same line ending as the original', () => {
    expect(editSettingsText(`{\r\n  "${FOLD}": false,\r\n}\r\n`, FOLD, true)).toBe('{}\r\n');
  });

  it('keeps comments when resetting the only key with a trailing comma', () => {
    const next = editSettingsText(`// mine\n{\n  "${FOLD}": false, // fold\n}\n`, FOLD, true);
    expect(next).toContain('// mine');
    expect(next).toContain('// fold');
    expect(parseSettingsFile(next)).toEqual({ user: {}, error: null });
  });

  it('keeps the other keys when resetting one of two with trailing commas', () => {
    const next = editSettingsText(`{\n  "${FOLD}": false,\n  "other": 1,\n}\n`, FOLD, true);
    expect(parseSettingsFile(next)).toEqual({ user: { other: 1 }, error: null });
  });

  it('keeps CRLF line endings when adding a key', () => {
    const next = editSettingsText('{\r\n  "other": 1\r\n}\r\n', FOLD, false);
    expect(next).toContain(`"${FOLD}": false`);
    expect(next.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(parseSettingsFile(next).user).toEqual({ other: 1, [FOLD]: false });
  });

  it('starts from an empty object when there is no file', () => {
    const next = editSettingsText(null, FOLD, false);
    expect(next).toBe('{\n  "graph.foldFilesWhenZoomedOut": false\n}\n');
    expect(editSettingsText(null, FOLD, true)).toBe('{}\n');
  });
});

describe('diffSettings', () => {
  it('lists the keys whose value changed', () => {
    const off = { ...SETTING_DEFAULTS, [FOLD]: false };
    expect(diffSettings(SETTING_DEFAULTS, off)).toEqual([FOLD]);
    expect(diffSettings(SETTING_DEFAULTS, { ...SETTING_DEFAULTS })).toEqual([]);
  });

  it('compares bindings by content, not by reference', () => {
    const one = { ...SETTING_DEFAULTS, [BINDINGS]: [REVIEW] };
    expect(diffSettings(one, { ...SETTING_DEFAULTS, [BINDINGS]: [{ ...REVIEW }] })).toEqual([]);
    expect(diffSettings(SETTING_DEFAULTS, one)).toEqual([BINDINGS]);
  });
});
