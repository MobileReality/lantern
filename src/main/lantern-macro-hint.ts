import type { MacroAreasPart } from './lantern-macro-areas-read';
import type { ParsedRecord } from './lantern-parse';

const AREAS_MIN_RECORDS_EXCLUSIVE = 120;
const AREAS_MIN_FEATURES = 8;

function meetsAreasThresholds(records: readonly ParsedRecord[]) {
  if (records.length <= AREAS_MIN_RECORDS_EXCLUSIVE) return false;
  const features = new Set(records.flatMap((record) => (record.feature === null ? [] : [record.feature])));
  return features.size >= AREAS_MIN_FEATURES;
}

function areasHintPart(records: readonly ParsedRecord[], areasPart: MacroAreasPart): { areasHint?: true } {
  if (areasPart.areas || areasPart.areasWarning) return {};
  return meetsAreasThresholds(records) ? { areasHint: true } : {};
}

export { AREAS_MIN_FEATURES, AREAS_MIN_RECORDS_EXCLUSIVE, areasHintPart, meetsAreasThresholds };
