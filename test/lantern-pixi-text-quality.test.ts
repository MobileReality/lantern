import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredTextQuality, TEXT_QUALITY_DELAY_MS, textResolution } from '../src/renderer/lib/lantern-pixi/text-quality';

describe('Pixi text quality', () => {
  afterEach(() => vi.useRealTimers());

  it('waits 500ms after zoom activity', () => {
    expect(TEXT_QUALITY_DELAY_MS).toBe(500);
  });

  it('keeps natural quality below 100% and buckets higher zoom resolutions', () => {
    expect(textResolution(0.5, 2)).toBe(2);
    expect(textResolution(2.07, 2)).toBe(4.5);
    expect(textResolution(10, 2)).toBe(8);
  });

  it('refreshes once after the last effective quality change', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const quality = new DeferredTextQuality(2, refresh);

    quality.schedule(3);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS - 1);
    quality.schedule(4);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(4);

    quality.schedule(4);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('restarts the idle delay for zoom changes within one quality bucket', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const quality = new DeferredTextQuality(2, refresh);
    quality.schedule(3);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS - 1);
    quality.schedule(3);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('cancels a stale upgrade when zoom returns to the installed quality', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const quality = new DeferredTextQuality(1, refresh);
    quality.schedule(2);
    quality.schedule(1);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cancels a pending refresh when disposed', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const quality = new DeferredTextQuality(1, refresh);
    quality.schedule(2);
    quality.cancel();
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('adopts initial quality without scheduling a redundant refresh', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const quality = new DeferredTextQuality(1, refresh);
    quality.schedule(2);
    quality.setCurrent(3);
    quality.schedule(3);
    vi.advanceTimersByTime(TEXT_QUALITY_DELAY_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});
