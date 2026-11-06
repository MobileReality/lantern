import type { CardKind } from '../../main/session-notification';
import type { NotificationTimbre } from '../../shared/settings-notifications';

export type SoundKind = CardKind;

export interface Note {
  at: number;
  midi: number;
  dur: number;
  vel: number;
}

interface Motif {
  notes: Note[];
  click: boolean;
}

// Each kind keeps its own rhythm and contour, so the kinds stay apart whatever timbre is picked.
export const MOTIFS: Record<SoundKind, Motif> = {
  done: {
    click: false,
    notes: [
      { at: 0, midi: 76, dur: 0.16, vel: 0.7 },
      { at: 0.08, midi: 80, dur: 0.16, vel: 0.75 },
      { at: 0.16, midi: 83, dur: 0.2, vel: 0.8 },
      { at: 0.26, midi: 88, dur: 0.6, vel: 0.9 },
    ],
  },
  waiting: {
    click: false,
    notes: [
      { at: 0, midi: 69, dur: 0.38, vel: 0.6 },
      { at: 0.24, midi: 74, dur: 0.7, vel: 0.7 },
    ],
  },
  permission: {
    click: true,
    notes: [
      { at: 0, midi: 83, dur: 0.09, vel: 0.9 },
      { at: 0, midi: 90, dur: 0.09, vel: 0.5 },
      { at: 0.13, midi: 83, dur: 0.09, vel: 0.9 },
      { at: 0.13, midi: 90, dur: 0.09, vel: 0.5 },
      { at: 0.3, midi: 88, dur: 0.32, vel: 0.8 },
    ],
  },
  error: {
    click: false,
    notes: [
      { at: 0, midi: 65, dur: 0.22, vel: 0.85 },
      { at: 0, midi: 53, dur: 0.22, vel: 0.5 },
      { at: 0.2, midi: 64, dur: 0.6, vel: 0.85 },
      { at: 0.2, midi: 52, dur: 0.6, vel: 0.5 },
    ],
  },
};

export function frequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

type Voice = (ctx: AudioContext, out: AudioNode, note: Note, start: number) => void;

function envelope(ctx: AudioContext, out: AudioNode, start: number, attack: number, decay: number, peak: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  gain.connect(out);
  return gain;
}

function osc(ctx: AudioContext, type: OscillatorType, freq: number, start: number, stop: number, out: AudioNode, detune = 0) {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.setValueAtTime(freq, start);
  node.detune.setValueAtTime(detune, start);
  node.connect(out);
  node.start(start);
  node.stop(stop);
  return node;
}

// Two-operator FM: an inharmonic modulator ratio gives metal, an integer one gives wood.
function fm(ratio: number, index: number, indexDecay: number, decayScale: number): Voice {
  return (ctx, out, note, start) => {
    const f = frequency(note.midi);
    const decay = note.dur * decayScale;
    const amp = envelope(ctx, out, start, 0.003, decay, note.vel);
    const carrier = osc(ctx, 'sine', f, start, start + decay + 0.05, amp);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * index, start);
    depth.gain.exponentialRampToValueAtTime(f * 0.01, start + indexDecay);
    depth.connect(carrier.frequency);
    osc(ctx, 'sine', f * ratio, start, start + decay + 0.05, depth);
  };
}

const glass: Voice = (ctx, out, note, start) => {
  const f = frequency(note.midi);
  const decay = note.dur * 2.4;
  const amp = envelope(ctx, out, start, 0.008, decay, note.vel * 0.8);
  for (const [ratio, level, detune] of [
    [1, 1, 0],
    [2.76, 0.35, 4],
    [5.4, 0.12, -6],
  ]) {
    const partial = ctx.createGain();
    partial.gain.value = level;
    partial.connect(amp);
    osc(ctx, 'sine', f * ratio, start, start + decay + 0.05, partial, detune);
  }
};

const synth: Voice = (ctx, out, note, start) => {
  const f = frequency(note.midi);
  const decay = note.dur * 1.6;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(f * 8, start);
  filter.frequency.exponentialRampToValueAtTime(f * 1.5, start + decay);
  const amp = envelope(ctx, out, start, 0.004, decay, note.vel * 0.45);
  filter.connect(amp);
  osc(ctx, 'sawtooth', f, start, start + decay + 0.05, filter, -7);
  osc(ctx, 'sawtooth', f, start, start + decay + 0.05, filter, 7);
};

const retro: Voice = (ctx, out, note, start) => {
  const f = frequency(note.midi);
  const decay = note.dur * 1.1;
  const amp = envelope(ctx, out, start, 0.002, decay, note.vel * 0.25);
  const square = osc(ctx, 'square', f, start, start + decay + 0.05, amp);
  square.frequency.setValueAtTime(f * 2, start);
  square.frequency.setValueAtTime(f, start + 0.025);
};

const VOICES: Record<Exclude<NotificationTimbre, 'none'>, Voice> = {
  bell: fm(3.5, 2.2, 0.6, 2.2),
  marimba: fm(4, 1.6, 0.05, 0.9),
  glass,
  synth,
  retro,
};

function click(ctx: AudioContext, out: AudioNode, start: number) {
  const length = Math.floor(ctx.sampleRate * 0.012);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2500;
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(start);
}

function echo(ctx: AudioContext, out: AudioNode): AudioNode {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.17;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  input.connect(out);
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(out);
  return input;
}

export function scheduleSound(ctx: AudioContext, kind: SoundKind, timbre: NotificationTimbre, volume: number): boolean {
  if (timbre === 'none' || volume <= 0) return false;
  const motif = MOTIFS[kind];
  const master = ctx.createGain();
  master.gain.value = Math.min(1, volume) * 0.6;
  master.connect(ctx.destination);
  const bus = echo(ctx, master);
  const start = ctx.currentTime + 0.02;
  if (motif.click) click(ctx, bus, start);
  for (const note of motif.notes) VOICES[timbre](ctx, bus, note, start + note.at);
  return true;
}

let shared: AudioContext | null = null;

export function playSound(kind: SoundKind, timbre: NotificationTimbre, volume: number): void {
  if (timbre === 'none' || volume <= 0) return;
  shared ??= new AudioContext();
  if (shared.state === 'suspended') void shared.resume();
  scheduleSound(shared, kind, timbre, volume);
}
