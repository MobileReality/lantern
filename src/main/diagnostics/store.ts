import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticEntry } from '../../shared/diagnostics';
import { writeFileAtomically } from '../atomic-write';
import { DEFAULT_LIMITS, parseLog, rotateEntries, serializeEntry, type RotationLimits } from './rotation';

const COMPACT_SLACK = 1.25;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

export interface DiagnosticsStore {
  load(): DiagnosticEntry[];
  append(entry: DiagnosticEntry): void;
  list(): DiagnosticEntry[];
  subscribe(listener: (entry: DiagnosticEntry) => void): () => void;
}

export interface StoreDeps {
  file: string;
  now?: () => number;
  limits?: RotationLimits;
  onError?: (error: Error) => void;
}

export function createDiagnosticsStore({ file, now = Date.now, limits = DEFAULT_LIMITS, onError = () => {} }: StoreDeps): DiagnosticsStore {
  let entries: DiagnosticEntry[] = [];
  let writtenBytes = 0;
  const listeners = new Set<(entry: DiagnosticEntry) => void>();

  const attempt = (action: () => void) => {
    try {
      action();
    } catch (error) {
      onError(error as Error);
    }
  };

  function rewrite() {
    attempt(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: PRIVATE_DIR_MODE });
      const text = entries.map((entry) => `${serializeEntry(entry)}\n`).join('');
      writeFileAtomically(file, text, PRIVATE_FILE_MODE);
      writtenBytes = text.length;
    });
  }

  function load() {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      // No log yet: the first run.
    }
    const parsed = parseLog(text);
    entries = rotateEntries(parsed, limits, now());
    writtenBytes = text.length;
    if (entries.length !== parsed.length || (text && !text.endsWith('\n'))) rewrite();
    return [...entries];
  }

  function append(entry: DiagnosticEntry) {
    entries.push(entry);
    const line = `${serializeEntry(entry)}\n`;
    attempt(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: PRIVATE_DIR_MODE });
      fs.appendFileSync(file, line, { mode: PRIVATE_FILE_MODE });
      writtenBytes += line.length;
    });
    if (entries.length > limits.maxEntries * COMPACT_SLACK || writtenBytes > limits.maxBytes * COMPACT_SLACK) {
      entries = rotateEntries(entries, limits, now());
      rewrite();
    }
    for (const listener of listeners) listener(entry);
  }

  return {
    load,
    append,
    list: () => [...entries],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
