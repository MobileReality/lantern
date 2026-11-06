import { AREAS_FILE, loadAreaTexts, loadAreas } from './areas-file.mjs';
import { snapshotFromMap } from './areas-snapshot.mjs';
import { fail } from './cli-args.mjs';
import { readLang } from './lib.mjs';

export const EXIT_UNUSABLE = 2;

export function requireMap(snap, where) {
    if (!snap.blocks.length) fail(`areas.mjs: no map records under ${where}; run lantern-setup first`, EXIT_UNUSABLE);
}

export function groupsFromProject(root) {
    const loaded = loadAreas(root);
    if (!loaded.exists) fail(`areas.mjs: no ${AREAS_FILE} in ${root}; draft it from \`areas.mjs propose\` first`, EXIT_UNUSABLE);
    if (loaded.errors.length) fail(`areas.mjs: ${AREAS_FILE} is malformed:\n${loaded.errors.map((e) => `  ${e.message}`).join('\n')}`, EXIT_UNUSABLE);
    const texts = loadAreaTexts(root, readLang(root));
    if (texts.error) fail(`areas.mjs: ${texts.error}`, EXIT_UNUSABLE);
    const snap = snapshotFromMap(root);
    requireMap(snap, root);
    const groups = Object.fromEntries(loaded.areas.map((a) => [a.id, a.children.map((c) => c.id)]));
    if (Object.keys(groups).length !== loaded.areas.length) fail(`areas.mjs: ${AREAS_FILE} declares an area twice; run validate.mjs for the lines`, EXIT_UNUSABLE);
    return { snap, groups, purposes: texts.text, where: AREAS_FILE };
}
