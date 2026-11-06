function color(value: string, fallback: number) {
  const match = value.trim().match(/^#([\da-f]{6})$/i);
  return match ? Number.parseInt(match[1], 16) : fallback;
}

export function paletteOf(host: HTMLElement) {
  const css = getComputedStyle(host);
  const read = (name: string, fallback: number) => color(css.getPropertyValue(name), fallback);
  const layers: Record<string, number> = Object.fromEntries(['skills', 'edge', 'presentation', 'domain', 'data', 'ai', 'infra', 'support', 'system'].map((id) => [id, read(`--lt-l-${id}`, 0x8fa0ac)]));
  return {
    background: read('--lt-bg', 0x040d23),
    ink: read('--lt-ink', 0xeef3ff),
    ink2: read('--lt-ink-2', 0xb4c0d8),
    ink3: read('--lt-ink-3', 0x8190ad),
    rule: read('--lt-rule', 0x263655),
    surface: read('--lt-surface', 0x0d1c3c),
    glow: read('--lt-glow', 0xffb422),
    send: read('--lt-k-send', 0x56b4e9),
    take: read('--lt-k-take', 0xe8743b),
    both: read('--lt-k-both', 0xe58bc0),
    ref: read('--lt-k-ref', 0xc5de4f),
    layers,
    mono: css.getPropertyValue('--lt-mono').trim(),
    ui: css.fontFamily,
  };
}

export type PixiPalette = ReturnType<typeof paletteOf>;

export function edgeColor(palette: PixiPalette, kind: string) {
  if (kind === 'take') return palette.take;
  if (kind === 'both') return palette.both;
  if (kind === 'ref') return palette.ref;
  return palette.send;
}
