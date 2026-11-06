// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { isValidValue } from '../src/main/settings-model';
import { mountSettingsEditor } from '../src/renderer/lib/settings-editor';
import { SETTINGS, SETTING_DEFAULTS, isSettingKey } from '../src/shared/settings-registry';
import type { SettingKey } from '../src/shared/settings-registry';
import { DEFAULT_REASONS_DIFF_CHARS, DEFAULT_REASONS_REPLY_CHARS, REASONS_SETTINGS } from '../src/shared/settings-reasons';

const REPLY: SettingKey = 'reasons.maxReplyCharacters';
const DIFF: SettingKey = 'reasons.maxDiffCharacters';

describe('generated reasons settings', () => {
  it('registers both limits under their own node', () => {
    for (const key of [REPLY, DIFF]) {
      expect(isSettingKey(key)).toBe(true);
      expect(SETTINGS.find((s) => s.key === key)?.category).toMatchObject({ id: 'reasons', title: 'Generated reasons' });
    }
  });

  it('defaults to twice the Explain reply cap and a 240k diff budget', () => {
    expect(SETTING_DEFAULTS[REPLY]).toBe(16_000);
    expect(SETTING_DEFAULTS[DIFF]).toBe(240_000);
    expect(DEFAULT_REASONS_REPLY_CHARS).toBe(16_000);
    expect(DEFAULT_REASONS_DIFF_CHARS).toBe(240_000);
  });

  it('accepts sizes inside the bounds and rejects nonsense', () => {
    for (const value of [2_000, 16_000, 120_000]) expect(isValidValue(REASONS_SETTINGS.properties[REPLY], value), String(value)).toBe(true);
    for (const value of [0, 1_999, 120_001, Number.NaN, '16000', null]) expect(isValidValue(REASONS_SETTINGS.properties[REPLY], value), String(value)).toBe(false);
    for (const value of [10_000, 240_000, 600_000]) expect(isValidValue(REASONS_SETTINGS.properties[DIFF], value), String(value)).toBe(true);
    for (const value of [9_999, 600_001, -1]) expect(isValidValue(REASONS_SETTINGS.properties[DIFF], value), String(value)).toBe(false);
  });

  it('shows both rows in the settings editor', () => {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    mountSettingsEditor(host, { values: SETTING_DEFAULTS, modified: [], problems: [], writable: true }, { update: vi.fn(), openFile: vi.fn() });
    expect(host.querySelector(`.st-row[data-key="${REPLY}"] .st-title`)?.textContent).toBe('Max reply characters');
    expect(host.querySelector(`.st-row[data-key="${DIFF}"] .st-title`)?.textContent).toBe('Max diff characters');
  });
});
