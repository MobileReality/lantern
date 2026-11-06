import { describe, expect, it } from 'vitest';
import { MOTIFS, frequency, scheduleSound, type SoundKind } from '../src/renderer/lib/notification-sound';
import { NOTIFICATION_TIMBRES } from '../src/shared/settings-notifications';

function param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
}

function fakeContext() {
  const counts = { oscillators: 0, sources: 0 };
  const node = () => ({ connect() {}, start() {}, stop() {}, gain: param(), frequency: param(), detune: param(), Q: param(), delayTime: param(), type: '' });
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    destination: node(),
    createGain: node,
    createBiquadFilter: node,
    createDelay: node,
    createOscillator: () => {
      counts.oscillators++;
      return node();
    },
    createBufferSource: () => {
      counts.sources++;
      return { ...node(), buffer: null };
    },
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as AudioContext, counts };
}

const KINDS = Object.keys(MOTIFS) as SoundKind[];
const contour = (kind: SoundKind) => MOTIFS[kind].notes.map((note) => `${note.at}:${note.midi}`).join(' ');

describe('notification sounds', () => {
  it('gives every kind its own rhythm and pitches', () => {
    expect(new Set(KINDS.map(contour)).size).toBe(KINDS.length);
  });

  it('rises for done and falls for errors', () => {
    const done = MOTIFS.done.notes;
    const error = MOTIFS.error.notes;
    expect(done[done.length - 1].midi).toBeGreaterThan(done[0].midi);
    expect(error[error.length - 1].midi).toBeLessThan(error[0].midi);
  });

  it('marks only permission with the percussive click', () => {
    expect(KINDS.filter((kind) => MOTIFS[kind].click)).toEqual(['permission']);
  });

  it('tunes A4 to 440 Hz', () => {
    expect(frequency(69)).toBe(440);
    expect(frequency(81)).toBeCloseTo(880);
  });

  it('stays silent for the none timbre and at zero volume', () => {
    const { ctx, counts } = fakeContext();
    expect(scheduleSound(ctx, 'done', 'none', 1)).toBe(false);
    expect(scheduleSound(ctx, 'done', 'bell', 0)).toBe(false);
    expect(counts.oscillators).toBe(0);
  });

  it.each(NOTIFICATION_TIMBRES.filter((timbre) => timbre !== 'none'))('schedules every note of every kind with %s', (timbre) => {
    for (const kind of KINDS) {
      const { ctx, counts } = fakeContext();
      expect(scheduleSound(ctx, kind, timbre, 0.7)).toBe(true);
      expect(counts.oscillators).toBeGreaterThanOrEqual(MOTIFS[kind].notes.length);
      expect(counts.sources).toBe(MOTIFS[kind].click ? 1 : 0);
    }
  });
});
