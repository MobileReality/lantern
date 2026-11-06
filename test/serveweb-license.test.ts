import { describe, expect, it, vi } from 'vitest';
import { createServerLicenseConsent } from '../src/main/serveweb-license';

function world(answer: boolean) {
  const state = { accepted: false };
  const ask = vi.fn(async () => answer);
  const consent = createServerLicenseConsent({ stored: () => state.accepted, remember: () => {
      state.accepted = true;
    }, ask });
  return { consent, ask, state };
}

describe('createServerLicenseConsent', () => {
  it('stores an acceptance and never asks again', async () => {
    const { consent, ask, state } = world(true);
    expect(await consent.ask()).toBe(true);
    expect(state.accepted).toBe(true);
    expect(await consent.ask()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('stores nothing on a decline, so the next open asks again', async () => {
    const { consent, ask, state } = world(false);
    expect(await consent.ask()).toBe(false);
    expect(state.accepted).toBe(false);
    await consent.ask();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('treats a failing dialog as a decline', async () => {
    const consent = createServerLicenseConsent({
      stored: () => false,
      remember: () => undefined,
      ask: async () => {
        throw new Error('no window');
      },
    });
    expect(await consent.ask()).toBe(false);
  });

  it('shares one dialog between concurrent asks', async () => {
    const { consent, ask } = world(true);
    await Promise.all([consent.ask(), consent.ask()]);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
