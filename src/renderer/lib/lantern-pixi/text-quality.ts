export const TEXT_QUALITY_DELAY_MS = 500;

export function textResolution(scale: number, pixelRatio: number) {
  const qualityScale = Math.ceil(Math.max(1, Math.min(4, scale)) * 4) / 4;
  return pixelRatio * qualityScale;
}

export class DeferredTextQuality {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: number | null = null;

  constructor(private current: number, private readonly refresh: (resolution: number) => void) {}

  schedule(resolution: number) {
    if (resolution === this.current) {
      this.cancel();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.pending = resolution;
    this.timer = setTimeout(() => {
      this.timer = null;
      const next = this.pending;
      this.pending = null;
      if (next === null || next === this.current) return;
      this.refresh(next);
      this.current = next;
    }, TEXT_QUALITY_DELAY_MS);
  }

  setCurrent(resolution: number) {
    this.cancel();
    this.current = resolution;
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
