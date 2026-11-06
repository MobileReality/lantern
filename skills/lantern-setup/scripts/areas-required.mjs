import { AREAS_FILE, loadAreaTexts, loadAreas } from './areas-file.mjs';
import { runGate } from './areas-gate.mjs';
import { snapshotFromMap } from './areas-snapshot.mjs';
import { AREAS_MIN_FEATURES, AREAS_MIN_RECORDS_EXCLUSIVE, loadMap, meetsAreasThresholds, readLang } from './lib.mjs';

export const REQUIRED_STEP = 'lantern-setup Procedure step 4a ("Areas loop")';

function treeReasons(root) {
    const loaded = loadAreas(root);
    if (!loaded.exists) return [`${AREAS_FILE} does not exist`];
    if (loaded.errors.length) return loaded.errors.map((e) => e.message);
    const texts = loadAreaTexts(root, readLang(root));
    if (texts.error) return [texts.error];
    const groups = Object.fromEntries(loaded.areas.map((a) => [a.id, a.children.map((c) => c.id)]));
    const gate = runGate(snapshotFromMap(root), groups, texts.text, { allowUnassigned: false });
    return gate.failed.flatMap((rule) => rule.reasons.map((reason) => `areas.mjs check, ${rule.name}: ${reason}`));
}

export function areasRequirement(root) {
    const { records } = loadMap(root);
    const features = new Set(records.flatMap((record) => (record.feature ? [record.feature] : [])));
    const counts = { records: records.length, features: features.size };
    if (!meetsAreasThresholds(records)) return { ...counts, required: false, satisfied: true, reasons: [] };
    const reasons = treeReasons(root);
    return { ...counts, required: true, satisfied: reasons.length === 0, reasons };
}

export function requirementMessage(requirement) {
    const { records, features, reasons } = requirement;
    const head = `areas: required and not done. The map has ${records} records and ${features} features with records (more than ${AREAS_MIN_RECORDS_EXCLUSIVE} records and at least ${AREAS_MIN_FEATURES} features need areas), so the run is not finished until ${REQUIRED_STEP} has written ${AREAS_FILE} and lang/<primary>/areas.json and \`areas.mjs . check\` exits 0.`;
    return [head, ...reasons.map((reason) => `  ${reason}`)].join('\n');
}
