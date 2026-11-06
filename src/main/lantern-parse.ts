import type { Arrow } from './lantern-types';

const FORMAT_HEADER = 'lantern 1';
const MAP_DIR = '.lantern/map';
const ROOT_MAP_NAME = '.lantern';
const EXTERNAL_PREFIX = 'ext:';
const ARROWS = new Set(['>', '<', '=', '@']);
const RECORD_NOTE = /^#(feature|see-also|gotcha)(?:[ \t]+(.*?))?[ \t]*$/;

interface ParsedRelation {
  arrow: Arrow;
  token: string;
  to: string | null;
  ext: string | null;
  symbol: string | null;
  label: string;
}

interface ParsedRecord {
  path: string;
  marker: string;
  owner: string | null;
  role: string;
  hash: string;
  purpose: string;
  feature: string | null;
  seeAlso: string[] | null;
  seeAlsoNote: string;
  gotcha: string | null;
  relations: ParsedRelation[];
  file: string;
}

function decodePath(p: string) {
  return p.replace(/%23/g, '#').replace(/%20/g, ' ').replace(/%25/g, '%');
}

function encodePath(p: string) {
  return p.replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23');
}

function dirOf(rel: string) {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '.' : rel.slice(0, i);
}

function dirForMapFile(file: string) {
  if (file === `${MAP_DIR}/${ROOT_MAP_NAME}`) return '.';
  return file.slice(MAP_DIR.length + 1, -'.lantern'.length);
}

function splitLabel(line: string) {
  const bar = line.indexOf(' | ');
  if (bar === -1) return { head: line.trim(), label: '' };
  return { head: line.slice(0, bar).trim(), label: line.slice(bar + 3).trim() };
}

function parseTarget(token: string) {
  if (token.startsWith(EXTERNAL_PREFIX)) return { external: token.slice(EXTERNAL_PREFIX.length), path: null, symbol: null };
  const hash = token.indexOf('#');
  const rawPath = hash === -1 ? token : token.slice(0, hash);
  return { external: null, path: decodePath(rawPath), symbol: hash === -1 ? null : token.slice(hash + 1) };
}

function addNote(record: ParsedRecord | null, kind: string, value: string, where: string, errors: string[]) {
  if (!record) {
    errors.push(`${where}: #${kind} before any record`);
    return;
  }
  if (!value) {
    errors.push(`${where}: #${kind} needs a value`);
    return;
  }
  if (kind === 'feature') {
    if (record.feature !== null) errors.push(`${where}: second #feature for ${record.path}`);
    else record.feature = value;
  } else if (kind === 'gotcha') {
    if (record.gotcha !== null) errors.push(`${where}: second #gotcha for ${record.path}`);
    else record.gotcha = value;
  } else if (record.seeAlso !== null) {
    errors.push(`${where}: second #see-also for ${record.path}`);
  } else {
    const { head, label } = splitLabel(value);
    record.seeAlso = head.split(/\s+/).map(decodePath);
    record.seeAlsoNote = label;
  }
}

function parseMapFile(text: string, file: string): { records: ParsedRecord[]; errors: string[] } {
  const records: ParsedRecord[] = [];
  const errors: string[] = [];
  let sawHeader = false;
  let description: string | null = null;
  let current: ParsedRecord | null = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    if (!line.trim()) return;
    if (!sawHeader) {
      if (line.trim() !== FORMAT_HEADER) errors.push(`${where}: first line must be "${FORMAT_HEADER}"`);
      sawHeader = true;
      return;
    }
    if (line.startsWith('#')) {
      if (description === null) {
        description = line.slice(1).trim();
        return;
      }
      const note = RECORD_NOTE.exec(line);
      if (note) {
        addNote(current, note[1], note[2] ?? '', where, errors);
        return;
      }
      return;
    }
    const { head, label } = splitLabel(line);
    const tokens = head.split(/\s+/);
    if (/^\s/.test(line)) {
      if (!current) {
        errors.push(`${where}: relation before any record`);
        return;
      }
      if (tokens.length !== 2 || !ARROWS.has(tokens[0])) {
        errors.push(`${where}: relation must be "<arrow> <target> [| label]" with arrow one of > < = @`);
        return;
      }
      const target = parseTarget(tokens[1]);
      current.relations.push({ arrow: tokens[0] as Arrow, token: tokens[1], to: target.path, ext: target.external, symbol: target.symbol, label });
      return;
    }
    if (tokens.length !== 4) {
      errors.push(`${where}: record must be "<path> <marker> <role> <hash> [| purpose]"`);
      current = null;
      return;
    }
    const [rawPath, rawMarker, role, hash] = tokens;
    const markerMatch = /^([.~+-])(?:@([\w.-]+))?$/.exec(rawMarker);
    if (!markerMatch) {
      errors.push(`${where}: marker "${rawMarker}" must be one of . ~ + - optionally followed by @owner`);
      current = null;
      return;
    }
    current = {
      path: decodePath(rawPath),
      marker: markerMatch[1],
      owner: markerMatch[2] ?? null,
      role,
      hash,
      purpose: label,
      feature: null,
      seeAlso: null,
      seeAlsoNote: '',
      gotcha: null,
      relations: [],
      file,
    };
    records.push(current);
  });
  if (!sawHeader) errors.push(`${file}: empty map file`);
  else if (description !== dirForMapFile(file)) errors.push(`${file}: first # line must be "# ${dirForMapFile(file)}"`);
  return { records, errors };
}

function keyName(recordPath: string) {
  return encodePath(recordPath.slice(recordPath.lastIndexOf('/') + 1));
}

export { MAP_DIR, ROOT_MAP_NAME, decodePath, encodePath, dirOf, dirForMapFile, keyName, parseMapFile, splitLabel };
export type { ParsedRecord, ParsedRelation };
