import type { Camera, Point, Rect, Size, ZoomLimits } from './camera';
import { FIT_PADDING, constrainCamera, easeInOut, fitCamera, lerpCamera, panBy, sameCamera, zoomAt, zoomLimits } from './camera';

const ANIMATION_MS = 380;
const BOTTOM_INSET = 44;
const FALLBACK_VIEWPORT: Size = { w: 800, h: 600 };

interface DriverOptions {
  world(): Rect;
  onChange(animating: boolean): void;
  onSettled(): void;
  reducedMotion(): boolean;
}

interface CameraDriver {
  camera(): Camera;
  viewport(): Size;
  fit(): Camera;
  limits(): ZoomLimits;
  setViewport(size: Size): void;
  fitTo(rect: Rect, padding?: number): Camera;
  jump(target: Camera): void;
  animate(target: Camera): void;
  zoomBy(factor: number, anchor: Point): void;
  panBy(dx: number, dy: number): void;
  destroy(): void;
}

function safeSize(size: Size): Size {
  return size.w > 0 && size.h > 0 ? size : FALLBACK_VIEWPORT;
}

function createCameraDriver(options: DriverOptions): CameraDriver {
  let size = FALLBACK_VIEWPORT;
  let camera: Camera = fitCamera(options.world(), size, FIT_PADDING, BOTTOM_INSET);
  let frame = 0;

  const fitAll = () => fitCamera(options.world(), size, FIT_PADDING, BOTTOM_INSET);
  const limits = () => zoomLimits(fitAll());
  const bound = (next: Camera) => constrainCamera({ ...next, k: Math.min(Math.max(next.k, limits().min), limits().max) }, options.world(), size);

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function jump(target: Camera) {
    stop();
    camera = bound(target);
    options.onChange(false);
  }

  function animate(target: Camera) {
    const goal = bound(target);
    stop();
    if (options.reducedMotion() || sameCamera(camera, goal) || typeof requestAnimationFrame !== 'function') return jump(goal);
    const from = camera;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ANIMATION_MS);
      camera = t >= 1 ? goal : lerpCamera(from, goal, easeInOut(t), size);
      frame = t >= 1 ? 0 : requestAnimationFrame(step);
      options.onChange(t < 1);
      if (t >= 1) options.onSettled();
    };
    frame = requestAnimationFrame(step);
  }

  return {
    camera: () => camera,
    viewport: () => size,
    fit: fitAll,
    limits,
    setViewport(next) {
      size = safeSize(next);
    },
    fitTo: (rect, padding = FIT_PADDING) => fitCamera(rect, size, padding, BOTTOM_INSET),
    jump,
    animate,
    zoomBy(factor, anchor) {
      stop();
      camera = bound(zoomAt(camera, factor, anchor, limits()));
      options.onChange(false);
    },
    panBy(dx, dy) {
      stop();
      camera = bound(panBy(camera, dx, dy));
      options.onChange(false);
    },
    destroy: stop,
  };
}

export { createCameraDriver };
export type { CameraDriver };
