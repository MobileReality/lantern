import { playSound } from './lib/notification-sound';
import { mountOverlay } from './lib/overlay-cards';
import { byId } from './lib/util';
import { installTooltips } from './tooltip';

installTooltips();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const overlay = mountOverlay(byId('stage')!, window.overlay, {
  play: (kind, card) => playSound(kind, card.prefs.timbre, card.prefs.volume),
  now: () => performance.now(),
  frame: (cb) => requestAnimationFrame(() => cb()),
  reducedMotion: () => reduceMotion.matches,
});

window.overlay.onCard(overlay.add);
