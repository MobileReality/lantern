import fs from 'node:fs';
import path from 'node:path';
import type { LangStore } from './lantern-texts';

const AREAS_FILE = '.lantern/areas';
const AREAS_LANG_FILE = 'areas.json';
const AREA_INDENT = 2;
const CORE_PREFIX = 'core:';
const FEATURE_ID = /^[a-z][a-z0-9-]*$/;

interface ParsedAreaChild {
  id: string;
  line: number;
}

interface ParsedArea {
  id: string;
  line: number;
  children: ParsedAreaChild[];
}

interface AreaSyntaxError {
  line: number;
  message: string;
}

interface ParsedAreas {
  areas: ParsedArea[];
  errors: AreaSyntaxError[];
}

interface LanternArea {
  id: string;
  description: string;
  features: string[];
}

function indentProblem(indent: string, id: string): string | null {
  if (indent.includes('\t')) return `"${id}" is indented with a tab; indent with two spaces per level`;
  if (indent.length % AREA_INDENT) return `"${id}" is indented by ${indent.length} spaces; use 0 (area) or ${AREA_INDENT} (feature)`;
  if (indent.length > AREA_INDENT) return `"${id}" nests deeper than two levels; this version has areas and features only, so flatten it`;
  return null;
}

function idProblem(id: string): string | null {
  if (id.startsWith(CORE_PREFIX)) return `"${id}" is a ${CORE_PREFIX}* block; foundation blocks stay out of ${AREAS_FILE}, delete the line`;
  if (!FEATURE_ID.test(id)) return `"${id}" must be one lowercase kebab-case id per line`;
  return null;
}

function parseAreas(text: string): ParsedAreas {
  const areas: ParsedArea[] = [];
  const errors: AreaSyntaxError[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const id = raw.trim();
    if (!id || id.startsWith('#')) return;
    const line = index + 1;
    const indent = raw.slice(0, raw.length - raw.trimStart().length);
    const shape = indentProblem(indent, id);
    if (shape) {
      errors.push({ line, message: shape });
      return;
    }
    const bad = idProblem(id);
    if (bad) errors.push({ line, message: bad });
    if (!indent) {
      areas.push({ id, line, children: [] });
      return;
    }
    if (bad) return;
    if (!areas.length) errors.push({ line, message: `feature "${id}" is indented but no area line comes before it; put an area line above, or unindent it` });
    else areas[areas.length - 1].children.push({ id, line });
  });
  return { areas, errors };
}

async function loadAreas(root: string, store: LangStore, warnings: string[]): Promise<LanternArea[] | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(path.join(root, AREAS_FILE), 'utf8');
  } catch {
    return null;
  }
  const { areas, errors } = parseAreas(text);
  for (const error of errors) warnings.push(`${AREAS_FILE}:${error.line}: [areas] ${error.message}`);
  return areas.map((area) => ({
    id: area.id,
    description: store.text(AREAS_LANG_FILE, area.id, `area ${area.id}`),
    features: area.children.map((child) => child.id),
  }));
}

export { loadAreas, parseAreas };
export type { AreaSyntaxError, LanternArea, ParsedArea, ParsedAreas };
