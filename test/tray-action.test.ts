import { describe, expect, it } from 'vitest';
import { parseTrayAction, trayActionId } from '../src/shared/tray-action';

const KINDS = ['done', 'error'];

describe('tray actions', () => {
  it('reads the plain actions', () => {
    expect(parseTrayAction('workspace', KINDS)).toEqual({ type: 'workspace' });
    expect(parseTrayAction('clear', KINDS)).toEqual({ type: 'clear' });
    expect(parseTrayAction('quit', KINDS)).toEqual({ type: 'quit' });
  });

  it('reads a test notification only for a kind the menu offered', () => {
    expect(parseTrayAction('test:done', KINDS)).toEqual({ type: 'test', kind: 'done' });
    expect(parseTrayAction('test:waiting', KINDS)).toBeNull();
    expect(parseTrayAction('test:done', [])).toBeNull();
  });

  it('refuses anything else, including values that are not strings', () => {
    for (const value of ['', 'open', 'test:', 'quit ', 42, null, undefined, { type: 'quit' }]) expect(parseTrayAction(value, KINDS), String(value)).toBeNull();
  });

  it('round-trips through its id', () => {
    for (const action of [{ type: 'workspace' }, { type: 'clear' }, { type: 'quit' }, { type: 'test', kind: 'error' }] as const) expect(parseTrayAction(trayActionId(action), KINDS)).toEqual(action);
  });
});
