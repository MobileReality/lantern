// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { isValidValue } from '../src/main/settings-model';
import { mountSettingsEditor } from '../src/renderer/lib/settings-editor';
import { SETTINGS, SETTING_DEFAULTS, isSettingKey } from '../src/shared/settings-registry';
import type { SettingKey } from '../src/shared/settings-registry';
import { DEFAULT_IDLE_TAB_MINUTES, TAB_SETTINGS } from '../src/shared/settings-tabs';

const CLOSE: SettingKey = 'tabs.closeIdleProjectTabs';
const MINUTES: SettingKey = 'tabs.idleMinutes';

describe('project tab settings', () => {
  it('registers both keys under their own Project tabs node', () => {
    expect(isSettingKey(CLOSE)).toBe(true);
    expect(isSettingKey(MINUTES)).toBe(true);
    for (const key of [CLOSE, MINUTES]) expect(SETTINGS.find((s) => s.key === key)?.category).toMatchObject({ id: 'tabs', title: 'Project tabs' });
  });

  it('is off by default, with a ten minute idle time', () => {
    expect(SETTING_DEFAULTS[CLOSE]).toBe(false);
    expect(SETTING_DEFAULTS[MINUTES]).toBe(10);
    expect(DEFAULT_IDLE_TAB_MINUTES).toBe(10);
    expect(TAB_SETTINGS.properties[CLOSE].default).toBe(false);
  });

  it('accepts a sensible number of minutes and rejects nonsense', () => {
    const schema = TAB_SETTINGS.properties[MINUTES];
    for (const value of [1, 10, 90, 1440]) expect(isValidValue(schema, value), String(value)).toBe(true);
    for (const value of [0, -5, 1441, Number.NaN, '10', null]) expect(isValidValue(schema, value), String(value)).toBe(false);
  });

  it('shows a Close idle project tabs row with a checkbox and an unchecked default', () => {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    mountSettingsEditor(host, { values: SETTING_DEFAULTS, modified: [], problems: [], writable: true }, { update: vi.fn(), openFile: vi.fn() });
    const row = host.querySelector<HTMLElement>(`.st-row[data-key="${CLOSE}"]`)!;
    expect(row.querySelector('.st-title')!.textContent).toBe('Close idle project tabs');
    expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    const minutesRow = host.querySelector<HTMLElement>(`.st-row[data-key="${MINUTES}"]`)!;
    expect(minutesRow.querySelector('.st-title')!.textContent).toBe('Idle minutes');
  });
});
