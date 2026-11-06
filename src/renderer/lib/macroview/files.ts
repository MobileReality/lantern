import type { MacroViewMarks } from './marks';
import type { MacroViewModel } from './model';

const MAX_FILES = 30;
const MAX_RELATIONS = 3;

interface FileRow {
  path: string;
  name: string;
  changed: boolean;
  reading: boolean;
  flow: boolean;
  plan: boolean;
  related: boolean;
}

interface FileList {
  rows: FileRow[];
  more: number;
}

interface RelationRow {
  id: string;
  name: string;
  count: number;
}

function nameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function depthOf(path: string) {
  return path.split('/').length;
}

function rowOf(path: string, marks: MacroViewMarks): FileRow {
  return { path, name: nameOf(path), changed: marks.files.has(path), reading: marks.reading.file === path, flow: !!marks.flow?.files.has(path), plan: !!marks.plan?.files.has(path), related: !!marks.plan?.related.has(path) };
}

function rank(row: FileRow) {
  return row.reading ? 0 : row.changed || row.plan ? 1 : row.flow ? 2 : row.related ? 3 : 4;
}

function topFiles(paths: readonly string[], marks: MacroViewMarks, limit = MAX_FILES): FileList {
  const rows = paths.map((path) => rowOf(path, marks)).sort((a, b) => rank(a) - rank(b) || depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path));
  const shown = rows.slice(0, limit);
  return { rows: shown, more: rows.length - shown.length };
}

function relationRows(model: MacroViewModel, featureId: string, limit = MAX_RELATIONS): RelationRow[] {
  return model.featureLinks
    .flatMap((link) => (link.from === featureId ? [link.to] : link.to === featureId ? [link.from] : []).map((id) => ({ id, name: model.features.get(id)?.name ?? id, count: link.count })))
    .slice(0, limit);
}

export { MAX_FILES, MAX_RELATIONS, nameOf, relationRows, topFiles };
export type { FileList, FileRow, RelationRow };
