import { randomUUID } from 'node:crypto';
import type { CodeSource } from '../../shared/code-highlighting';

interface SourceRecord {
  project: string;
  path: string;
  source: CodeSource;
  issuedAt: number;
}

const MAX_SOURCES = 2_000;
const MAX_AGE_MS = 30 * 60 * 1000;
const sources = new Map<string, SourceRecord>();

function issueSource(project: string, path: string, source: Omit<CodeSource, 'token'>) {
  const value = { ...source, token: randomUUID() };
  sources.set(value.token, { project, path, source: value, issuedAt: Date.now() });
  while (sources.size > MAX_SOURCES) sources.delete(sources.keys().next().value!);
  return value;
}

function validateSource(project: string, path: string, source: CodeSource) {
  const record = sources.get(source?.token);
  if (!record || Date.now() - record.issuedAt > MAX_AGE_MS || record.project !== project || record.path !== path) return null;
  return record.source;
}

export { issueSource, validateSource };
