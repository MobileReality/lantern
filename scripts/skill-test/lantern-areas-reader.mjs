import fs from 'node:fs';
import path from 'node:path';
import { runScript, SETUP_SCRIPTS } from './fixtures.mjs';

export const NO_ANSWER = 'unsure';
const STEM_LENGTH = 5;
const MIN_WORD = 4;
const AREAS_HEAD = 'Areas:';
const FEATURE_HEAD = 'Feature:';
const AREA_LINE = /^- ([a-z0-9-]+): (.*)$/;

const FILLER = new Set(['with', 'their', 'that', 'from', 'they', 'this', 'into', 'about', 'when', 'whenever', 'until', 'where', 'what', 'each', 'them', 'have']);
const stemsOf = (text) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= MIN_WORD && !FILLER.has(w)).map((w) => w.slice(0, STEM_LENGTH)));

export function parsePacket(text) {
  const lines = text.split('\n');
  const featureAt = lines.indexOf(FEATURE_HEAD);
  const areas = lines.slice(lines.indexOf(AREAS_HEAD) + 1, featureAt).map((l) => AREA_LINE.exec(l)).filter(Boolean).map(([, id, purpose]) => ({ id, purpose }));
  return { areas, feature: lines[featureAt + 1] };
}

export function standInAnswer(packetText) {
  const { areas, feature } = parsePacket(packetText);
  const wanted = stemsOf(feature);
  const scored = areas.map((a) => ({ id: a.id, hits: [...stemsOf(a.purpose)].filter((s) => wanted.has(s)).length }));
  const best = scored.reduce((top, a) => (a.hits > top.hits ? a : top), { id: NO_ANSWER, hits: 0 });
  return best.id;
}

export function standInAnswers(packetsDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packetsDir, 'manifest.json'), 'utf8'));
  return Object.fromEntries(Object.entries(manifest).map(([file, feature]) => [feature, standInAnswer(fs.readFileSync(path.join(packetsDir, file), 'utf8'))]));
}

export const writePacketsFor = (root, outDir) => runScript(path.join(SETUP_SCRIPTS, 'areas.mjs'), [root, 'lookup', 'packets', '--out', outDir], root);
export const scoreAnswersFor = (root, answersFile) => runScript(path.join(SETUP_SCRIPTS, 'areas.mjs'), [root, 'lookup', 'score', '--answers', answersFile], root);
