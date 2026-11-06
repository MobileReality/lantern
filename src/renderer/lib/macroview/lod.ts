import { clamp } from './camera';

type DetailLevel = 'areas' | 'features' | 'files';

interface Ramp {
  from: number;
  span: number;
}

interface Detail {
  features: number;
  files: number;
}

const FEATURES_RAMP: Ramp = { from: 290, span: 150 };
const FILES_RAMP: Ramp = { from: 250, span: 110 };
const VISIBLE = 0.02;
const ACTIVE = 0.5;
const CHAR_EM = 0.56;
const ELLIPSIS = '…';
const MIN_CHARS = 3;

function rampWeight(size: number, ramp: Ramp) {
  return clamp((size - ramp.from) / ramp.span, 0, 1);
}

function featuresWeight(areaScreenWidth: number) {
  return rampWeight(areaScreenWidth, FEATURES_RAMP);
}

function filesWeight(featureScreenWidth: number, parentFeatures: number) {
  return rampWeight(featureScreenWidth, FILES_RAMP) * parentFeatures;
}

function levelOf(detail: Detail): DetailLevel {
  if (detail.files >= ACTIVE) return 'files';
  return detail.features >= ACTIVE ? 'features' : 'areas';
}

function isShown(weight: number) {
  return weight > VISIBLE;
}

function isActive(weight: number) {
  return weight >= ACTIVE;
}

interface FittedLabel {
  text: string;
  size: number;
}

function textWidth(text: string, size: number) {
  return text.length * size * CHAR_EM;
}

function fitLabel(text: string, room: number, maxSize: number, minSize: number): FittedLabel | null {
  if (!text || room <= 0) return null;
  const natural = Math.min(maxSize, room / (text.length * CHAR_EM));
  const size = Math.max(minSize, natural);
  if (textWidth(text, size) <= room) return { text, size };
  const chars = Math.floor(room / (size * CHAR_EM)) - 1;
  if (chars < MIN_CHARS) return null;
  return { text: `${text.slice(0, chars).trimEnd()}${ELLIPSIS}`, size };
}

function wrapLines(text: string, room: number, size: number, maxLines: number): string[] {
  const perLine = Math.floor(room / (size * CHAR_EM));
  if (perLine < MIN_CHARS || maxLines < 1) return [];
  const lines: string[] = [];
  let current = '';
  const words = text.split(/\s+/).filter(Boolean);
  for (const [index, word] of words.entries()) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    if (lines.length === maxLines) return closeLines(lines, words.slice(index).join(' '), perLine);
    current = word;
  }
  if (current) lines.push(current);
  return lines.map((line) => (line.length > perLine ? `${line.slice(0, perLine - 1).trimEnd()}${ELLIPSIS}` : line));
}

function closeLines(lines: string[], rest: string, perLine: number) {
  const last = `${lines[lines.length - 1]} ${rest}`;
  return [...lines.slice(0, -1), last.length > perLine ? `${last.slice(0, perLine - 1).trimEnd()}${ELLIPSIS}` : last];
}

export { ACTIVE, FEATURES_RAMP, FILES_RAMP, VISIBLE, featuresWeight, filesWeight, fitLabel, isActive, isShown, levelOf, rampWeight, textWidth, wrapLines };
export type { Detail, DetailLevel, FittedLabel, Ramp };
