import { AREAS_FILE, parseAreas } from './areas-file.mjs';
import { areasLangFile, listLangs } from './texts.mjs';
import { rewriteTable } from './retag-edit.mjs';

function dropLines(lines, areas, predicate) {
    const doomed = new Set();
    for (const area of areas) {
        const gone = area.children.filter(predicate);
        gone.forEach((c) => { doomed.add(c.line - 1); });
        if (gone.length === area.children.length) doomed.add(area.line - 1);
    }
    return doomed;
}

function emptiedAreas(areas, predicate) {
    return areas.filter((a) => a.children.length > 0 && a.children.every(predicate)).map((a) => a.id);
}

export function retagAreaLeaf(edits, old, replacement) {
    const text = edits.read(AREAS_FILE);
    if (text === null) return false;
    const { areas } = parseAreas(text);
    const holds = (id) => areas.some((a) => a.children.some((c) => c.id === id));
    if (!holds(old)) return false;
    const lines = text.split(/(?<=\n)/);
    const isOld = (child) => child.id === old;
    if (replacement !== null && !holds(replacement)) {
        const line = areas.flatMap((a) => a.children).find(isOld).line - 1;
        lines[line] = lines[line].replace(old, replacement);
        edits.write(AREAS_FILE, lines.join(''));
        return true;
    }
    const doomed = dropLines(lines, areas, isOld);
    const emptied = emptiedAreas(areas, isOld);
    edits.write(AREAS_FILE, lines.filter((_, index) => !doomed.has(index)).join(''));
    for (const code of listLangs(edits.root)) {
        rewriteTable(edits, areasLangFile(code), (table) => Object.fromEntries(Object.entries(table).filter(([key]) => !emptied.includes(key))));
    }
    return true;
}
