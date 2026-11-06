import { describe, expect, it } from 'vitest';
import { isValidValue } from '../src/main/settings-model';
import {
  affectsSetting,
  isSettingKey,
  registerNodes,
  SETTING_DEFAULTS,
  SETTINGS,
} from '../src/shared/settings-registry';
import type { SettingKey, SettingValue } from '../src/shared/settings-registry';
import type { SettingsNode } from '../src/shared/settings-schema';

const FOLD: SettingKey = 'graph.foldFilesWhenZoomedOut';
const BINDINGS: SettingKey = 'keymap.bindings';

function node(id: string, keys: string[]): SettingsNode {
  return {
    id,
    title: id,
    properties: Object.fromEntries(keys.map((key) => [key, { type: 'boolean', default: true, description: key }])),
  };
}

describe('settings registry', () => {
  it('registers the graph folding setting under the Graph category', () => {
    const fold = SETTINGS.find((s) => s.key === FOLD);
    expect(fold?.category).toMatchObject({ id: 'graph', title: 'Graph' });
    expect(SETTING_DEFAULTS[FOLD]).toBe(true);
  });

  it('types the folding value as a boolean, not the literal default', () => {
    const off: SettingValue<typeof FOLD> = false;
    expect(off).toBe(false);
  });

  it('registers the key bindings under Keyboard shortcuts with an empty default', () => {
    const bindings = SETTINGS.find((s) => s.key === BINDINGS);
    expect(bindings?.category).toMatchObject({ id: 'keymap', title: 'Keyboard shortcuts' });
    expect(bindings?.schema.type).toBe('bindings');
    expect(SETTING_DEFAULTS[BINDINGS]).toEqual([]);
  });

  it('types the bindings value as a list of key and command pairs', () => {
    const value: SettingValue<typeof BINDINGS> = [{ key: 'mod+shift+l', command: 'lantern.open' }];
    expect(value).toHaveLength(1);
  });

  it('throws on a key declared twice', () => {
    expect(() => registerNodes([node('x', ['x.one']), node('x', ['x.one'])])).toThrow(/declared twice/);
  });

  it('throws on an empty key', () => {
    expect(() => registerNodes([node('a', [''])])).toThrow(/empty key/);
    expect(() => registerNodes([node('a', ['  '])])).toThrow(/empty key/);
  });

  it('throws on a key with surrounding whitespace', () => {
    expect(() => registerNodes([node('a', [' x.one'])])).toThrow(/whitespace/);
    expect(() => registerNodes([node('a', ['x.one '])])).toThrow(/whitespace/);
  });

  it('throws on a key outside its node id prefix', () => {
    expect(() => registerNodes([node('graph', ['editor.wrap'])])).toThrow(/must start with "graph\."/);
    expect(() => registerNodes([node('graph', ['graphics.on'])])).toThrow(/must start with/);
    expect(() => registerNodes([node('graph', ['graph.on'])])).not.toThrow();
  });

  it('keeps every default valid against its own schema', () => {
    for (const { key, schema } of SETTINGS) expect(isValidValue(schema, SETTING_DEFAULTS[key]), key).toBe(true);
  });

  it('recognises only registered keys', () => {
    expect(isSettingKey(FOLD)).toBe(true);
    expect(isSettingKey('graph.unknown')).toBe(false);
    expect(isSettingKey(42)).toBe(false);
  });

  it('matches a section by whole dotted segments', () => {
    expect(affectsSetting('graph', [FOLD])).toBe(true);
    expect(affectsSetting(FOLD, [FOLD])).toBe(true);
    expect(affectsSetting('gra', [FOLD])).toBe(false);
    expect(affectsSetting('graph', [])).toBe(false);
  });
});
